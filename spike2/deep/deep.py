import json, itertools, subprocess, random, re, sys, time
LUA = open("../deep/deep.lua").read()
this_level = "{ val(V) } :- var(V,this_level).\n#show val/1.\n"
GLUE = "glue(val(V)) :- var(V,B), B <= this_level.\n"
COMMON = "true(C) :- lit(C,V,1), val(V).\ntrue(C) :- lit(C,V,0), not val(V).\n"
INNER_E = COMMON + """% the last block is existential: it must satisfy every clause
:- clause(C), not true(C).
own(C) :- lit(C,V,1), val(V), var(V,this_level).
own(C) :- lit(C,V,0), not val(V), var(V,this_level).
relevant(val(V)) :- clause(C), not own(C), lit(C,V,1), val(V), var(V,B), B < this_level.
relevant(val(V)) :- clause(C), not own(C), lit(C,V,0), not val(V), var(V,B), B < this_level.
"""
INNER_A = COMMON + """% the last block is universal: it must falsify one clause
1 { bad(C) : clause(C) } 1.
:- bad(C), true(C).
relevant(val(V)) :- bad(C), lit(C,V,_), var(V,B), B < this_level.
"""
def project(blocks, clauses):
    depth = len(blocks); facts = [f"var({v},{b})." for b, vs in enumerate(blocks, 1) for v in vs]
    for c, lits in enumerate(clauses, 1):
        facts.append(f"clause({c}).")
        facts += [f"lit({c},{v},{s})." for v, s in lits]
    return {"format": "cegarplay", "version": 1, "title": f"QBF with {depth} blocks", "description": "",
            "fragments": [{"name": "shared", "text": " ".join(facts) + "\n"}, {"name": "level", "text": this_level},
                          {"name": "glue", "text": GLUE}, {"name": "inner_exists", "text": INNER_E}, {"name": "inner_forall", "text": INNER_A}],
            "loop": {"language": "lua", "text": LUA.replace("DEPTH", str(depth))},
            "settings": {"constants": {}, "solutions": 0, "seconds": 120, "candidates": 0, "trace": 0, "seed": 0}}
def brute(blocks, clauses):
    depth = len(blocks)
    def holds(a): return all(any(a[v] == bool(s) for v, s in c) for c in clauses)
    def win(i, a):          # does the player of block i (odd: wants true) have a winning move?
        if i > depth: return holds(a)
        res = []
        for vals in itertools.product([False, True], repeat=len(blocks[i - 1])):
            b = dict(a); b.update(zip(blocks[i - 1], vals))
            r = win(i + 1, b)
            if i % 2 == 1 and r: return True
            if i % 2 == 0 and not r: return False
        return i % 2 == 0
    sols = set()
    for vals in itertools.product([False, True], repeat=len(blocks[0])):
        a = dict(zip(blocks[0], vals))
        if win(2, a): sols.add(frozenset(v for v in blocks[0] if a[v]))
    return sols
def run(p, name="/tmp/deep.json"):
    json.dump(p, open(name, "w"))
    r = subprocess.run(["node", "../../cegarplay/tools/run.mjs", name, "--solutions", "all"], capture_output=True, text=True)
    sols, ok, calls = set(), False, ""
    for line in r.stdout.splitlines():
        if line.startswith("Solution "): sols.add(frozenset(int(a[4:-1]) for a in line.split(":", 1)[1].split()))
        if line.startswith("Outcome: finished"): ok = True
        if line.startswith("log: CALLS"): calls = line[11:]
    return sols, ok, calls, r
if __name__ == "__main__":
    random.seed(2026)
    for depth, count in ((2, 30), (3, 40), (4, 40), (5, 25)):
        bad = 0; kinds = {"none": 0, "some": 0, "all": 0}; t0 = time.time(); tot = [0] * (depth - 1)
        for t in range(count):
            sizes = [random.randint(2, 3) for _ in range(depth)]
            blocks, v = [], 1
            for s in sizes: blocks.append(list(range(v, v + s))); v += s
            nv = v - 1
            clauses = [[(random.randint(1, nv), random.randint(0, 1)) for _ in range(random.randint(2, 3))] for _ in range(random.randint(4, 4 + 2 * depth))]
            bf = brute(blocks, clauses)
            kinds["none" if not bf else "all" if len(bf) == 2 ** sizes[0] else "some"] += 1
            sols, ok, calls, r = run(project(blocks, clauses))
            if calls: tot = [a + int(b) for a, b in zip(tot, calls.split())]
            if sols != bf or not ok:
                bad += 1
                if bad <= 2: print("MISMATCH depth", depth, blocks, clauses, sorted(map(sorted, sols)), sorted(map(sorted, bf)), (r.stdout + r.stderr)[-260:])
        print(f"depth {depth}: {count} formulas, mismatches {bad}, {kinds}, solves per level 2..{depth}: {tot}, {time.time() - t0:.0f} s")
