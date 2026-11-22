"""Fuzz, shrink, diagnose: the Direction 1 pipeline end to end on the unsound guide example."""
import json, subprocess, sys, re, time
sys.path.insert(0, "../gen")
from generate import generate
from audit import audit, report
RUN = "../../cegarplay/tools/run.mjs"
BASE = json.load(open("../../cegarplay/examples/guide-04-one-node.json"))
GEN = """node(1..n).
edge(X,Y) :- node(X), node(Y), X < Y, @flip(p, X, Y) = 1.
#show node/1.  #show edge/2.
"""
runs = 0
def project(facts, reference=False):
    p = json.loads(json.dumps(BASE))
    for f in p["fragments"]:
        if f["name"] == "shared": f["text"] = " ".join(facts) + "\n"
    if reference: p["loop"]["text"] = p["loop"]["text"].replace("G.clause(M, X)", "G.block(M)")
    return p
def count(facts, reference=False, events=False):
    global runs; runs += 1
    json.dump(project(facts, reference), open("/tmp/fz.json", "w"))
    r = subprocess.run(["node", RUN, "/tmp/fz.json", "--solutions", "all", "--json", "--trace", "100000"], capture_output=True, text=True)
    ev = [json.loads(l) for l in r.stdout.splitlines() if l.startswith("{")]
    d = [e["data"] for e in ev if e["kind"] == "D"][-1]
    assert d["outcome"] == "finished" and d["exhausted"] is True, d
    n = sum(1 for e in ev if e["kind"] == "M")
    return (n, ev) if events else n
def schema_ok(facts):                       # every edge joins two declared nodes
    nodes = {int(m.group(1)) for f in facts for m in [re.match(r"node\((\d+)\)\.", f)] if m}
    return all(int(a) in nodes and int(b) in nodes for f in facts for m in [re.match(r"edge\((\d+),(\d+)\)\.", f)] if m for a, b in [m.groups()])
def fails(facts):
    return schema_ok(facts) and count(facts) != count(facts, reference=True)
def ddmin(facts):                           # Zeller's delta debugging on the list of facts
    n = 2
    while len(facts) >= 2:
        size = max(1, len(facts) // n); chunks = [facts[i:i + size] for i in range(0, len(facts), size)]
        for i in range(len(chunks)):
            rest = [f for j, c in enumerate(chunks) if j != i for f in c]
            if rest and fails(rest):
                facts, n = rest, max(n - 1, 2); break
        else:
            if n >= len(facts): break
            n = min(len(facts), n * 2)
    return facts
t0 = time.time(); found = None; tried = 0
for n in range(4, 9):                       # smallest parameters first
    for seed in range(1, 9):
        g = generate(GEN, {"n": n, "p": 500}, seed); facts = g["facts"].split(); tried += 1
        a, b = count(facts), count(facts, reference=True)
        if a != b: found = (n, seed, facts, a, b); break
    if found: break
n, seed, facts, a, b = found
print(f"fuzz: instance {tried} (n={n}, p=500, seed={seed}, {sum(f.startswith('edge') for f in facts)} edges) gives {a} solutions with the loop and {b} with the reference run")
small = ddmin(facts)
a, b = count(small), count(small, reference=True)
print(f"shrink: {len(facts)} facts -> {len(small)} facts: {' '.join(small)}  ({a} against {b} solutions)")
print("audit of the shrunk instance:", report("shrunk", audit(project(small))))
# diagnosis from the recorded run: the first refinement that a true solution violates
aud = audit(project(small)); atoms = aud["ATOMS"].split(); idx = {t: j for j, t in enumerate(atoms)}; sols = set(aud["SOLS"].split())
_, ev = count(small, events=True)
got = {"".join("1" if t in e["data"]["atoms"].split() else "0" for t in atoms) for e in ev if e["kind"] == "M"}
lost = sorted(sols - got)
for st in (e["data"] for e in ev if e["kind"] == "T"):
    lits = [(idx[l.lstrip("-")], "0" if l.startswith("-") else "1") for l in st["literals"]]
    hit = [s for s in lost if all(s[j] != v for j, v in lits)]
    if hit:
        show = lambda s: "{" + " ".join(t for t, x in zip(atoms, s) if x == "1") + "}"
        print(f"diagnosis: step {st['i']}: candidate [{st['candidate']}], counterexample [{st['counterexample']}], clause {st['literals']} removes the solution {show(hit[0])}")
        break
print(f"engine runs: {runs}, wall time {time.time() - t0:.0f} s")
json.dump({"facts": " ".join(small), "expected": {"solutions": b}, "tags": ["regression"],
           "found_by": {"generator": "gnp", "params": {"n": n, "p": 500}, "seed": seed}}, open("regression-instance.json", "w"), indent=1)
