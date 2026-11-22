import json, re, subprocess, sys
sys.path.insert(0, "../audit")
from audit import audit, q
TEMPLATE = open("../lift/lift.lua").read()
def lifted(proj, name="/tmp/lift.json"):
    text = proj["loop"]["text"]
    sv = dict((m.group(1), (re.split(r"\s*\+\s*", m.group(2).strip()), (m.group(4) or "").split()))
              for m in re.finditer(r'^solver\s+(\w+)\s*=\s*([\w\s+]+?)(\s+options\s+"([^"]*)")?\s*$', text, re.M))
    links = re.findall(r'^link\s+(\w+)\s*=\s*(\w+)\s*->\s*(\w+)\s+via\s+([\w\s+]+?)(\s+(?:legacy|compat))*\s*$', text, re.M)
    if len(sv) != 2 or len(links) != 1: return None
    _, a, c, glue, _ = links[0]
    lo = "legacy = true" if "legacy" in text.split("via")[1].split("\n")[0] else ""
    p = json.loads(json.dumps(proj)); p.pop("library", None)
    p["loop"] = {"language": "lua", "text": TEMPLATE % dict(fa=q(sv[a][0]), oa=q(sv[a][1]), fc=q(sv[c][0]), oc=q(sv[c][1]),
                                                             fg=q(re.split(r"\s*\+\s*", glue.strip())), lo=lo)}
    p["settings"].update(solutions=0, seconds=300)
    json.dump(p, open(name, "w"))
    r = subprocess.run(["node", "../../cegarplay/tools/run.mjs", name, "--solutions", "all", "--quiet"], capture_output=True, text=True)
    out = {"raw": (r.stdout + r.stderr)[-600:]}
    for line in r.stdout.splitlines():
        if line.startswith("log: "):
            k, _, v = line[5:].partition(" "); out[k] = v
        if line.startswith("Solutions:"): out["solutions"] = int(re.search(r"Solutions: (\d+)", line).group(1))
        if line.startswith("Outcome:"): out["outcome"] = line
    return out
if __name__ == "__main__":
    for id in sys.argv[1:]:
        proj = json.load(open(f"../../cegarplay/examples/{id}.json"))
        o = lifted(proj)
        if not o or "LIFT" not in o: print(id, "FAILED", o and o["raw"]); continue
        n, lf, hd, ok, bad, t, fb = o["LIFT"].split()
        g = o["GROUND"].split()
        truth = int(audit(proj)["COUNTS"].split()[1])
        n = int(n)
        print(f"{id}: solutions {o['solutions']} (audit {truth}) {'OK' if o['solutions']==truth else 'MISMATCH'}; ground rules {g[0]} ({g[1]} weight), disjunctive {g[3]}; "
              f"{n} refinements; mean lifted {int(lf)/max(n,1):.2f}, mean hand-written {int(hd)/max(n,1):.2f}; hand-written certified {ok}, not {bad}; block fallbacks {fb}; lifting time {t} s")
