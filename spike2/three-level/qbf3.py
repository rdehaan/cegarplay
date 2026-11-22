import json, itertools, subprocess, random, re, time
OUTER = """{ x(I) } :- xvar(I).
#show x/1.
{ always }.
:- not always.
"""
GLUE_X = "glue(x(I)) :- xvar(I).\nglue(always).\n"
MIDDLE = """{ y(J) } :- yvar(J).
#show y/1.
"""
GLUE_XY = "glue(x(I)) :- xvar(I).\nglue(y(J)) :- yvar(J).\nglue(always).\n"
INNER = """{ z(K) } :- zvar(K).
zsat(C) :- zlit(C,K,1), z(K).
zsat(C) :- zlit(C,K,0), not z(K).
good(C,x(I)) :- xlit(C,I,1), x(I).
good(C,x(I)) :- xlit(C,I,0), not x(I).
good(C,y(J)) :- ylit(C,J,1), y(J).
good(C,y(J)) :- ylit(C,J,0), not y(J).
ok(C) :- zsat(C).
ok(C) :- good(C,_).
:- clause(C), not ok(C), always.
#show z/1.
relevant(T) :- good(C,T), not zsat(C).
open :- clause(C), not zsat(C).
relevant(always) :- not open.
"""
DECL = """solver A = shared + outer
solver B = shared + middle
solver C = shared + inner
link GX  = A -> B via shared + glue_x
link GXY = B -> C via shared + glue_xy
link GXC = A -> C via shared + glue_x
"""
LOOP = DECL + """
search A:
    on candidate M:
        loop:
            Y = B.solve(assume GX(M))
            if not Y: break
            W = C.solve(assume GXY(Y))
            if W:
                B.add(GXY.clause(Y, W))
            else:
                reject M with GXC.core(C)
                break
"""
def project(nx, ny, nz, clauses, loop=LOOP):
    f = [f"xvar(1..{nx}). yvar(1..{ny}). zvar(1..{nz})."]
    for c, lits in enumerate(clauses, 1):
        f.append(f"clause({c}).")
        for (blk, v, s) in lits: f.append(f"{blk}lit({c},{v},{s}).")
    return {"format": "cegarplay", "version": 1, "title": "3QBF", "description": "",
            "fragments": [{"name": "shared", "text": " ".join(f) + "\n"},
                          {"name": "outer", "text": OUTER}, {"name": "glue_x", "text": GLUE_X},
                          {"name": "middle", "text": MIDDLE}, {"name": "glue_xy", "text": GLUE_XY},
                          {"name": "inner", "text": INNER}],
            "loop": {"language": "loop", "text": loop},
            "settings": {"constants": {}, "solutions": 0, "seconds": 120, "candidates": 0, "trace": 0, "seed": 0}}
def brute(nx, ny, nz, clauses):
    sols = set()
    def val(a, blk, v, s): return a[blk][v-1] == bool(s)
    for X in itertools.product([False, True], repeat=nx):
        good = True
        for Y in itertools.product([False, True], repeat=ny):
            if not any(all(any(val({'x':X,'y':Y,'z':Z}, *l) for l in c) for c in clauses)
                       for Z in itertools.product([False, True], repeat=nz)):
                good = False; break
        if good: sols.add(frozenset(i+1 for i in range(nx) if X[i]))
    return sols
def run(proj, name="tmpq.json"):
    json.dump(proj, open(name, "w"), indent=1)
    r = subprocess.run(["node", "../../cegarplay/tools/run.mjs", name, "--solutions", "all"], capture_output=True, text=True)
    sols, summary, outcome = set(), "", ""
    for line in r.stdout.splitlines():
        if line.startswith("Solution "):
            atoms = line.split(":", 1)[1].split()
            sols.add(frozenset(int(a[2:-1]) for a in atoms if a.startswith("x(")))
        elif line.startswith("Solutions:"): summary = line
        elif line.startswith("Outcome:"): outcome = line
    return sols, outcome, summary, r
if __name__ == "__main__":
    random.seed(3)
    bad = 0; kinds = {"none":0, "all":0, "some":0}; t0=time.time(); tot=[0,0,0]
    for t in range(80):
        nx, ny, nz = random.randint(2,4), random.randint(2,3), random.randint(2,3)
        m = random.randint(4, 10)
        clauses = []
        for _ in range(m):
            k = random.randint(2,3); lits = []
            for _ in range(k):
                blk = random.choice("xyz"); n = {'x':nx,'y':ny,'z':nz}[blk]
                lits.append((blk, random.randint(1,n), random.randint(0,1)))
            clauses.append(lits)
        bf = brute(nx, ny, nz, clauses)
        kinds["none" if not bf else "all" if len(bf)==2**nx else "some"] += 1
        s, o, summ, r = run(project(nx, ny, nz, clauses))
        mm = re.search(r"candidates: (\d+); counterexamples: (\d+); clauses: (\d+)", summ)
        if mm:
            for j in range(3): tot[j]+=int(mm.group(j+1))
        if s != bf or "exhausted: true" not in o:
            bad += 1
            print("MISMATCH", nx, ny, nz, clauses, sorted(map(sorted,s)), sorted(map(sorted,bf)), o, summ, r.stdout[-600:], r.stderr[-300:])
    print("instances 80 mismatches", bad, kinds, "totals", tot, "time %.0fs"%(time.time()-t0))
