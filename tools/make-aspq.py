#!/usr/bin/env python3
"""Writes the ASP(Q) examples from one source, so that their shared fragments agree:

  examples/contrib/aspq.json                 two-level ASP(Q) programs, any program (meta-encoding)
  examples/contrib/aspq-deep.json            any number of levels, solver and link families
  examples/contrib/aspq-minmax-clique.json   Minmax Clique written level by level, with a
                                             hand-written refinement

    python3 tools/make-aspq.py [--check] [--qasp DIR]

--check only compares the files with what this script would write (exit 1 if they differ).
--qasp DIR also writes every instance as an ASP(Q) file DIR/<example>/<instance>.aspq in the
input format of qasp/pyqasp (%@exists, %@forall, %@constraint), for tools/aspq-check.py.
Then run node tools/make-examples.mjs.

ASP(Q): Amendola, Ricca and Truszczynski, Beyond NP: Quantifying over Answer Sets (TPLP 2019).
"""
import json, os, random, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# ASP(Q) programs as text, and as facts
# ---------------------------------------------------------------------------
# A program is written as in a qasp file: blocks headed %@exists / %@forall, then %@constraint.
# Rules are ground: normal rules "h :- body.", choice rules "{ a; b } :- body.", constraints
# ":- body." (no disjunction, no bounds on choices, no aggregates). The constraint program C
# holds constraints only.


def parse_program(text):
    """[(quantifier, [rule])] and the constraint rules; a rule is (kind, heads, pos, neg) with
    kind 'rule', 'choice' or 'constraint' and atoms as strings."""
    import clingo, clingo.ast as ast
    blocks, cur = [], None
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("%@"):
            q = s[2:].strip()
            if q not in ("exists", "forall", "constraint"):
                raise ValueError("unknown block %@" + q)
            cur = [q, []]
            blocks.append(cur)
        elif cur is not None:
            cur[1].append(line)
        elif s and not s.startswith("%"):
            raise ValueError("text before the first %@ block: " + s)
    if not blocks or blocks[-1][0] != "constraint" or any(b[0] == "constraint" for b in blocks[:-1]):
        raise ValueError("the program must end with one %@constraint block")

    def atom(lit):
        t = str(lit.atom.symbol)
        clingo.parse_term(t)  # ground terms only
        if any(ch.isupper() for ch in t.replace('"', "")):
            raise ValueError("variables are not supported: " + t)
        return t

    def rules_of(src):
        out = []

        def cb(st):
            if st.ast_type == ast.ASTType.Program:
                return
            if st.ast_type != ast.ASTType.Rule:
                raise ValueError("only rules are supported: " + str(st))
            pos, neg = [], []
            for b in st.body:
                if b.ast_type != ast.ASTType.Literal or b.atom.ast_type != ast.ASTType.SymbolicAtom:
                    raise ValueError("only plain literals in bodies: " + str(st))
                if b.sign == ast.Sign.NoSign:
                    pos.append(atom(b))
                elif b.sign == ast.Sign.Negation:
                    neg.append(atom(b))
                else:
                    raise ValueError("no double negation: " + str(st))
            h = st.head
            if h.ast_type == ast.ASTType.Literal and h.atom.ast_type == ast.ASTType.BooleanConstant:
                out.append(("constraint", [], pos, neg))
            elif h.ast_type == ast.ASTType.Literal:
                if h.sign != ast.Sign.NoSign:
                    raise ValueError("negated head: " + str(st))
                out.append(("rule", [atom(h)], pos, neg))
            elif h.ast_type == ast.ASTType.Aggregate and h.left_guard is None and h.right_guard is None:
                heads = []
                for e in h.elements:
                    if len(e.condition):
                        raise ValueError("no conditions in choices: " + str(st))
                    heads.append(atom(e.literal))
                out.append(("choice", heads, pos, neg))
            else:
                raise ValueError("unsupported head (no disjunction, no bounds): " + str(st))

        ast.parse_string(src, cb)
        return out

    levels = [(q, rules_of("\n".join(ls))) for q, ls in blocks[:-1]]
    cons = rules_of("\n".join(blocks[-1][1]))
    if any(r[0] != "constraint" for r in cons):
        raise ValueError("%@constraint holds constraints only")
    return levels, cons


def to_facts(text):
    """The facts of an ASP(Q) program: rule(R,L) (L = 1, 2, ... or c for the constraint
    program), head(R,A), choice(R), pos(R,A), neg(R,A); quant(L,Q) for each level."""
    levels, cons = parse_program(text)
    out, r = [], 0
    for i, (q, _) in enumerate(levels, 1):
        out.append(f"quant({i},{q}).")
    for lv, rules in [(str(i), rs) for i, (_, rs) in enumerate(levels, 1)] + [("c", cons)]:
        for kind, heads, pos, neg in rules:
            r += 1
            fs = [f"rule({r},{lv})."]
            if kind == "choice":
                fs.append(f"choice({r}).")
            fs += [f"head({r},{a})." for a in heads]
            fs += [f"pos({r},{a})." for a in pos]
            fs += [f"neg({r},{a})." for a in neg]
            out.append(" ".join(fs))
    return "\n".join(out) + "\n"


def random_program(rng, depth, atoms=4, rules=6, separate=False, outer_heads=True):
    """separate: no atom is the head of both a choice rule and a normal rule (pyqasp 0.0.1
    loses answer sets of such programs: {a; b}. b :- a. has 3, it counts 2)."""
    letters = "abcdefgh"
    lv = [[f"{letters[i]}{j}" for j in range(1, atoms + 1)] for i in range(depth)]
    lines = []
    for i in range(depth):
        lines.append("%@" + ("exists" if i % 2 == 0 else "forall"))
        own, seen = lv[i], [a for l in lv[:i + 1] for a in l]
        k = rng.randint(1, len(own) - 1 if separate else len(own))
        guess = rng.sample(own, k)
        defined = [a for a in own if a not in guess] if separate else own
        body = ""
        if i > 0 and rng.random() < 0.5:
            b = rng.choice([a for l in lv[:i] for a in l])
            body = " :- " + ("not " if rng.random() < 0.5 else "") + b
        lines.append("{ " + "; ".join(guess) + " }" + body + ".")
        for _ in range(rules):
            lits = []
            for a in rng.sample(seen, rng.randint(1, 2)):
                lits.append(("not " if rng.random() < 0.45 else "") + a)
            r = rng.random()
            if r < 0.2:
                lines.append(":- " + ", ".join(lits) + ".")
            elif r < 0.27 and i > 0 and outer_heads:  # a rule whose head belongs to an outer level
                lines.append(rng.choice([a for l in lv[:i] for a in l]) + " :- " + ", ".join(lits) + ".")
            else:
                lines.append(rng.choice(defined) + " :- " + ", ".join(lits) + ".")
    lines.append("%@constraint")
    allat = [a for l in lv for a in l]
    for _ in range(rng.randint(1, 3)):
        lits = [("not " if rng.random() < 0.4 else "") + a for a in rng.sample(allat, rng.randint(1, 3))]
        lines.append(":- " + ", ".join(lits) + ".")
    return "\n".join(lines) + "\n"


def comment(text):
    return "".join("% " + l + "\n" if l.strip() else "%\n" for l in text.strip("\n").splitlines())


# ---------------------------------------------------------------------------
# The meta-encoding: answer sets of one level with the outer levels fixed
# ---------------------------------------------------------------------------
SHARED = r"""% An ASP(Q) program as facts (see the Instances tab): rule(R,L) puts rule R in level L
% (1, 2, ...; c is the constraint program C), head(R,A), choice(R), pos(R,A), neg(R,A).
% An atom belongs to the first level that mentions it. Later levels read it as fixed
% (fix_P(M) of Amendola, Ricca and Truszczynski): true or false, never derived again.
mention(A,L) :- rule(R,L), head(R,A).
mention(A,L) :- rule(R,L), pos(R,A).
mention(A,L) :- rule(R,L), neg(R,A).
owner(A,L) :- mention(A,_), L = #min { L2 : mention(A,L2) }.
"""

META = r"""% The answer sets of the rules of this level (the constant level), with the atoms of the
% outer levels fixed. true(A) holds the atom A; the solver reads true(A) of an outer atom
% from the candidate (an interface atom of the link).
here(R) :- rule(R,level).
ok(R) :- here(R), true(A) : pos(R,A); not true(A) : neg(R,A).
true(A) :- here(R), head(R,A), not choice(R), owner(A,level), ok(R).
{ true(A) } :- here(R), head(R,A), choice(R), owner(A,level), ok(R).
% A rule whose head belongs to an outer level cannot derive it: it only checks it.
:- here(R), head(R,A), not choice(R), owner(A,L), L < level, ok(R), not true(A).
hashead(R) :- head(R,_).
:- here(R), not hashead(R), ok(R).
"""

# The constraint program C, evaluated on an answer set of the innermost level.
VIOLATE = r"""% C is violated: the body of one of its constraints holds.
okc(R) :- rule(R,c), true(A) : pos(R,A); not true(A) : neg(R,A).
violated :- okc(R).
"""

# The generic relevant/1: which outer atoms the answer set of this level depends on.
RELEVANT = r"""% relevant/1 for any program: outer atoms whose values keep a counterexample.
% keep_true(R): the body of rule R must stay true, so every literal of it keeps its value;
% keep_false(R): it must stay false, so one false literal keeps its value (one of this
% level if there is one). An atom of this level that must keep its value is need/1; an
% outer one is relevant/1. Negative literals count: an outer atom false here may be needed
% false.
outer(A) :- owner(A,L), L < level.
lit(R,A,1) :- here(R), pos(R,A).
lit(R,A,0) :- here(R), neg(R,A).
lit(R,A,0) :- here(R), head(R,A), not choice(R), outer(A).   % "not A" of a checked head
fails(R,A) :- lit(R,A,1), not true(A).
fails(R,A) :- lit(R,A,0), true(A).
% The constraints of this level, and its checks of outer heads, must stay false.
keep_false(R) :- here(R), not hashead(R).
keep_false(R) :- here(R), head(R,A), not choice(R), outer(A).

% Without a cycle through negation among the atoms of this level, an answer set is fixed
% by its choices: only the atoms that the kept rules read need keep their values (a cone
% of influence from the violated constraint and the constraints of this level). A true
% atom keeps its supporting rules (all of them: one alone could be circular, a :- b, b :- a);
% a false one keeps every rule for it false (a false choice atom is simply not chosen).
dep(H,B) :- here(R), head(R,H), owner(H,level), lit(R,B,_), owner(B,level).
ndep(H,B) :- here(R), head(R,H), owner(H,level), neg(R,B), owner(B,level).
path(H,B) :- dep(H,B).
path(H,B) :- dep(H,C), path(C,B).
full :- ndep(H,B), path(B,H).
keep_true(R) :- need(A), true(A), not full, here(R), head(R,A), ok(R).
keep_false(R) :- need(A), not true(A), not full, here(R), head(R,A), not choice(R).

% With such a cycle (full), every atom of this level keeps its value: every rule that
% supports a true atom stays true, every rule with a false head stays false.
need(A) :- full, here(R), head(R,A), owner(A,level).
keep_true(R) :- full, here(R), head(R,A), owner(A,level), true(A), ok(R).
keep_false(R) :- full, here(R), head(R,A), owner(A,level), not true(A), not choice(R).

need(A) :- keep_true(R), lit(R,A,_), not outer(A).
relevant(true(A)) :- keep_true(R), lit(R,A,_), outer(A).
own_fails(R) :- keep_false(R), fails(R,A), not outer(A).
need(A) :- keep_false(R), own_fails(R), A = #min { B : fails(R,B), not outer(B) }.
relevant(true(A)) :- keep_false(R), not own_fails(R), A = #min { B : fails(R,B) }.
"""

RELEVANT_C_FORALL = r"""% The violated constraint of C with the smallest number stays violated.
cpick(R) :- okc(R), R = #min { Q : okc(Q) }.
need(A) :- cpick(R), pos(R,A), not outer(A).
need(A) :- cpick(R), neg(R,A), not outer(A).
relevant(true(A)) :- cpick(R), pos(R,A), outer(A).
relevant(true(A)) :- cpick(R), neg(R,A), outer(A).
"""

# ---------------------------------------------------------------------------
# aspq: two levels, any program
# ---------------------------------------------------------------------------
EXISTS = r"""% Level 1 (exists): the candidates are the answer sets of P1.
#const level = 1.
#show true/1.
"""

FORALL = r"""% Level 2 (forall): a counterexample is an answer set of P2, with the candidate's atoms
% fixed, that violates C. A candidate with no counterexample is a quantified answer set,
% also when P2 has no answer set at all (the forall holds vacuously).
#const level = 2.
:- not violated.
#show.
#show true(A) : true(A), owner(A,2).
"""

GLUE = r"""% The interface atoms: every atom of level 1 (derived atoms too: fix_P1 fixes them all).
glue(true(A)) :- owner(A,1).
"""

LOOP_RELEVANT = """solver A = shared + meta + exists
solver C = shared + meta + forall + violate + relevant + relevant_c
link   G = A -> C via shared + glue

# A candidate is an answer set of P1; the check looks for an answer set of P2 that violates C.
# relevant/1 (written once, for every program) names the level-1 atoms it depends on.
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X: reject M with G.clause(M, X)
"""

LOOP_LIFT = """solver A = shared + meta + exists
solver C = shared + meta + forall + violate
link   G = A -> C via shared + glue lift

# No relevant/1: lift computes each clause from the ground programs of A and C.
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X: reject M with G.clause(M, X)
"""

LOOP_BLOCK = """solver A = shared + meta + exists
solver C = shared + meta + forall + violate
link   G = A -> C via shared + glue

# The blocking loop: each refuted candidate is ruled out on its own.
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X: reject M with G.block(M)
"""


def inst(id, note, program, expected, tags=None):
    return {"id": id, "facts": comment(note) + comment(program) + to_facts(program),
            "constants": {}, "expected": {"solutions": expected}, "tags": tags or [],
            "program": program}


def network(links, p1_extra="", hard=()):
    """P1 builds some of the links (undirected); P2 cuts exactly one built link that is not
    hard; C: t is still reached from s. P1 derives hard(X,Y) for a built link in hard."""
    L = [f"link({x},{y})" for x, y in links]
    K = [f"cut({x},{y})" for x, y in links]
    out = ["%@exists", "{ " + "; ".join(L) + " }."]
    out += [f"hard({x},{y}) :- link({x},{y})." for x, y in hard]
    out += [l for l in p1_extra.strip().splitlines()]
    out += ["%@forall", "{ " + "; ".join(K) + " }."]
    out += [f":- cut({x},{y}), not link({x},{y})." for x, y in links]
    out += [f":- cut({x},{y}), hard({x},{y})." for x, y in hard]
    out += ["some :- " + k + "." for k in K]
    out += [f"two :- {K[i]}, {K[j]}." for i in range(len(K)) for j in range(i + 1, len(K))]
    out += [":- not some.", ":- two."]
    out += [f"up({x},{y}) :- link({x},{y}), not cut({x},{y})." for x, y in links]
    out += ["reach(s)."]
    for x, y in links:
        out += [f"reach({y}) :- reach({x}), up({x},{y}).", f"reach({x}) :- reach({y}), up({x},{y})."]
    out += ["%@constraint", ":- not reach(t)."]
    return "\n".join(out) + "\n"


LINKS6 = [("s","a"), ("s","b"), ("a","b"), ("a","t"), ("b","t"), ("s","t")]
NETWORK = network(LINKS6, ":- link(s,t), link(a,b).", hard=[("s","t")])
# One link out of s (s-a), and the empty network excluded: no solution.
NETWORK_NONE = network(LINKS6, ":- link(s,t).\n:- link(s,b).\n:- not link(s,a).")
LINKS9 = [("s","a"), ("s","b"), ("a","b"), ("a","c"), ("b","c"), ("b","d"), ("c","t"), ("d","t"), ("c","d")]
NETWORK9 = network(LINKS9, ":- link(a,c), link(b,d).")

# The example of the pyqasp distribution, its disjunctions written as choices and constraints.
QASP_EXAMPLE = """%@exists
{ o(1); o(2) }.
a :- o(1).
b :- o(2).
{ c; d } :- a.
:- a, not c, not d.
:- c, d.
%@forall
{ g; h } :- c.
:- c, not g, not h.
:- g, h.
g :- not c.
%@constraint
:- g, b.
"""

# P2 with a cycle through negation (x and y): the generic relevant/1 keeps every atom of P2.
EVEN_LOOP = """%@exists
{ p; q; r; s }.
:- p, q, r.
%@forall
x :- not y, p.
y :- not x.
z :- x, q.
z :- y, r.
w :- y, s.
:- w, not q.
%@constraint
:- z, not s.
"""


# The counterexample needs a false: x :- not a. A relevant/1 that reads positive literals only
# would refute the candidates with a as well.
NEGATIVE = """%@exists
{ a; p; q }.
%@forall
{ y }.
x :- not a.
x :- y, q.
%@constraint
:- x, not p.
"""

# Making o true makes P2 incoherent (p :- not p, q with q :- o): the forall then holds
# vacuously. A counterexample found with o false says nothing about o true, although P2
# reads o only through q, and the violated constraint does not mention q.
ODD_LOOP = """%@exists
{ o; r1; r2 }.
%@forall
{ z }.
q :- o.
p :- not p, q.
%@constraint
:- z, not r1.
"""


def rnd(seed):
    return random_program(random.Random(seed), 2, atoms=5, rules=7, separate=True, outer_heads=False)


ASPQ_INSTANCES = [
    inst("example", """A network that survives the loss of any one link. P1 builds some of six links (s-t and a-b
not both) and derives hard(s,t) when it builds s-t: that link cannot be cut. P2 cuts exactly
one built link that is not hard; C: t is still reached from s. Links are used both ways,
which gives positive loops in P2; P2 reads link/2 under negation (a cut needs a built
link) and the derived hard/2 (fix_P1 fixes derived atoms too). The empty network and
the network with s-t alone are solutions: P2 has no answer set (no link to cut), so the
forall holds vacuously.""", NETWORK, 19, ["library"]),
    inst("nine-links", """A larger network: nine links between s, a, b, c, d and t (a-c and b-d not both), no hard
link.""", NETWORK9, 5),
    inst("no-solution", """The network with one link out of s (s-a): cutting it separates t, and the empty network
is excluded. No solution.""", NETWORK_NONE, 0),
    inst("qasp-example", """The example of the pyqasp distribution (disjunctions written as a choice and two
constraints): pyqasp counts 3 quantified answer sets.""", QASP_EXAMPLE, 3),
    inst("even-loop", """P2 decides x or y by an even loop through negation, so the generic relevant/1 falls back
to keeping every atom of P2, and lift falls back to blocking.""", EVEN_LOOP, 10),
    inst("negative-literal", """P2 derives x from a false atom of P1 (x :- not a): the counterexample depends on a being
false, so the clause must name a (a negative literal of the clause: a must become true).""", NEGATIVE, 5),
    inst("odd-loop", """o makes P2 incoherent (p :- not p, q and q :- o): every candidate with o is a solution,
vacuously. A counterexample for a candidate without o must name o although the violated
constraint does not read it; the generic relevant/1 keeps every atom of P2 here (a cycle
through negation), so it names o.""", ODD_LOOP, 6),
    inst("random-81", """A random program (tools/make-aspq.py, rnd(81)): 5 atoms per level.""", rnd(81), 4, ["generated"]),
    inst("random-322", """A random program (tools/make-aspq.py, rnd(322)): 5 atoms per level.""", rnd(322), 2, ["generated"]),
]


def aspq():
    return {
        "format": "cegarplay", "version": 2,
        "title": "ASP(Q), two levels",
        "description": "Quantified answer set programs (ASP(Q), Amendola, Ricca and Truszczynski 2019) with two levels, exists P1 forall P2 : C, for any program: an instance is the program as facts (its text, as a qasp file, is in the comment of the instance), and one meta-encoding computes the answer sets of a level with the atoms of the outer level fixed. A candidate is an answer set of P1; a counterexample is an answer set of P2, with all atoms of P1 fixed (derived ones too), that violates C. Two things differ from a QBF. P2 may have no answer set for a candidate: the forall then holds vacuously and the candidate is a solution (the empty network of the example). And P2 reads the candidate non-monotonically: a counterexample can depend on an atom being false, and making an atom true can remove every answer set of P2 (instance odd-loop), so the clause has to name atoms the violated constraint never reads. The loop reads a relevant/1 written once for every program: a cone of influence from the violated constraint (every atom of P2 when P2 has a cycle through negation). The variant lift computes the clauses from the ground programs instead, with no relevant/1: about as strong, several times slower. The variant reference blocks.",
        "fragments": [
            {"name": "shared", "description": "Which level each atom belongs to. Added to every solver and to the glue.", "text": SHARED},
            {"name": "meta", "description": "The answer sets of one level (the constant level), with the atoms of the outer levels fixed.", "text": META},
            {"name": "exists", "description": "Level 1 (solver A): the candidates are the answer sets of P1.", "text": EXISTS},
            {"name": "glue", "description": "The interface atoms: every atom of level 1.", "text": GLUE},
            {"name": "forall", "description": "Level 2 (solver C): an answer set of P2 that violates C.", "text": FORALL},
            {"name": "violate", "description": "When the constraint program C is violated.", "text": VIOLATE},
            {"name": "relevant", "description": "relevant/1 for any program: the level-1 atoms the counterexample depends on.", "text": RELEVANT},
            {"name": "relevant_c", "description": "relevant/1 for the violated constraint of C.", "text": RELEVANT_C_FORALL},
        ],
        "loop": {"language": "loop", "text": LOOP_RELEVANT},
        "settings": {"constants": {}, "solutions": 0, "seconds": 60, "candidates": 0, "trace": 200, "seed": 0},
        "instances": [{k: v for k, v in i.items() if k != "program"} for i in ASPQ_INSTANCES],
        "variants": [
            {"name": "reference", "swap": {}, "constants": {}, "loop": {"language": "loop", "text": LOOP_BLOCK}},
            {"name": "lift", "swap": {}, "constants": {}, "loop": {"language": "loop", "text": LOOP_LIFT}},
        ],
        "library": {
            "id": "aspq", "group": "logic",
            "summary": "Two-level ASP(Q), exists P1 forall P2 : C, for any program given as facts: lift on the link, a generic relevant/1 and blocking compared (a network that survives any one cut: 19 quantified answer sets).",
            "shape": "custom", "tags": ["fast", "aspq"], "expected": 19, "level": 3, "after": 13,
        },
    }


# ---------------------------------------------------------------------------
# aspq-deep: any number of levels, solver and link families
# ---------------------------------------------------------------------------
DEEP_INNER = r"""% Level i of the family (the constant level); the innermost level (level = depth) also
% decides C: an innermost exists level must satisfy C, an innermost forall level violate it.
#const depth = 3.
last :- level = depth.
odd :- depth \ 2 = 1.
okc(R) :- last, rule(R,c), true(A) : pos(R,A); not true(A) : neg(R,A).
violated :- okc(R).
:- last, odd, violated.
:- last, not odd, not violated.
#show.
#show true(A) : true(A), owner(A,level).
"""

DEEP_RELEVANT_C = r"""% At an inner level that is not the last, every atom of this level that a later level
% reads keeps its value: the next level, and the cores it returns, see them.
need(A) :- not last, owner(A,level), mention(A,L), L > level.
% The innermost level: a forall level keeps one violated constraint of C violated, an
% exists level keeps every constraint of C false.
cpick(R) :- last, not odd, okc(R), R = #min { Q : okc(Q) }.
need(A) :- cpick(R), pos(R,A), not outer(A).
need(A) :- cpick(R), neg(R,A), not outer(A).
relevant(true(A)) :- cpick(R), pos(R,A), outer(A).
relevant(true(A)) :- cpick(R), neg(R,A), outer(A).
cfalse(R) :- last, odd, rule(R,c).
lit(R,A,1) :- cfalse(R), pos(R,A).
lit(R,A,0) :- cfalse(R), neg(R,A).
keep_false(R) :- cfalse(R).
"""

DEEP_GLUE = r"""% Level i passes on the atoms of every level up to its own that a later level reads,
% and every atom of level 1: the loop blocks an accepted answer set of P1 on its link, and
% two answer sets that differ only on atoms no later level reads are two solutions.
glue(true(A)) :- owner(A,L), L <= level, mention(A,L2), L2 > level.
glue(true(A)) :- owner(A,1).
"""

DEEP_LOOP = """solver S[i in 1..depth] = shared + meta + inner + relevant + relevant_c
link   G[i in 1..depth-1] = S[i] -> S[i+1] via shared + glue

# refute(i, M): a clause that removes the candidate M of level i - 1, or none if M stands.
# Level i looks for an answer set Y of its program with the outer atoms of M fixed. None:
# M stands (the forall of a forall level holds vacuously; an exists level has no answer).
# At the innermost level Y decides C and refutes M by its relevant atoms. Otherwise level
# i + 1 tries to refute Y: if it cannot, Y refutes M, and the reason has two parts: what
# keeps Y an answer set (relevant/1, which in ASP(Q) depends on M, unlike in a QBF) and
# what made level i + 1 fail (its core, minimised, on the atoms of level i - 1). If it can,
# level i learns the clause and looks again.
def refute(i, M):
    loop:
        Y = S[i].solve(assume G[i-1](M))
        if not Y: return none
        if i == S.size: return G[i-1].clause(Y)
        c = refute(i + 1, Y)
        if not c: return G[i-1].clause(Y) + S[i+1].core.minimal.on(G[i-1])
        S[i].add(c)

loop:
    M = S[1].solve()
    if not M: stop
    c = refute(2, M)
    if c: S[1].add(c)
    else:
        accept M
        S[1].add(G[1].block(M))
"""

DEEP_LOOP_REF = DEEP_LOOP.replace("""        if i == S.size: return G[i-1].clause(Y)
        c = refute(i + 1, Y)
        if not c: return G[i-1].clause(Y) + S[i+1].core.minimal.on(G[i-1])""", """        if i == S.size: return G[i-1].block(M)
        c = refute(i + 1, Y)
        if not c: return G[i-1].block(M)""").replace("# refute(i, M):", "# Block-only baseline: every answer blocks the candidate it refutes.\\n# refute(i, M):")

DEEP_LOOP_PLAIN = DEEP_LOOP.replace("core.minimal.on", "core.on").replace("(its core, minimised,", "(its core as clasp returns it,")

DEEP_LOOP_SEARCH = DEEP_LOOP[:DEEP_LOOP.index("loop:\n    M = S[1].solve()")] + """search S[1]:
    on candidate M:
        c = refute(2, M)
        if c: reject M with c
"""


def network3(links, pool, most):
    """Exists: build at most `most` of the links; forall: cut exactly one built link; exists:
    repair with at most one spare link of the pool; C: t is reached from s."""
    from itertools import combinations
    L = [f"link({x},{y})" for x, y in links]
    K = [f"cut({x},{y})" for x, y in links]
    F = [f"spare({x},{y})" for x, y in pool]
    out = ["%@exists", "{ " + "; ".join(L) + " }."]
    out += [":- " + ", ".join(c) + "." for c in combinations(L, most + 1)]
    out += ["%@forall", "{ " + "; ".join(K) + " }."]
    out += [f":- cut({x},{y}), not link({x},{y})." for x, y in links]
    out += ["some :- " + k + "." for k in K]
    out += [f"two :- {K[i]}, {K[j]}." for i in range(len(K)) for j in range(i + 1, len(K))]
    out += [":- not some.", ":- two."]
    out += ["%@exists", "{ " + "; ".join(F) + " }."]
    out += [f":- {F[i]}, {F[j]}." for i in range(len(F)) for j in range(i + 1, len(F))]
    out += [f"up({x},{y}) :- link({x},{y}), not cut({x},{y})." for x, y in links]
    out += [f"up({x},{y}) :- spare({x},{y})." for x, y in pool]
    out += ["reach(s)."]
    for x, y in list(links) + [p for p in pool if p not in links]:
        out += [f"reach({y}) :- reach({x}), up({x},{y}).", f"reach({x}) :- reach({y}), up({x},{y})."]
    out += ["%@constraint", ":- not reach(t)."]
    return "\n".join(out) + "\n"


# Level 2 derives d from level 1, level 3 reads it: d must keep its value (and with it a).
DERIVED = """%@exists
{ a; p; q }.
%@forall
{ b }.
d :- a.
%@exists
{ e }.
:- d, not e.
:- e, not b, not p.
%@constraint
:- e, q.
"""

REPAIR = network3(LINKS6, [("a","t"), ("b","t")], 3)
REPAIR_NONE = network3(LINKS6, [("a","b")], 2)


def deep_inst(id, note, program, expected, tags=None):
    i = inst(id, note, program, expected, tags)
    i["constants"] = {"depth": str(len(parse_program(program)[0]))}
    return i


def rnd_deep(seed, depth):
    return random_program(random.Random(seed), depth, atoms=3, rules=5, separate=True, outer_heads=False)


DEEP_INSTANCES = [
    deep_inst("example", """Build, cut, repair (exists, forall, exists). P1 builds at most three of six links; P2 cuts
exactly one built link; P3 may add one spare link, a-t or b-t; C: t is reached from s. A
network with no link is a solution because P2 has no answer set (nothing to cut).""", REPAIR, 14, ["library"]),
    deep_inst("no-repair", """At most two links and only a-b as a spare: some cut always separates t. The one solution
is the empty network: P2 has no answer set, so the forall holds vacuously.""", REPAIR_NONE, 1),
    deep_inst("two-levels", """The network of aspq (two levels, depth = 2): the same 19 solutions.""", NETWORK, 19),
    deep_inst("derived-read-later", """Level 2 derives d from a; level 3 reads d. Unlike a QBF, the answer of level 2 is not just
its own choices: the atoms that later levels read must keep their values, so the clause for
level 1 names a.""", DERIVED, 5),
    deep_inst("random-3", """A random program with three levels (tools/make-aspq.py, rnd_deep(5, 3)).""", rnd_deep(5, 3), 3, ["generated"]),
    deep_inst("random-4", """A random program with four levels (tools/make-aspq.py, rnd_deep(7, 4)): no solution.""", rnd_deep(7, 4), 0, ["generated"]),
]


def aspq_deep():
    return {
        "format": "cegarplay", "version": 2,
        "title": "ASP(Q) with any number of levels",
        "description": "ASP(Q) programs with any number of alternating levels (exists first), as qbf-deep does for QBF: a solver family S[1..depth] over the meta-encoding of aspq and a recursive procedure refute. Level i answers a candidate of level i - 1 with an answer set of its own program (the outer atoms fixed); a level without answer set ends the recursion (a forall level holds vacuously, an exists level fails). What changes from a QBF: the answer of level i is legal only for some outer values, so its clause names the outer atoms that keep it an answer set (relevant/1 at every level, not only the innermost), and the atoms of level i that later levels read must keep their values, since the core of level i + 1 is cut down to the atoms of level i - 1 (instance derived-read-later). The example builds a network, cuts a link and repairs it (exists forall exists).",
        "fragments": [
            {"name": "shared", "description": "Which level each atom belongs to. Added to every solver and to the glue.", "text": SHARED},
            {"name": "meta", "description": "The answer sets of level i (the constant level), with the atoms of the outer levels fixed.", "text": META.replace("this level (the constant level)", "this level (the constant level, set per member of the family)")},
            {"name": "inner", "description": "The innermost level also decides the constraint program C.", "text": DEEP_INNER},
            {"name": "glue", "description": "Level i passes on the atoms up to its own that later levels read.", "text": DEEP_GLUE},
            {"name": "relevant", "description": "relevant/1 for any program: the outer atoms that keep an answer set an answer set.", "text": RELEVANT},
            {"name": "relevant_c", "description": "relevant/1 at the inner levels and for C.", "text": DEEP_RELEVANT_C},
        ],
        "loop": {"language": "loop", "text": DEEP_LOOP},
        "settings": {"constants": {"depth": "3"}, "solutions": 0, "seconds": 60, "candidates": 0, "trace": 200, "seed": 0},
        "instances": [{k: v for k, v in i.items() if k != "program"} for i in DEEP_INSTANCES],
        "variants": [
            {"name": "reference", "swap": {}, "constants": {}, "loop": {"language": "loop", "text": DEEP_LOOP_REF}},
            {"name": "search", "swap": {}, "constants": {}, "loop": {"language": "loop", "text": DEEP_LOOP_SEARCH}},
            {"name": "plain-cores", "swap": {}, "constants": {}, "loop": {"language": "loop", "text": DEEP_LOOP_PLAIN}},
        ],
        "library": {
            "id": "aspq-deep", "group": "logic",
            "summary": "ASP(Q) with any number of levels (build, cut, repair: exists forall exists, 14 quantified answer sets): solver families and a recursive refute with relevant/1 at every level.",
            "shape": "custom", "tags": ["fast", "aspq", "several-solvers", "rareqs"], "expected": 14, "level": 4, "after": 19,
        },
    }


# ---------------------------------------------------------------------------
# aspq-minmax-clique: a problem written level by level, with a hand-written refinement
# ---------------------------------------------------------------------------
MM_SHARED = r"""% The graph (see the Instances tab): v(V,I,J) puts vertex V in block (I,J) of the
% partition, e(U,V) is an edge (U < V); k is the clique size. Row I has the blocks (I,J).
row(I) :- v(_,I,_).
col(I,J) :- v(_,I,J).
edge(U,V) :- e(U,V).
edge(V,U) :- e(U,V).
"""

MM_P1 = r"""% P1 (forall in the ASP(Q) program, exists in the loop): t picks one block per row.
1 { t(I,J) : col(I,J) } 1 :- row(I).
#show t/2.
"""

MM_P2 = r"""% P2 (exists in the ASP(Q) program): a clique of k vertices among the picked blocks.
% C is empty, so the loop's check, forall P2 : false, is refuted by any answer set of P2:
% a candidate t survives only when P2 has no answer set, i.e. vacuously.
{ in(V) } :- v(V,I,J), t(I,J).
:- in(U), in(V), U < V, not edge(U,V).
:- #count { V : in(V) } != k.
#show in/1.
"""

MM_RELEVANT = r"""% The clique stays a clique as long as t keeps the blocks of its vertices: one of them must
% change. The rows of the clique, not its vertices, name the atoms.
used(I,J) :- in(V), v(V,I,J).
relevant(t(I,J)) :- used(I,J).
"""

MM_FEWEST = r"""% Prefer cliques that use few rows: shorter clauses (with C.solve(..., optimal)).
#minimize { 1,I : used(I,J) }.
"""

MM_GLUE = r"""% The interface atoms: the picks of t.
glue(t(I,J)) :- col(I,J).
"""

MM_LOOP = """solver A = shared + p1
solver C = shared + p2 + relevant + fewest
link   G = A -> C via shared + glue

# A candidate is a pick t; the check looks for a k-clique among the picked blocks, the one
# that spans the fewest rows; the clause says: one of those rows picks another block.
search A:
    on candidate M:
        X = C.solve(assume G(M), optimal)
        if X: reject M with G.clause(M, X)
"""

MM_LOOP_FIRST = """solver A = shared + p1
solver C = shared + p2 + relevant
link   G = A -> C via shared + glue

# The first clique the check finds, with the hand-written relevant/1 (no optimisation).
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X: reject M with G.clause(M, X)
"""

MM_LOOP_LIFT = """solver A = shared + p1
solver C = shared + p2
link   G = A -> C via shared + glue lift

# No relevant/1: lift computes each clause from the ground programs.
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X: reject M with G.clause(M, X)
"""

MM_LOOP_BLOCK = """solver A = shared + p1
solver C = shared + p2
link   G = A -> C via shared + glue

# The blocking loop: each refuted candidate is ruled out on its own.
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X: reject M with G.block(M)
"""


def mm_random(seed, rows, cols, per, p, k):
    """A random Minmax Clique instance: rows x cols blocks of `per` vertices, edges with
    probability p (in percent)."""
    rng = random.Random(seed)
    vs, v = [], 0
    for i in range(1, rows + 1):
        for j in range(1, cols + 1):
            for _ in range(per):
                v += 1
                vs.append((v, i, j))
    es = [(a, b) for a in range(1, v + 1) for b in range(a + 1, v + 1) if rng.random() * 100 < p]
    return vs, es, k


def mm_facts(vs, es):
    lines, row = [], None
    for v, i, j in vs:
        lines.append(f"v({v},{i},{j}).")
    out = " ".join(lines) + "\n"
    out += " ".join(f"e({a},{b})." for a, b in es) + "\n"
    return out


def mm_inst(id, note, data, expected, tags=None):
    vs, es, k = data
    return {"id": id, "facts": comment(note) + mm_facts(vs, es), "constants": {"k": str(k)},
            "expected": {"solutions": expected}, "tags": tags or [], "data": data}


def mm_program(data):
    """The dual as an ASP(Q) file for pyqasp: exists t, forall cliques, C always violated."""
    vs, es, k = data
    # in ASP-Core-2 syntax, which pyqasp parses: no anonymous variables, <> for !=
    return ("%@exists\n" + mm_facts(vs, es) + "row(I) :- v(V,I,J).\ncol(I,J) :- v(V,I,J).\n"
            + "edge(U,V) :- e(U,V).\nedge(V,U) :- e(U,V).\n1 <= { t(I,J) : col(I,J) } <= 1 :- row(I).\n"
            + "%@forall\n{ in(V) } :- v(V,I,J), t(I,J).\n:- in(U), in(V), U < V, not edge(U,V).\n"
            + f":- #count {{ V : in(V) }} <> {k}.\n%@constraint\n:- not false_.\n")


MM_INSTANCES = [
    mm_inst("example", """Three rows of two blocks of two vertices, 17 random edges (mm_random(3, 3, 2, 2, 35, 3)),
k = 3: the picks t that leave no triangle.""", mm_random(3, 3, 2, 2, 35, 3), 6, ["library"]),
    mm_inst("every-pick", """The same partition with denser edges (50 %): every pick leaves a triangle, so the Minmax
Clique property holds and the loop finds no solution.""", mm_random(4, 3, 2, 2, 50, 3), 0),
    mm_inst("three-per-block", """Six rows of three blocks of three vertices (729 picks), k = 3: a triangle can lie in one
or two rows, so cliques over few rows give short clauses (38 candidates, 67 with the
first clique the check finds).""", mm_random(12, 6, 3, 3, 25, 3), 4),
    mm_inst("four-per-row", """Five rows of four blocks of three vertices (1,024 picks), k = 3.""", mm_random(14, 5, 4, 3, 25, 3), 4),
    mm_inst("five-rows", """Five rows of three blocks of two vertices (243 picks), k = 4.""", mm_random(9, 5, 3, 2, 45, 4), 74),
]


def aspq_minmax():
    return {
        "format": "cegarplay", "version": 2,
        "title": "Minmax Clique in ASP(Q)",
        "description": "Minmax Clique (Ko and Lin 1995), a Pi-2-complete benchmark for ASP(Q) solvers, written level by level: for every pick t of one block per row (P1, forall) the picked blocks hold a clique of k vertices (P2, exists), and C is empty. The loop checks the dual, exists P1 forall P2 : false, so its solutions are the picks without such a clique: a candidate survives exactly when P2 has no answer set, vacuously. The property holds when the loop finds no solution (instance every-pick). The hand-written relevant/1 names the blocks of the clique, and the check prefers cliques over few rows (#minimize, an optimal solve), so the clauses are short; lift finds clauses as strong but takes far longer, and reference blocks. tools/make-aspq.py --qasp DIR writes the instances as qasp files for comparison.",
        "fragments": [
            {"name": "shared", "description": "The graph and its partition into blocks. Added to every solver.", "text": MM_SHARED},
            {"name": "p1", "description": "P1: one block per row (solver A).", "text": MM_P1},
            {"name": "glue", "description": "The interface atoms: the picks.", "text": MM_GLUE},
            {"name": "p2", "description": "P2: a clique of k vertices in the picked blocks (solver C).", "text": MM_P2},
            {"name": "relevant", "description": "The hand-written relevant/1: the blocks of the clique.", "text": MM_RELEVANT},
            {"name": "fewest", "description": "A clique over few rows first.", "text": MM_FEWEST},
        ],
        "loop": {"language": "loop", "text": MM_LOOP},
        "settings": {"constants": {"k": "3"}, "solutions": 0, "seconds": 60, "candidates": 0, "trace": 200, "seed": 0},
        "instances": [{k: v for k, v in i.items() if k != "data"} for i in MM_INSTANCES],
        "variants": [
            {"name": "reference", "swap": {}, "constants": {}, "loop": {"language": "loop", "text": MM_LOOP_BLOCK}},
            {"name": "first-clique", "swap": {}, "constants": {}, "loop": {"language": "loop", "text": MM_LOOP_FIRST}},
            {"name": "lift", "swap": {}, "constants": {}, "loop": {"language": "loop", "text": MM_LOOP_LIFT}},
        ],
        "library": {
            "id": "aspq-minmax-clique", "group": "logic",
            "summary": "Minmax Clique as ASP(Q): the picks of one block per row that leave no k-clique, refuted by the clique over the fewest rows (6 of 8 picks).",
            "shape": "custom", "tags": ["fast", "aspq"], "expected": 6, "level": 3, "after": 13,
        },
    }


def text(project):
    return json.dumps(project, indent=2, ensure_ascii=False) + "\n"


BUILDERS = (("aspq", aspq, ASPQ_INSTANCES), ("aspq-deep", aspq_deep, DEEP_INSTANCES), ("aspq-minmax-clique", aspq_minmax, MM_INSTANCES))

if __name__ == "__main__":
    args = sys.argv[1:]
    check = "--check" in args
    qdir = args[args.index("--qasp") + 1] if "--qasp" in args else None
    bad = 0
    for name, build, insts in BUILDERS:
        path = os.path.join(ROOT, "examples", "contrib", name + ".json")
        new = text(build())
        if qdir:
            d = os.path.join(qdir, name)
            os.makedirs(d, exist_ok=True)
            for i in insts:
                prog = i["program"] if "program" in i else mm_program(i["data"])
                open(os.path.join(d, i["id"] + ".aspq"), "w").write(prog)
        if check:
            old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
            if old != new:
                print(f"{path} differs from tools/make-aspq.py"); bad = 1
        elif not qdir:
            open(path, "w", encoding="utf-8").write(new)
            print("wrote", path)
    sys.exit(bad)
