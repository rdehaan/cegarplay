# Ground truth: enumerate ALL candidates of the abstraction and check each one on its own,
# with no refinement at all.  A candidate is a solution iff the check program is unsatisfiable.
import sys, re, time
from clingo import Control, Function
text = open(sys.argv[1]).read()
parts = {"shared": "", "guess": "", "glue": "", "check": ""}
cur, last = "guess", 0
for m in re.finditer(r"#program\s+([a-z_]+)\s*\.\s*", text):
    parts[cur] += text[last:m.start()]; cur = "guess" if m.group(1) == "base" else m.group(1); last = m.end()
parts[cur] += text[last:]
g = Control(["1"]); g.add("base", [], parts["shared"] + parts["glue"]); g.ground([("base", [])])
glue = set()
g.solve(on_model=lambda m: glue.update(str(a) for a in m.symbols(shown=True)))
a = Control(["0"]); a.add("base", [], parts["shared"] + parts["guess"]); a.ground([("base", [])])
c = Control(["--heuristic=Domain"])
pairs = []
with c.backend() as b:
    for atom in a.symbolic_atoms:
        if str(atom.symbol) in glue:
            d = b.add_atom(atom.symbol)
            if atom.is_fact: b.add_rule([d], [])
            else: b.add_rule([d], [], True); pairs.append((atom.literal, d))
c.add("base", [], parts["shared"] + parts["check"]); c.ground([("base", [])])
cands = []
a.solve(on_model=lambda m: cands.append([m.is_true(l) for l, _ in pairs]))
t0 = time.time(); good = 0
for v in cands:
    if c.solve(assumptions=[d if t else -d for t, (_, d) in zip(v, pairs)]).unsatisfiable: good += 1
print(f"candidates={len(cands)} distinct_on_glue={len(set(map(tuple, cands)))} solutions={good} (checked in {time.time()-t0:.1f}s)")
