import json, itertools, subprocess, random, sys, os

SHARED = """% item(I,Weight,Profit): the defender can pack item I with this weight and profit.
% Fortifying or attacking an item costs one unit each (the unitary problem).
{items}
"""
DEFENDER = """% A candidate: at most fbudget fortified items.
{ fortify(I) : item(I,_,_) } fbudget.
#show fortify/1.
"""
GLUE_F = "glue(fortify(I)) :- item(I,_,_).\n"
ATTACKER = """% An attack: at most abudget items, none of them fortified.
{ attack(I) : item(I,_,_) } abudget.
:- attack(I), fortify(I).
#show attack/1.
% The attack stays possible as long as none of its items is fortified.
relevant(fortify(I)) :- attack(I).
"""
GLUE_A = "glue(attack(I)) :- item(I,_,_).\n"
PACKER = """% A reply: items that are not attacked, within the capacity, reaching the goal.
{ pack(I) : item(I,_,_) }.
:- pack(I), attack(I).
:- #sum { W,I : pack(I), item(I,W,_) } > capacity.
:- #sum { P,I : pack(I), item(I,_,P) } < goal.
#show pack/1.
% The reply stays possible as long as none of its items is attacked.
relevant(attack(I)) :- pack(I).
"""
DECL = """solver A = shared + defender
solver B = shared + attacker{bopt}
solver C = shared + packer{copt}
link GF = A -> B via shared + glue_f
link GA = B -> C via shared + glue_a
"""
LOOP_CLAUSE = DECL + """
if not C.solve(): stop "the goal is out of reach even without an attack"
search A:
    on candidate M:
        loop:
            Y = B.solve(assume GF(M))
            if not Y: break
            K = C.solve(assume GA(Y){opt})
            if K:
                B.add(GA.clause(Y, K))
            else:
                reject M with GF.clause(M, Y)
                break
"""
LOOP_BLOCK = DECL + """
if not C.solve(): stop "the goal is out of reach even without an attack"
search A:
    on candidate M:
        loop:
            Y = B.solve(assume GF(M))
            if not Y: break
            K = C.solve(assume GA(Y))
            if K:
                B.add(GA.block(Y))
            else:
                reject M with GF.block(M)
                break
"""

def project(items, fb, ab, cap, goal, loop, title="Knapsack fortification", extra_attacker="", extra_packer=""):
    facts = " ".join(f"item({i},{w},{p})." for i,(w,p) in items.items())
    return {
        "format": "cegarplay", "version": 1, "title": title,
        "description": "",
        "fragments": [
            {"name": "shared", "text": SHARED.format(items=facts)},
            {"name": "defender", "text": DEFENDER},
            {"name": "glue_f", "text": GLUE_F},
            {"name": "attacker", "text": ATTACKER + extra_attacker},
            {"name": "glue_a", "text": GLUE_A},
            {"name": "packer", "text": PACKER + extra_packer},
        ],
        "loop": {"language": "loop", "text": loop},
        "settings": {"constants": {"fbudget": str(fb), "abudget": str(ab), "capacity": str(cap), "goal": str(goal)},
                     "solutions": 0, "seconds": 120, "candidates": 0, "trace": 0, "seed": 0},
    }

def brute(items, fb, ab, cap, goal):
    ids = sorted(items)
    def can_pack(avail):
        # 0/1 knapsack: max profit within capacity
        best = {0: 0}
        for i in avail:
            w, p = items[i]
            nb = dict(best)
            for ww, pp in best.items():
                if ww + w <= cap and nb.get(ww + w, -1) < pp + p:
                    nb[ww + w] = pp + p
            best = nb
        return max(best.values()) >= goal
    sols = []
    for r in range(fb + 1):
        for F in itertools.combinations(ids, r):
            Fs = set(F)
            rest = [i for i in ids if i not in Fs]
            ok = True
            for a in range(min(ab, len(rest)) + 1):
                for At in itertools.combinations(rest, a):
                    As = set(At)
                    if not can_pack([i for i in ids if i not in As]):
                        ok = False; break
                if not ok: break
            if ok: sols.append(frozenset(F))
    return set(sols)

def run(proj, name="tmp.json", extra=()):
    with open(name, "w") as f: json.dump(proj, f, indent=2)
    r = subprocess.run(["node", "../../cegarplay/tools/run.mjs", name, "--solutions", "all", *extra],
                       capture_output=True, text=True)
    sols, summary, outcome = set(), "", ""
    for line in r.stdout.splitlines():
        if line.startswith("Solution "):
            atoms = line.split(":", 1)[1].split()
            sols.add(frozenset(int(a[len("fortify("):-1]) for a in atoms))
        elif line.startswith("Solutions:"): summary = line
        elif line.startswith("Outcome:"): outcome = line
    return sols, outcome, summary, r

if __name__ == "__main__":
    items = {1:(4,9), 2:(3,7), 3:(5,12), 4:(2,4), 5:(6,13), 6:(4,8), 7:(7,16), 8:(3,5)}
    fb, ab, cap, goal = 2, 2, 12, 25
    bf = brute(items, fb, ab, cap, goal)
    print("brute force:", len(bf), sorted(map(sorted, bf)))
    for nm, loop in [("clause", LOOP_CLAUSE.format(bopt="", copt="", opt="")), ("block", LOOP_BLOCK.format(bopt="", copt=""))]:
        s, o, summ, r = run(project(items, fb, ab, cap, goal, loop))
        print(nm, len(s), s == bf, o, "|", summ)
        if r.returncode != 0 or not o: print(r.stdout[-2000:], r.stderr[-2000:])
