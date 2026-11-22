"""Audit prototype: for a project with one abstraction, one check and one link, test EVERY
(candidate, counterexample) pair of the instance against the solution set."""
import json, re, subprocess, sys
RUN = "../../cegarplay/tools/run.mjs"
LUA = r'''
local A = rt.solver("A", {%(fa)s}, {%(oa)s})
local C = rt.solver("C", {%(fc)s}, {%(oc)s})
local G = rt.link("G", A, C, {%(fg)s}, {%(lo)s})
rt.prepare()
local LIMIT = %(limit)d
local function bits(v) local t = {} for j = 1, G.n do t[j] = v[j] and "1" or "0" end return table.concat(t) end
local names = {} for j = 1, G.n do names[j] = G.str[j] end
rt.log("ATOMS", table.concat(names, " "))
-- 1. every candidate: the models of the unrefined abstraction, one per interface assignment
local all = A:models{ limit = LIMIT + 1 }
if #all > LIMIT then rt.stop("more than " .. LIMIT .. " candidates: audit a smaller instance") end
local cands, seen = {}, {}
for _, M in ipairs(all) do local b = bits(M[G]); if not seen[b] then seen[b] = true; cands[#cands + 1] = M end end
-- 2. every counterexample of every candidate, one per distinct relevant set
local sols, pairs_, ncex, empty = {}, {}, 0, nil
for _, M in ipairs(cands) do
  local Xs = C:models{ assume = G:of(M) }
  if #Xs == 0 then sols[#sols + 1] = M
  else
    local rs = {}
    for _, X in ipairs(Xs) do
      ncex = ncex + 1
      local b = bits(X[G])
      if not rs[b] then rs[b] = true; pairs_[#pairs_ + 1] = { M = M, X = X } end
      if not b:find("1") and not empty then empty = { M = M, X = X } end
    end
  end
end
local cb, sb = {}, {}
for i, M in ipairs(cands) do cb[i] = bits(M[G]) end
for i, M in ipairs(sols) do sb[i] = bits(M[G]) end
rt.log("CANDS", table.concat(cb, " "))
rt.log("SOLS", table.concat(sb, " "))
rt.log("COUNTS", #cands, #sols, ncex, #pairs_)
if empty then rt.log("EMPTY", bits(empty.M[G]), tostring(empty.X.shown)) end
-- 3. a pair is unsound when a solution agrees with its candidate on the relevant atoms
local bad, best = 0, nil
for _, p in ipairs(pairs_) do
  local m, r = p.M[G], p.X[G]
  for _, S in ipairs(sols) do
    local s, agree, diff = S[G], true, 0
    for j = 1, G.n do
      if m[j] ~= s[j] then if r[j] then agree = false; break end; diff = diff + 1 end
    end
    if agree then
      bad = bad + 1
      if not best or diff < best.diff then best = { M = p.M, X = p.X, S = S, diff = diff } end
      break
    end
  end
end
rt.log("UNSOUND_PAIRS", bad)
if best then rt.log("WITNESS", bits(best.M[G]), bits(best.X[G]), bits(best.S[G]), "|", tostring(best.X.shown)) end
'''
def q(names): return ", ".join('"%s"' % n for n in names)
def audit(proj, limit=6000, consts=None, name="/tmp/audit.json"):
    text = proj["loop"]["text"]
    sv = dict((m.group(1), (re.split(r"\s*\+\s*", m.group(2).strip()), (m.group(4) or "").split()))
              for m in re.finditer(r'^solver\s+(\w+)\s*=\s*([\w\s+]+?)(\s+options\s+"([^"]*)")?\s*$', text, re.M))
    links = re.findall(r'^link\s+(\w+)\s*=\s*(\w+)\s*->\s*(\w+)\s+via\s+([\w\s+]+?)(\s+(?:legacy|compat))*\s*$', text, re.M)
    if len(sv) != 2 or len(links) != 1: return None
    _, a, c, glue, flags = links[0]
    lo = "legacy = true" if "legacy" in text.split("via")[1].split("\n")[0] else ""
    p = json.loads(json.dumps(proj)); p.pop("library", None)
    p["loop"] = {"language": "lua", "text": LUA % dict(fa=q(sv[a][0]), oa=q(sv[a][1]), fc=q(sv[c][0]), oc=q(sv[c][1]),
                                                        fg=q(re.split(r"\s*\+\s*", glue.strip())), lo=lo, limit=limit)}
    p["settings"].update(solutions=0, seconds=120, trace=10**7)
    if consts: p["settings"]["constants"].update(consts)
    json.dump(p, open(name, "w"))
    r = subprocess.run(["node", RUN, name, "--solutions", "all", "--trace", "100000"], capture_output=True, text=True)
    out = {}
    for line in r.stdout.splitlines():
        if line.startswith("log: "):
            k, _, v = line[5:].partition(" "); out[k] = v
        if line.startswith("Outcome:"): out["outcome"] = line
        if line.startswith("error"): out["error"] = line
    return out
def names(atoms, bitstr, value="1"): return [a for a, b in zip(atoms, bitstr) if b == value]
def report(id, out):
    if out is None: return f"{id}: skipped (not one abstraction, one check, one link)"
    if "COUNTS" not in out: return f"{id}: no verdict ({out.get('outcome','')[:90]} {out.get('error','')[:120]})"
    atoms = out["ATOMS"].split(); nc, ns, ncex, npairs = map(int, out["COUNTS"].split())
    s = f"{id}: {nc} candidates, {ns} solutions, {ncex} counterexamples, {npairs} distinct (candidate, relevant set) pairs; "
    if out.get("EMPTY"): s += "a counterexample with no relevant atom exists; "
    bad = int(out.get("UNSOUND_PAIRS", "0"))
    if bad == 0: return s + "SOUND for every pair"
    m, r, sol, _, shown = out["WITNESS"].split(" ", 4)
    diff = [a for a, x, y in zip(atoms, m, sol) if x != y]
    return s + (f"UNSOUND: {bad} pairs. Witness: candidate {{{' '.join(names(atoms, m))}}}, counterexample [{shown}], "
                f"relevant {{{' '.join(names(atoms, r))}}}, lost solution {{{' '.join(names(atoms, sol))}}}; they differ only on {{{' '.join(diff)}}}")
if __name__ == "__main__":
    lib = json.load(open("../../cegarplay/examples/library.json"))
    ids = sys.argv[1:] or [e["id"] for e in lib["examples"] if "fast" in e.get("tags", []) and e["group"] in ("tutorial", "exists-forall", "problems", "shapes", "language")]
    for id in ids:
        proj = json.load(open(f"../../cegarplay/examples/{id}.json"))
        if proj["loop"]["language"] != "loop" or "G.clause(" not in proj["loop"]["text"].replace(" ", "").replace("clause(M,X)", "clause(") and ".clause(" not in proj["loop"]["text"]:
            print(f"{id}: skipped (no clause refinement in a loop script)"); continue
        print(report(id, audit(proj)))
