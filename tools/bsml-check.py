#!/usr/bin/env python3
"""Brute-force checks of the two BSML examples (needs Python clingo for parsing and the proof search).

    python3 tools/bsml-check.py models [N]          # bsml-entailment, every instance, models with <= N worlds
    python3 tools/bsml-check.py rules [LINES] [K]   # bsml-proofs: K random derivations per rule, LINES lines

models: evaluates support and anti-support (Aloni, Anttila and Yang 2024, Definition 2.3)
directly on every model with at most N worlds (default 2) and every state, with the same
restrictions as the abstraction (no junk worlds, the instance's conditions), and counts the
countermodels: a state that supports every premise but not the conclusion. An instance passes
when a countermodel exists exactly when its expected count is 1 (the default loop stops at the
first). `node tools/run.mjs bsml-entailment --variant any-countermodel` without its 'stop' gives
the counts themselves (with -c n=N).

rules: for each rule of the proof system, grounds the proof program of bsml-proofs without a
goal for LINES lines (default 4), asks for K derivations (default 200) whose last line uses the
rule, and checks every line semantically: its formula must hold in every state of every model
with at most 2 worlds that supports the assumptions it depends on. A failure prints the line
and the derivation.
"""
import itertools, json, os, re, sys
from functools import lru_cache
import clingo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def project(name):
    return json.load(open(os.path.join(ROOT, "examples", "contrib", name + ".json"), encoding="utf-8"))


def term(sym):
    if sym.type == clingo.SymbolType.Function and sym.arguments:
        return (sym.name,) + tuple(term(a) for a in sym.arguments)
    return sym.name


def enrich(f):  # the pragmatic enrichment [f]+
    if isinstance(f, str):
        return "bot" if f == "bot" else ("and", f, "ne")
    if f[0] == "neg":
        return ("and", ("neg", enrich(f[1])), "ne")
    if f[0] in ("dia", "box"):
        return ("and", (f[0], enrich(f[1])), "ne")
    return ("and", (f[0], enrich(f[1]), enrich(f[2])), "ne")


def subsets(xs):
    xs = list(xs)
    for r in range(len(xs) + 1):
        for c in itertools.combinations(xs, r):
            yield frozenset(c)


def support(val, rel):
    """sup(f, s, True): s supports f; sup(f, s, False): s anti-supports f."""
    succ = {}
    for (u, v) in rel:
        succ.setdefault(u, set()).add(v)
    R = lambda w: frozenset(succ.get(w, ()))

    @lru_cache(None)
    def sup(f, s, pos):
        if isinstance(f, str):
            if f == "bot":
                return not s if pos else True
            if f == "ne":
                return bool(s) if pos else not s
            return all(((w, f) in val) == pos for w in s)
        op = f[0]
        if op == "neg":
            return sup(f[1], s, not pos)
        if op == "empty":
            return (sup(f[1], s, True) or not s) if pos else sup(f[1], s, False)
        if op in ("and", "or"):
            if (op == "and") == pos:
                return sup(f[1], s, pos) and sup(f[2], s, pos)
            return any(sup(f[1], t, pos) and sup(f[2], u, pos)
                       for t in subsets(s) for u in subsets(s) if t | u == s)
        if op == "gor":
            if pos:
                return sup(f[1], s, True) or sup(f[2], s, True)
            return sup(f[1], s, False) and sup(f[2], s, False)
        if (op == "dia") == pos:  # dia supported, box anti-supported: a nonempty part of R[w]
            return all(any(t and sup(f[1], t, pos) for t in subsets(R(w))) for w in s)
        return all(sup(f[1], R(w), pos) for w in s)  # all of R[w]
    return sup


def models(props, n):
    W = range(1, n + 1)
    pairs = [(u, v) for u in W for v in W]
    vals = [(w, p) for w in W for p in props]
    for rel in subsets(pairs):
        for val in subsets(vals):
            yield val, rel


def reach(s, rel):
    out, todo = set(s), list(s)
    while todo:
        w = todo.pop()
        for (u, v) in rel:
            if u == w and v not in out:
                out.add(v); todo.append(v)
    return out


def count_countermodels(facts, n):
    props, prem, conc, cond = [], [], [], []
    for m in re.finditer(r"^(\w+)\((.*)\)\.\s*$", facts, re.M):
        name, arg = m.group(1), m.group(2)
        if name == "prop":
            props += arg.split(";")
            continue
        f = term(clingo.parse_term(arg))
        if isinstance(f, tuple) and f[0] == "plus":
            f = enrich(f[1])
        {"premise": prem, "conclusion": conc, "condition": cond}[name].append(f)
    W = range(1, n + 1)
    count = 0
    for val, rel in models(props, n):
        sup = support(val, rel)
        for s in subsets(W):
            seen = reach(s, rel)
            # no junk: every world, arrow and true atom is reachable from s; reachable worlds first
            if any(u not in seen for (u, _) in rel) or any(w not in seen for (w, _) in val):
                continue
            if any(w > 1 and w in seen and w - 1 not in seen for w in W):
                continue
            if "indisputable" in cond and any((u, v) in rel and (x, v) not in rel for u in s for x in s for v in W):
                continue
            if "state_based" in cond and any(((u, v) in rel) != (v in s) for u in s for v in W):
                continue
            if all(sup(f, s, True) for f in prem) and not all(sup(f, s, True) for f in conc):
                count += 1
    return count


def check_models(n):
    bad = 0
    for x in project("bsml-entailment")["instances"]:
        c = count_countermodels(x["facts"], n)
        want = x["expected"]["solutions"]
        ok = (c > 0) == (want == 1)
        bad += not ok
        print(f"{x['id']}: {c} countermodels with at most {n} worlds; expected {want}: {'ok' if ok else 'MISMATCH'}")
    return bad


# Formulas that give every rule something to work on: the conclusions of the rules are
# often not subformulas of the premises, so the universe needs them as lemmas.
RULE_LEMMAS = """
lemma(gor(dia(and(p,ne)),box(neg(or(p,q))))). lemma(neg(and(or(p,bot),and(neg(q),ne)))).
lemma(dia(gor(p,and(q,ne)))). lemma(or(and(bot,ne),neg(dia(neg(p))))). lemma(box(gor(p,neg(q)))).
lemma(or(p,gor(q,ne))). lemma(neg(or(p,neg(q)))). lemma(box(and(p,ne))). lemma(or(p,or(q,bot))).
lemma(neg(neg(p))). lemma(or(neg(p),neg(q))). lemma(neg(and(p,q))). lemma(and(neg(p),neg(q))).
lemma(neg(or(p,q))). lemma(or(p,p)). lemma(or(q,p)). lemma(or(or(p,q),bot)). lemma(or(bot,p)).
lemma(box(neg(p))). lemma(neg(dia(p))). lemma(neg(dia(neg(p)))). lemma(box(p)). lemma(dia(q)).
lemma(dia(or(p,and(q,ne)))). lemma(gor(or(p,q),or(p,ne))). lemma(neg(gor(p,q))). lemma(neg(ne)).
lemma(dia(gor(p,q))). lemma(or(dia(p),dia(q))). lemma(box(gor(p,q))). lemma(or(box(p),box(q))).
lemma(gor(bot,ne)). lemma(box(gor(bot,ne))). lemma(dia(or(p,q))). lemma(box(or(p,q))).
lemma(or(p,neg(p))). lemma(neg(or(p,ne))). lemma(and(neg(p),neg(ne))). lemma(empty(and(p,ne))).
"""


def check_rules(lines, k):
    p = project("bsml-proofs")
    frag = {f["name"]: f["text"] for f in p["fragments"]}
    base, part = frag["proof"].split("#program line(i).")
    # no goal, and redundant lines allowed: any derivation is fine
    part = part.replace(":- goal(i), J = 1..i-1", "% :- goal(i), J = 1..i-1")
    part = part.replace(":- J = 1..i-1, f(i, F), f(J, F)", "% :- J = 1..i-1, f(i, F), f(J, F)")
    rules = [term(a.arguments[0]) for a in
             clingo_atoms(frag["shared"] + base, "rule_refs", 2)]
    worlds = [(val, rel, frozenset(s)) for val, rel in models(["p", "q"], 2) for s in subsets(range(1, 3))]
    bad = total = 0
    for rule in rules:
        ctl = clingo.Control(["--rand-freq=1", "--seed=1", "--opt-mode=ignore", str(k), "--warn=none"])
        ctl.add("base", [], frag["shared"] + "prop(p;q).\n" + RULE_LEMMAS + base)
        ctl.add("line", ["i"], part + f"\n:- i == {lines}, not rule(i, {rule}).\n")
        ctl.ground([("base", [])])
        for t in range(1, lines + 1):
            ctl.ground([("line", [clingo.Number(t)])])
        done, n = set(), 0
        with ctl.solve(yield_=True) as h:
            for m in h:
                n += 1
                f, dep = {}, {}
                for a in m.symbols(atoms=True):
                    if a.name == "f" and len(a.arguments) == 2:
                        f[a.arguments[0].number] = term(a.arguments[1])
                    elif a.name == "dep" and len(a.arguments) == 2:
                        dep.setdefault(a.arguments[0].number, set()).add(a.arguments[1].number)
                for i, g in f.items():
                    prem = tuple(sorted({f[h] for h in dep.get(i, ())}, key=str))
                    if (prem, g) in done:
                        continue
                    done.add((prem, g))
                    for val, rel, s in worlds:
                        sup = support(val, rel)
                        if all(sup(x, s, True) for x in prem) and not sup(g, s, True):
                            bad += 1
                            print(f"UNSOUND {rule}: line {i}: {prem} does not entail {g} (state {set(s)}, valuation {set(val)}, relation {set(rel)})")
                            print("   ", " ".join(str(a) for a in m.symbols(shown=True)))
                            break
        total += n
        print(f"{rule}: {n} derivations, {len(done)} sequents")
    print(f"{total} derivations, {bad} unsound lines")
    return bad


def clingo_atoms(program, name, arity):
    ctl = clingo.Control(["--warn=none"])
    ctl.add("base", [], program)
    ctl.ground([("base", [])])
    return [a.symbol for a in ctl.symbolic_atoms.by_signature(name, arity)]


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] not in ("models", "rules"):
        print(__doc__); sys.exit(2)
    if args[0] == "models":
        sys.exit(1 if check_models(int(args[1]) if len(args) > 1 else 2) else 0)
    sys.exit(1 if check_rules(int(args[1]) if len(args) > 1 else 4, int(args[2]) if len(args) > 2 else 200) else 0)
