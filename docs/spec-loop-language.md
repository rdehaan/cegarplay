# Spec: the loop language

Read this for phase 3. It defines `js/compiler.js`: loop script in, Lua out.

The language is a thin notation over the runtime API in `spec-runtime.md`.
Each statement compiles to one Lua statement. Nothing here is prototyped; the
four example scripts below were run as the hand-written Lua shown in
`spike/js/shapes.mjs`, which is what the compiler must reproduce in behaviour.

## 1. Lexical rules

- Indentation-based, like Python. Spaces only; a tab is an error. The lexer
  emits `INDENT` and `DEDENT` from a stack of indentation widths. Blank lines
  and comment-only lines are ignored.
- Comments: `#` to end of line.
- `NAME`: `[A-Za-z_][A-Za-z0-9_]*`. `NUMBER`: integer or decimal.
  `STRING`: double quotes, with `\"` and `\\` escapes.
- Keywords: `solver link via options legacy compat if elif else loop while
  repeat until for in search on candidate partial every reject with accept restart stop
  break continue count by track log assume limit optimal and or not true false none as`.
- A name may not be a Lua keyword, nor `rt`, `clingo`, `FRAGMENTS`, `CONSTS`,
  `SETTINGS`, `main`, nor start with `__`.

## 2. Grammar

```
script  := { decl } { stmt }
decl    := "solver" NAME "=" frags [ "options" STRING ] NEWLINE
         | "link" NAME "=" NAME "->" NAME "via" frags { "legacy" | "compat" } NEWLINE
frags   := NAME { "+" NAME }
stmt    := NAME "=" expr NEWLINE
         | "if" expr ":" block { "elif" expr ":" block } [ "else" ":" block ]
         | "loop" ":" block
         | "while" expr ":" block
         | "repeat" ":" block "until" expr NEWLINE
         | "for" NAME "in" expr ":" block
         | "search" NAME ":" NEWLINE INDENT [ "on" "partial" NAME [ "every" expr ] ":" block ]
           "on" "candidate" NAME ":" block DEDENT
         | "reject" NAME "with" expr NEWLINE
         | "accept" NAME [ "as" NAME ] NEWLINE
         | "restart" NEWLINE | "break" NEWLINE | "continue" NEWLINE
         | "stop" [ STRING ] NEWLINE
         | "count" NAME [ "by" expr ] NEWLINE
         | "track" NAME "=" expr NEWLINE
         | "log" expr { "," expr } NEWLINE
         | expr NEWLINE
block   := simple_stmt                        (rest of the same line; no compound statement)
         | NEWLINE INDENT stmt { stmt } DEDENT
expr    := disj
disj    := conj { "or" conj }
conj    := neg { "and" neg }
neg     := [ "not" ] cmp
cmp     := sum [ ("==" | "!=" | "<" | "<=" | ">" | ">=") sum ]
sum     := term { ("+" | "-") term }
term    := unary { ("*" | "/" | "//") unary }
unary   := [ "-" ] post
post    := atom { "." NAME [ "(" [ args ] ")" ] | "(" [ args ] ")" }
atom    := NAME | NUMBER | STRING | "true" | "false" | "none" | "[" "]" | "(" expr ")"
args    := arg { "," arg }
arg     := "assume" expr | "limit" expr | "optimal" | NAME "=" expr | NAME "/" NUMBER | expr
```

All declarations come before the first statement. In `frags`, `+` is a
separator, not arithmetic.

## 3. Meaning and compilation

The compiler knows three kinds of names: solvers and links (from the
declarations) and variables (everything assigned, plus loop and candidate
variables).

### 3.1 Declarations

| Script | Lua |
| --- | --- |
| `solver A = shared + abstraction options "--heuristic=Domain -t 2"` | `local A = rt.solver("A", {"shared", "abstraction"}, {"--heuristic=Domain", "-t", "2"})` (option string split on whitespace) |
| `link G = A -> C via shared + glue legacy` | `local G = rt.link("G", A, C, {"shared", "glue"}, {legacy = true})` |
| end of declarations | one `rt.capture("p", n)` per distinct `p/n` used anywhere in the script, then `rt.prepare()` |

### 3.2 Statements

| Script | Lua |
| --- | --- |
| `x = e` | `x = e` (see 3.4 for the `local`) |
| `if a: ... elif b: ... else: ...` | `if a then ... elseif b then ... else ... end` |
| `loop:` | `while true do ... end` |
| `while e:` | `while e do ... end` |
| `repeat: ... until e` | `repeat ... until e` |
| `for x in e:` | `for _, x in rt.each(e) do ... end` (`rt.each` fails on a value that is not a list: a model, a solver, a link, none, a number, a string; a core `C.core` is a list) |
| `break` | `break` |
| `continue` | `goto __continue_N`, with `::__continue_N::` as the last statement of the innermost loop body (Lua 5.4 has `goto`) |
| `search A:` / `on candidate M:` / block | `A:search{ on_candidate = function(M)` ... `end }` |
| `on partial P every n:` / block (G5) | `on_partial = function(P)` ... `end, every = n, ` before `on_candidate` in the same table; the propagator checks at every fixpoint (`clingo.PropagatorCheckMode.Fixpoint`) while such a search runs |
| `G(P, v)` | `G:of(P, v)`: on a partial candidate, the open atoms get the value `v` |
| `C.core.minimal` | `rt.minimal(C:core())`: a subset-minimal core (deletion with clause-set refinement) |
| `reject M with e` | `M:reject(e)` |
| `accept M` | `rt.accept(M)` |
| `accept M as mss` | `rt.accept(M, "mss")`: an `N` event, counted per name, not a solution |
| `restart` | `rt.restart()` |
| `stop "msg"` | `rt.stop("msg")` |
| `count n by e` | `rt.count("n", e)` |
| `track n = e` | `rt.track("n", e)`: a number per call, sent as a V event (breadth.md B3) |
| `log a, b` | `rt.log(a, b)` |

### 3.3 Expressions

| Script | Lua |
| --- | --- |
| `S.solve(assume E, optimal)` | `S:solve{ assume = E, optimal = true }` |
| `S.solve(assume E1, E2)` | `S:solve{ assume = rt.concat(E1, E2) }` (every positional argument after `assume` is one more assumption list) |
| `S.solve()` | `S:solve{}` |
| `S.models(assume E, limit n)` | `S:models{ assume = E, limit = n }` |
| `S.add(c)` | `S:add(c)` |
| `S.expand(refine, cex = X.atoms(color/2))` | `S:expand("refine", { cex = X:atoms("color", 2) })`. The first argument is a bare part name, not a variable. |
| `S.exhausted`, `S.step` | `S.exhausted`, `S.k` |
| `G(M)` | `G:of(M)` |
| `G.clause(M, X)`, `G.block(M)`, `G.core(S)`, `G.clauses(X)` | `G:clause(M, X)`, `G:block(M)`, `G:core(S)`, `G:clauses(X)` |
| `X.atoms(p/n)` | `X:atoms("p", n)` |
| `[]` | `{}` |
| `l.push(e)`, `l.size`, `l.clear()` | `rt.push(l, e)`, `rt.size(l)`, `rt.clear(l)` |
| `none`, `!=`, `not`, `and`, `or` | `nil`, `~=`, `not`, `and`, `or` |

Other attribute or method names are a compile error that lists the valid ones.
Truth follows Lua: only `false` and `none` are false.

### 3.4 Variables

Variables are function-scoped. The compiler collects the variables assigned in
the main body and emits `local a, b, c` once, after `rt.prepare()`. It does the
same at the top of each `on candidate` function for variables first assigned
there. Loop variables of `for` and the candidate variable are locals by
construction.

### 3.5 One statement per line, and the line map

Every script statement starts a new Lua line, and no Lua line belongs to two
script lines. `compile` returns the map as an array: `map[luaLine] = scriptLine`
(1-based, within the compiled text). The driver adds the offset of the compiled
text inside the assembled program.

### 3.6 Static checks

Each is an error with line, column and message:

- undeclared fragment in `solver` or `link` (the compiler gets the list of
  fragment names);
- undeclared solver or link used in a declaration or as the receiver of a
  solver or link method; a solver or link name used as an assignment target;
- duplicate declaration; reserved name;
- `reject` or `restart` outside `on candidate`; `reject` naming a variable
  other than the candidate variable of the enclosing `on candidate`;
- `S.add` or `S.expand` inside `on candidate` of the same solver `S`;
- nested `search` inside `on candidate`;
- `break` or `continue` outside a loop;
- a compound statement after `:` on the same line;
- inconsistent indentation, tabs.

Part names in `expand` are collected and returned, so the driver can check
that `#program name(` occurs in a fragment of that solver.

## 4. Interface

```js
// js/compiler.js   (no DOM, no Node APIs; used by the page and by tests)
export function compile(source, { fragments /* string[] */ }) {
  // returns { ok: true, lua, map, solvers: [{name, fragments, options}],
  //           links: [{name, from, to, fragments, legacy, compat}],
  //           parts: [{solver, part, line}], captures: [{pred, arity}] }
  // or      { ok: false, errors: [{ line, col, message }] }
}
```

Report all errors that can be found in one pass, not just the first, where
that is easy (lexer errors and static checks); a parse error may stop the pass.

## 5. The templates (also the compiler's acceptance tests)

These five scripts ship as templates in the Loop tab. With the graph colouring
project at n=6 they must give the numbers in `docs/reference-numbers.md`.

### Shape 1: check inside the search

```
solver A = shared + abstraction
solver C = shared + check          options "--heuristic=Domain"
link   G = A -> C via shared + glue

search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.clause(M, X)
```

### Shape 2: solve, check, refine, solve again

```
solver A = shared + abstraction
solver C = shared + check          options "--heuristic=Domain"
link   G = A -> C via shared + glue

loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        A.add(G.block(M))
```

### Shape 3: ground rules per counterexample

As shape 2, with `A.expand(refine, cex = X.atoms(color/2))` in place of
`A.add(G.clause(M, X))`.

### Shape 4: search, collect, ground in batches

```
solver A = shared + abstraction
solver C = shared + check          options "--heuristic=Domain"
link   G = A -> C via shared + glue

pending = []
repeat:
    search A:
        on candidate M:
            X = C.solve(assume G(M))
            if X:
                pending.push(X)
                reject M with G.block(M)
                if pending.size >= 20: restart
    grounded = pending.size
    for X in pending:
        A.expand(refine, cex = X.atoms(color/2))
    pending.clear()
until A.exhausted and grounded == 0
```

### Reference run

Shape 1 with `reject M with G.block(M)` as the only refinement. It is always
sound, so its solution count is the truth on small instances.

## 6. Refinement variants to support and test (phase 2 runtime, phase 3 syntax)

| Variant | Script |
| --- | --- |
| Several counterexamples per candidate | `for X in C.models(assume G(M), limit 5): reject M with G.clause(M, X)` |
| Smallest refinement (`#minimize { 1,T : relevant(T) }.` in the check fragment) | `X = C.solve(assume G(M), optimal)` |
| Refine from an unsat core, for checks that look for a witness | `if not C.solve(assume G(M)): reject M with G.core(C)` |
| Two-stage check | `X = C1.solve(assume G1(M))` then `if not X: X = C2.solve(assume G2(M))` |
| Refinement computed by its own solver | `Y = R.solve(assume GA(M), GC(X))` then `reject M with GA.clause(M, Y)` |
| Explicit clauses from ASP | `reject M with G.clauses(X)` |

`for ... : reject ...` rejects the same candidate several times; the runtime
adds the first clause at once and stashes the rest (see `spec-runtime.md`).

## 7. Raw Lua projects

A project with `loop.language = "lua"` skips the compiler. Its text is placed
inside `rt.run(function() ... end)` as is. "Edit as Lua" in the UI replaces the
loop script by the compiler's output and switches the language; it is one-way.
