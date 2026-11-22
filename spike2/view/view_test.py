import json, subprocess
p = json.load(open("../../cegarplay/examples/guide-03-hit-clique.json"))
shared = [f for f in p["fragments"] if f["name"] == "shared"][0]["text"]
VIEW = '''#program scene.
draw(layout(graph)).
draw(node(V))   :- node(V).
draw(edge(U,V)) :- edge(U,V).

#program frame.
draw(attr(node(V), fill, deleted))        :- cand(del(V)).
draw(attr(node(V), fill, clique))         :- cex(q(V)).
draw(attr(edge(U,V), stroke, clique))     :- edge(U,V), cex(q(U)), cex(q(V)).
draw(emph(node(V)))                       :- lit(del(V), _).
draw(note("A triangle survives. One of its ringed nodes must be deleted.")) :- kind(reject).
draw(note("No triangle survives: a solution.")) :- kind(solution).
#show draw/1.
'''
r = subprocess.run(["node", "../../cegarplay/tools/run.mjs", "guide-03-hit-clique", "--solutions", "all", "--json", "--trace", "50"], capture_output=True, text=True)
T = [json.loads(l)["data"] for l in r.stdout.splitlines() if l.startswith("{") and json.loads(l)["kind"] == "T"]
st = T[2]
facts = [f"step({st['i']}).", f"kind({st['kind']})."] + [f"cand({a})." for a in (st["candidate"] or "").split()] \
      + [f"cex({a})." for a in (st["counterexample"] or "").split()] \
      + [f"lit({l.lstrip('-')},{'false' if l.startswith('-') else 'true'})." for l in st["literals"]]
prog = "#script (lua)\nfunction main(prg) prg:ground({{'base',{}},{'scene',{}},{'frame',{}}}) prg:solve() end\n#end.\n" + shared + "\n" + " ".join(facts) + "\n" + VIEW
open("/tmp/view.lp", "w").write(prog)
r2 = subprocess.run(["node", "../gen/engine.mjs", "/tmp/view.lp", "--outf=2", "-V0"], capture_output=True, text=True)
res = json.loads(r2.stdout)
marks = res["Call"][0]["Witnesses"][0]["Value"]
print("step facts:", " ".join(facts))
print(len(marks), "marks;", "result", res["Result"])
print("frame marks:", " ".join(m for m in marks if "attr" in m or "emph" in m or "note" in m))
# recording size on a long trace
r = subprocess.run(["node", "../../cegarplay/tools/run.mjs", "gc-shape1", "--solutions", "all", "--json", "--trace", "100000"], capture_output=True, text=True)
ev = [json.loads(l) for l in r.stdout.splitlines() if l.startswith("{")]
T = [e["data"] for e in ev if e["kind"] == "T"]
raw = sum(len(json.dumps(t, separators=(",", ":"))) for t in T)
import base64, gzip
atoms = sorted({l.lstrip("-") for t in T for l in t["literals"]}); idx = {a: i for i, a in enumerate(atoms)}
def compact(t):
    bits = 0
    for a in (t["candidate"] or "").split(): bits |= 1 << idx[a]
    return json.dumps({"i": t["i"], "k": t["kind"][0], "c": base64.b64encode(bits.to_bytes((len(atoms) + 7) // 8, "little")).decode().rstrip("="),
                       "x": t.get("counterexample"), "l": [(-1 if l.startswith("-") else 1) * (idx[l.lstrip("-")] + 1) for l in t["literals"]]}, separators=(",", ":"))
comp = [compact(t) for t in T]
print(f"gc-shape1 full trace: {len(T)} steps, {len(atoms)} interface atoms; today's T events {raw} bytes ({raw/len(T):.0f} per step); "
      f"compact form {sum(map(len, comp))} bytes ({sum(map(len, comp))/len(T):.0f} per step); gzip of compact lines {len(gzip.compress(chr(10).join(comp).encode()))} bytes")
