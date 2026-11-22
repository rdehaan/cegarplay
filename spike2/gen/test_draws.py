import itertools, collections, sys
sys.path.insert(0, "../gen")
from draws import Draws
from generate import generate
GNP = """node(1..n).
edge(X,Y) :- node(X), node(Y), X < Y, @flip(p, X, Y) = 1.
reach(1).
reach(Y) :- reach(X), edge(X,Y).
reach(X) :- reach(Y), edge(X,Y).
:- node(X), not reach(X).
#show node/1.  #show edge/2.
"""
def gnp_py(n, p, seed):
    for attempt in range(200):
        d = Draws(seed, attempt)
        edges = {(x, y) for x in range(1, n + 1) for y in range(x + 1, n + 1) if d.flip(p, x, y)}
        reach, frontier = {1}, [1]
        while frontier:
            v = frontier.pop()
            for (a, b) in edges:
                for (s, t) in ((a, b), (b, a)):
                    if s == v and t not in reach: reach.add(t); frontier.append(t)
        if len(reach) == n:
            atoms = sorted([f"node({i})" for i in range(1, n + 1)] + [f"edge({a},{b})" for a, b in edges])
            return " ".join(a + "." for a in atoms), attempt
same, attempts = 0, []
for seed in range(1, 31):
    g = generate(GNP, {"n": 9, "p": 250}, seed)
    facts, att = gnp_py(9, 250, seed)
    same += (g["facts"] == facts and g["attempt"] == att); attempts.append(att)
print("gnp n=9 p=250: engine and Python twin give identical facts for", same, "of 30 seeds; accepted draws:", 30, "of", 30 + sum(attempts), "attempts")
# every draw function, engine against twin
ALL = """i(1..8).
d(flip,I,@flip(300,I)) :- i(I).           d(int,I,@int(-5,20,I,a)) :- i(I).
d(weighted,I,@weighted((1,2,3,4),I)) :- i(I).
d(perm,I,@perm(8,I,k)) :- i(I).           d(subset,I,@subset(3,8,I,k2)) :- i(I).
d(mallows,I,@mallows(8,400,I,voter(1))) :- i(I).
#show d/3.
"""
g = generate(ALL, {}, 42)
d = Draws(42, 0)
exp = []
for i in range(1, 9):
    exp += [f"d(flip,{i},{d.flip(300,i)})", f"d(int,{i},{d.int(-5,20,i,'a')})", f"d(weighted,{i},{d.weighted([1,2,3,4],i)})",
            f"d(perm,{i},{d.perm(8,i,'k')})", f"d(subset,{i},{d.subset(3,8,i,'k2')})", f"d(mallows,{i},{d.mallows(8,400,i,'voter(1)')})"]
print("all six draw functions identical in engine and twin:", g["facts"] == " ".join(a + "." for a in sorted(exp)))
print("sample:", g["facts"][:260])
# order independence: the same generator with its rules reversed
rev = "\n".join(reversed(GNP.strip().splitlines())) + "\n"
print("rule order does not matter:", all(generate(GNP, {"n": 9, "p": 250}, s)["facts"] == generate(rev, {"n": 9, "p": 250}, s)["facts"] for s in (1, 2, 3)))
# distribution checks on the twin (10,000 keys each)
d = Draws(1, 0)
print("flip(300) frequency:", sum(d.flip(300, k) for k in range(10000)) / 10000,
      "| int(1,6) counts:", sorted(collections.Counter(d.int(1, 6, k) for k in range(12000)).values()),
      "| subset(3,8) sizes:", set(sum(Draws(1,0).subset(3, 8, i, k) for i in range(1, 9)) for k in range(200)))
c = collections.Counter(tuple(Draws(1,0).perm(3, i, k) for i in (1, 2, 3)) for k in range(6000))
print("perm(3) counts over 6000 keys:", sorted(c.values()))
m = collections.Counter(Draws(1,0).mallows(4, 300, 1, k) for k in range(4000))
print("mallows(4, phi=0.3): position of item 1 over 4000 keys:", dict(sorted(m.items())))
