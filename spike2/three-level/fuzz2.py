from utik import *
import random, re, time
from math import comb
random.seed(7)
MINPACK = "% A reply with few items gives a short clause for the attacker.\n#minimize { 1,I : pack(I) }.\n"
MAXATT  = "% Prefer large attacks: they succeed more often.\n#heuristic attack(I) : item(I,_,_). [1,true]\n"
variants = {
  "clause":        dict(loop=LOOP_CLAUSE.format(bopt="", copt="", opt="")),
  "block":         dict(loop=LOOP_BLOCK.format(bopt="", copt="")),
  "clause+tuned":  dict(loop=LOOP_CLAUSE.format(bopt='   options "--heuristic=Domain"', copt="", opt=", optimal"),
                        extra_attacker=MAXATT, extra_packer=MINPACK),
}
bad = 0; n = 0; done = 0
stats = {k: [0,0,0] for k in variants}
t0=time.time()
while done < 60:
    k = random.randint(6, 9)
    items = {i: (random.randint(1, 9), random.randint(1, 15)) for i in range(1, k + 1)}
    fb, ab = random.randint(1, 3), random.randint(1, 3)
    cap = random.randint(6, max(7, sum(w for w, _ in items.values()) // 2))
    total = sum(comb(k, r) for r in range(fb + 1))
    goals = [g for g in range(1, sum(p for _, p in items.values())) if 0 < len(brute(items, fb, ab, cap, g)) < total]
    if not goals: continue
    goal = random.choice(goals)
    bf = brute(items, fb, ab, cap, goal)
    done += 1
    for nm, v in variants.items():
        s, o, summ, r = run(project(items, fb, ab, cap, goal, **v))
        n += 1
        ok = (s == bf) and ("exhausted: true" in o)
        m = re.search(r"candidates: (\d+); counterexamples: (\d+); clauses: (\d+)", summ)
        if m:
            for j in range(3): stats[nm][j] += int(m.group(j+1))
        if not ok:
            bad += 1
            print("MISMATCH", nm, items, fb, ab, cap, goal, len(s), len(bf), o, summ, r.stdout[-500:], r.stderr[-500:])
print("nontrivial instances", done, "runs", n, "mismatches", bad, "time %.0fs" % (time.time()-t0))
print("totals (candidates, witnesses found by C, clauses):", stats)
