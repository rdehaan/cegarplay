"""Fate numbers of one recorded run: what each refinement removes from the candidate space."""
import json, subprocess, sys
from audit import audit
def fate(id, consts=None):
    proj = json.load(open(f"../../cegarplay/examples/{id}.json"))
    a = audit(proj, consts=consts)
    atoms = a["ATOMS"].split(); idx = {t: j for j, t in enumerate(atoms)}
    cands = a["CANDS"].split(); sols = set(a["SOLS"].split())
    extra = [x for k, v in (consts or {}).items() for x in ("-c", f"{k}={v}")]
    r = subprocess.run(["node", "../../cegarplay/tools/run.mjs", f"../../cegarplay/examples/{id}.json",
                        "--solutions", "all", "--json", "--trace", "100000", *extra], capture_output=True, text=True)
    ev = [json.loads(l) for l in r.stdout.splitlines() if l.startswith("{")]
    steps = [e["data"] for e in ev if e["kind"] == "T" and e["data"]["kind"] in ("reject", "add")]
    found = sum(1 for e in ev if e["kind"] == "M")
    reported = [" ".join(sorted(a for a in e["data"]["atoms"].split() if a in idx)) for e in ev if e["kind"] == "M"]
    alive = set(cands); rows = []; first_bad = None; dead_hits = 0
    for st in steps:
        lits = [(idx[l.lstrip("-")], "0" if l.startswith("-") else "1") for l in st["literals"]]
        # the clause removes the candidates that falsify every literal
        gone = {c for c in cands if all(c[j] != v for j, v in lits)}
        new = gone & alive
        lost = new & sols
        # a full-length clause on a candidate that was just reported is the block of an accepted solution
        if len(lits) == len(atoms) and " ".join(sorted((st["candidate"] or "").split())) in reported: lost = set()
        if lost and first_bad is None: first_bad = (st["i"], st["candidate"], st.get("counterexample"), st["literals"], len(lost))
        rows.append((st["i"], len(st["literals"]), len(gone), len(new), len(lost)))
        dead_hits += len(gone) - len(new)
        alive -= new
    total_gone = sum(r[2] for r in rows)
    print(f"{id}: {len(cands)} candidates, {len(sols)} true solutions; the run made {len(steps)} refinements and reported {found} solutions")
    print("   step: literals, removed in all, newly removed, solutions among them")
    for r in rows[:8]: print(f"   {r[0]:>3}: {r[1]}, {r[2]}, {r[3]}, {r[4]}")
    print(f"   alive after the run: {len(alive)} (of which true solutions: {len(alive & sols)}); overlap: {dead_hits} of {total_gone} removals hit candidates already removed")
    if first_bad: print(f"   first unsound step: {first_bad[0]}: candidate [{first_bad[1]}], counterexample [{first_bad[2]}], clause {first_bad[3]} removes {first_bad[4]} solutions")
    else: print("   no refinement removes a solution")
if __name__ == "__main__":
    for id in sys.argv[1:]: fate(id)
