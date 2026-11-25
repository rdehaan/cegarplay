#!/usr/bin/env python3
"""Writes the Judgment Aggregation examples examples/contrib/ja-*.json.

The six examples share their input format, the fragment `shared`, the instances and the
generator; this script keeps them identical. Edit it, run it, then
`node tools/make-examples.mjs`. The expected counts were computed by tools/ja-check.py
(brute force and independent clingo encodings).

  python3 tools/make-ja.py              # write the six files (new instances counted)
  python3 tools/make-ja.py --recount    # count every instance again (minutes)
  python3 tools/make-ja.py --facts ID   # print the facts of one instance
  python3 tools/make-ja.py --all-facts  # every instance with facts, as JSON for tools/ja-check.py
"""
import itertools
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---- instances --------------------------------------------------------------------------


def clauses_text(clauses):
    """clauses: list of lists of (issue, positive)."""
    out = []
    for c, lits in enumerate(clauses, 1):
        parts = [f'cl({c}).'] + [f'{"pos" if p else "neg"}({c},{x}).' for x, p in lits]
        out.append(' '.join(parts))
    return '\n'.join(out) + '\n'


def profile_text(groups):
    """groups: list of (accepted issues, count)."""
    out = []
    for v, (acc, n) in enumerate(groups, 1):
        parts = [f'voter({v}).'] + [f'yes({v},{x}).' for x in acc] + ([f'count({v},{n}).'] if n != 1 else [])
        out.append(' '.join(parts))
    return '\n'.join(out) + '\n'


def preference_agenda(cands, ballots):
    """The preference agenda (Dietrich and List 2007): an issue xy for every pair x < y
    ("x is above y"); the integrity constraint says the order is transitive (no 3-cycle).
    ballots: list of (ranking as a string or list, count)."""
    pairs = [(x, y) for x, y in itertools.combinations(cands, 2)]
    sep = '' if all(len(c) == 1 for c in cands) else '_'
    issue = {p: f'{p[0]}{sep}{p[1]}' for p in pairs}

    def lit(x, y):  # the literal "x above y"
        return (issue[(x, y)], True) if (x, y) in issue else (issue[(y, x)], False)

    clauses = []
    for x, y, z in itertools.permutations(cands, 3):
        if x < y and x < z:  # each 3-cycle once per direction: x>y>z>x
            a, b, c = lit(x, y), lit(y, z), lit(z, x)
            clauses.append([(i, not p) for i, p in (a, b, c)])
    groups = []
    for rk, n in ballots:
        pos = {c: i for i, c in enumerate(rk)}
        groups.append(([issue[p] for p in pairs if pos[p[0]] < pos[p[1]]], n))
    head = ' '.join(f'issue({issue[p]}).' for p in pairs)
    return head + '\n' + clauses_text(clauses) + profile_text(groups)


def facts(head, issues, clauses, groups):
    return head + ' '.join(f'issue({x}).' for x in issues) + '\n' + clauses_text(clauses) + profile_text(groups)


N = lambda x: (x, False)
P = lambda x: (x, True)

def f1_season(iid):
    """A Formula 1 season of the Voting group (PrefLib 00052) in the preference agenda."""
    import re
    src = json.load(open(os.path.join(ROOT, 'examples', 'contrib', 'kemeny-rankings.json')))
    inst = next(i for i in src['instances'] if i['id'] == iid)
    ballots = []
    for v, order, n in re.findall(r'ballot\((\d+),\(([^)]*)\)\)\.(?:\s+count\(\d+,(\d+)\)\.)?', inst['facts']):
        ballots.append((order.split(','), int(n or 1)))
    cands = sorted(ballots[0][0])
    head = inst['facts'].split('\n')[0].replace('% ', '').split(' The ')[0]
    return (f'% {head}\n% The {len(ballots)} races are the judges, in the preference agenda over the {len(cands)} drivers: '
            f'{len(cands) * (len(cands) - 1) // 2} issues and\n% {len(cands) * (len(cands) - 1) * (len(cands) - 2) // 3} transitivity clauses.\n'
            + preference_agenda(cands, ballots))


INSTANCES = [
    {
        'id': 'example',
        'facts': facts(
            '% The running example of Endriss, de Haan, Lang and Slavkovik (JAIR 2020, Example 2.1):\n'
            '% four issues, two clauses (x1, x2 and x3 not all three; x1, x3 and x4 not all three)\n'
            '% and 11 judges. The majority accepts all four issues, which breaks both clauses.\n',
            ['x1', 'x2', 'x3', 'x4'],
            [[N('x1'), N('x2'), N('x3')], [N('x1'), N('x3'), N('x4')]],
            [(['x2', 'x3', 'x4'], 3), (['x1', 'x2'], 1), (['x1', 'x2', 'x4'], 3), (['x1', 'x3'], 4)]),
        'tags': ['library'],
    },
    {
        'id': 'taxonomy',
        'facts': facts(
            '% Example 1 of de Haan and Slavkovik (IJCAI 2019), the profile of Lang, Pigozzi, Slavkovik,\n'
            '% van der Torre and Vesic (2017), also Example 2 of Lang and Slavkovik (ECAI 2014): five issues,\n'
            '% three clauses, 17 judges. The majority accepts i1, i2, i3, i5 and rejects i4, which breaks\n'
            '% the first clause. The outcomes stated there: Kemeny {i1..i5}; Slater (MCSA) {i1..i5} and\n'
            '% {i1,i2,i5}; Leximax {i3,i5}; MSA {i1..i5}, {i1,i2,i5} and {i3,i5}; Young {i3,i5} and {i3};\n'
            '% Dodgson (MNAC) {i1..i5}.\n',
            ['i1', 'i2', 'i3', 'i4', 'i5'],
            [[P('i3'), N('i4')], [N('i3'), P('i4'), N('i1')], [N('i3'), P('i4'), N('i2')]],
            [(['i1', 'i2', 'i3', 'i4', 'i5'], 6), (['i1', 'i2', 'i5'], 4), (['i3'], 7)]),
    },
    {
        'id': 'doctrinal',
        'facts': facts(
            '% The doctrinal paradox (Kornhauser and Sager 1986): three judges decide whether a contract\n'
            '% was valid (p), whether it was breached (q), and so whether the defendant is liable (c).\n'
            '% The constraint says c holds exactly when p and q do. The majority accepts p and q and\n'
            '% rejects c.\n',
            ['p', 'q', 'c'],
            [[N('c'), P('p')], [N('c'), P('q')], [N('p'), N('q'), P('c')]],
            [(['p', 'q', 'c'], 1), (['p'], 1), (['q'], 1)]),
    },
    {
        'id': 'consistent',
        'facts': facts(
            '% The doctrinal agenda with five judges whose majority is consistent (p, q and c): every\n'
            '% rule here keeps the majority judgment, so each gives that one outcome.\n',
            ['p', 'q', 'c'],
            [[N('c'), P('p')], [N('c'), P('q')], [N('p'), N('q'), P('c')]],
            [(['p', 'q', 'c'], 3), (['p'], 1), (['q'], 1)]),
    },
    {
        'id': 'tie',
        'facts': facts(
            '% The doctrinal agenda with four judges: p and q have a majority, c is a tie. The\n'
            '% majority judgment is incomplete but consistent, and the rules differ in how they\n'
            '% complete it.\n',
            ['p', 'q', 'c'],
            [[N('c'), P('p')], [N('c'), P('q')], [N('p'), N('q'), P('c')]],
            [(['p', 'q', 'c'], 2), (['p'], 1), (['q'], 1)]),
    },
    {
        'id': 'paradox',
        'facts': '% The Condorcet paradox in the preference agenda (Dietrich and List 2007): an issue xy says\n'
                 '% "x is above y", and the constraint says the order is transitive. The majority is a\n'
                 '% cycle: a above b, b above c, c above a.\n' +
                 preference_agenda('abc', [('abc', 1), ('bca', 1), ('cab', 1)]),
    },
    {
        'id': 'election',
        'facts': '% The election "example" of the Voting group (8 voters, 5 candidates) in the preference\n'
                 '% agenda: 10 issues and 20 transitivity clauses. The Kemeny outcomes here are exactly the\n'
                 '% Kemeny rankings of kemeny-rankings, the Slater outcomes those of slater-rankings.\n' +
                 preference_agenda('abcde', [('edbac', 3), ('bedca', 1), ('adbec', 1), ('dbcae', 1), ('abecd', 2)]),
    },
    {'id': 'f1-1964', 'facts': f1_season('f1-1964'), 'tags': ['slow', 'bench', 'preflib'], 'audit': False},
    {'id': 'f1-1970', 'facts': f1_season('f1-1970'), 'tags': ['slow', 'bench', 'preflib'], 'audit': False},
]


GENERATOR = {
    'name': 'ja-random',
    'description': 'Premises x(1..n) and conclusions c(1..k), each the conjunction or the disjunction of '
                   'up to r random premises (a doctrinal paradox in general form); v judges judge the '
                   'premises around a hidden truth (each judgment wrong with probability e/1000) and '
                   'derive the conclusions. The majority often breaks a definition.',
    'params': {'n': 'int', 'k': 'int', 'r': 'int', 'v': 'int', 'e': 'permille'},
    'defaults': {'n': 6, 'k': 4, 'r': 3, 'v': 9, 'e': 300},
    'text': """% ja-random: premises x(1..n), conclusions c(1..k), judges 1..v. A hidden truth: premise I
% is true with probability 1/2; each judge gets each premise wrong with probability e/1000.
issue(x(1..n)).
issue(c(1..k)).
voter(1..v).
truth(I) :- I = 1..n, @flip(500, I) = 1.
yes(V,x(I)) :- voter(V), I = 1..n, truth(I), @flip(e, V, I) = 0.
yes(V,x(I)) :- voter(V), I = 1..n, not truth(I), @flip(e, V, I) = 1.
% Conclusion J is the conjunction (and(J)) or the disjunction of its premises prem(J,I): r
% draws, so up to r premises. Every judge derives the conclusions from its premises.
prem(J,@int(1,n,J,L)) :- J = 1..k, L = 1..r.
and(J) :- J = 1..k, @flip(500, J, 0, 0) = 1.
yes(V,c(J)) :- voter(V), and(J), yes(V,x(I)) : prem(J,I).
yes(V,c(J)) :- voter(V), J = 1..k, not and(J), prem(J,I), yes(V,x(I)).
% The integrity constraint in CNF: the definition of every conclusion. For a conjunction,
% c(J) implies each premise (clause a(J,I)) and all premises imply c(J) (clause b(J)); for
% a disjunction the other way round.
cl(a(J,I)) :- prem(J,I).
cl(b(J)) :- J = 1..k.
neg(a(J,I),c(J)) :- prem(J,I), and(J).
pos(a(J,I),x(I)) :- prem(J,I), and(J).
pos(b(J),c(J)) :- and(J).
neg(b(J),x(I)) :- prem(J,I), and(J).
pos(a(J,I),c(J)) :- prem(J,I), not and(J).
neg(a(J,I),x(I)) :- prem(J,I), not and(J).
neg(b(J),c(J)) :- J = 1..k, not and(J).
pos(b(J),x(I)) :- prem(J,I), not and(J).
#show issue/1.
#show voter/1.
#show yes/2.
#show cl/1.
#show pos/2.
#show neg/2.
""",
}


def generate(params, seed):
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    from draw import generate as gen
    p = dict(GENERATOR['defaults'])
    p.update(params)
    return gen(GENERATOR['text'], p, seed)['facts']




# ---- fragments shared by the six examples --------------------------------------------------

SHARED = """\
% The scenario is the instance (Instances tab), in the formula-based framework of Endriss, de
% Haan, Lang and Slavkovik (2020), with the integrity constraint over the issues:
%   issue(X)                    an issue of the agenda; a judgment set accepts or rejects it
%   cl(C), pos(C,X), neg(C,X)   the integrity constraint in CNF: clause C holds when a judgment
%                               set accepts some X with pos(C,X) or rejects some X with neg(C,X)
%   voter(V), yes(V,X)          judge V accepts X and rejects every issue it does not list
%   count(V,N)                  (optional) N judges hold judgment set V
% Every judgment set of the profile satisfies the constraint (fragment schema).
#defined cl/1.  #defined pos/2.  #defined neg/2.  #defined yes/2.  #defined count/2.
votes(V,N) :- voter(V), N = #max { 1; M : count(V,M) }.
total(T) :- T = #sum { N,V : votes(V,N) }.
% sup(X,N): N judges accept issue X.
sup(X,N) :- issue(X), N = #sum { W,V : votes(V,W), yes(V,X) }.
% maj(X,S,M): a strict majority judges X to be S (yes: accept, no: reject), by a margin of M
% judges; a tie gives no majority. These literals are the majority judgment m(P). When it
% breaks the constraint, the rules differ in how they repair it.
maj(X,yes,N+N-T) :- sup(X,N), total(T), N+N > T.
maj(X,no,T-N-N) :- sup(X,N), total(T), N+N < T.
"""

SCHEMA = """\
% Every instance satisfies this (Fuzz and the instance checks): each judgment set of the
% profile satisfies the integrity constraint, and every name is an issue.
:- voter(V), cl(C), yes(V,X) : neg(C,X); not yes(V,X) : pos(C,X).
:- yes(V,X), not issue(X).
:- pos(C,X), not issue(X).
:- neg(C,X), not issue(X).
"""

OUTCOME = """\
% An outcome: a complete judgment set, in(X) for every accepted issue (the others are
% rejected), that satisfies the integrity constraint.
{ in(X) : issue(X) }.
:- cl(C), in(X) : neg(C,X); not in(X) : pos(C,X).
% agree(X): the outcome agrees with the majority on X.
agree(X) :- maj(X,yes,_), in(X).
agree(X) :- maj(X,no,_), not in(X).
#show in/1.
"""

GLUE_DROP = """\
% The check reads which majority judgments the candidate gives up.
glue(drop(X)) :- maj(X,_,_).
"""

GLUE_IN = """\
% The check reads the candidate outcome.
glue(in(X)) :- issue(X).
"""

KEEP = """\
% ... that keeps every majority judgment the candidate does not drop. There is none exactly
% when the kept judgments break the constraint; a minimal unsat core is then a minimally
% inconsistent subset of the majority judgment (an MUS).
:- maj(X,_,_), not drop(X), not agree(X).
"""

OUT2 = """\
{ in2(X) : issue(X) }.
:- cl(C), in2(X) : neg(C,X); not in2(X) : pos(C,X).
"""

# ---- Kemeny -------------------------------------------------------------------------------

KEMENY_DROPS = """\
% A candidate: the majority judgments the outcome goes against (drop), at least cost. Kemeny
% counts every disagreement with a judge: each issue costs at least its minority (base/1 in
% all), and going against a majority of margin M costs M more.
{ drop(X) : maj(X,_,_) }.
#minimize { M,X : drop(X), maj(X,_,M) }.
base(S) :- S = #sum { N,X : sup(X,N), total(T), N+N <= T ; T-N,X : sup(X,N), total(T), N+N > T }.
#show drop/1.

#program bound(b).
% Once the optimum b is known (A.ground(bound, b)): every set costs exactly b (none costs less,
% as b is the optimum). A then runs out after the last cheapest set, and the run is exhausted.
:- #sum { M,X : drop(X), maj(X,_,M) } != b.
"""

KEMENY_FREE = """\
% A candidate: a complete judgment set, without the integrity constraint, at least Kemeny
% cost: the margins of the majority judgments it goes against. The refinements add the
% clauses of the constraint that candidates broke (lazily, as cutting planes).
{ in(X) : issue(X) }.
#minimize { M,X : maj(X,yes,M), not in(X) ; M,X : maj(X,no,M), in(X) }.
base(S) :- S = #sum { N,X : sup(X,N), total(T), N+N <= T ; T-N,X : sup(X,N), total(T), N+N > T }.
#show in/1.

#program bound(b).
% Once the optimum b is known: every candidate costs exactly b.
:- #sum { M,X : maj(X,yes,M), not in(X) ; M,X : maj(X,no,M), in(X) } != b.
"""

VIOLATED = """\
% A counterexample: a clause of the constraint that the candidate breaks. The refinement is
% that clause itself: its issues are the relevant atoms, and one of them must change.
1 { broken(C) : cl(C) } 1.
:- broken(C), pos(C,X), in(X).
:- broken(C), neg(C,X), not in(X).
relevant(in(X)) :- broken(C), pos(C,X).
relevant(in(X)) :- broken(C), neg(C,X).
#show broken/1.
"""

KEMENY_BETTER = """\
% A counterexample: another outcome (in2) that goes against majority judgments of a smaller
% total margin than the candidate, so it disagrees with the judges less.
""" + OUT2 + """\
:- #sum { M,X,new : maj(X,yes,M), not in2(X) ; M,X,new : maj(X,no,M), in2(X) ;
         -M,X,old : maj(X,yes,M), not in(X) ; -M,X,old : maj(X,no,M), in(X) } >= 0.
#show in2/1.
"""

IHS_HEAD = """\
solver A = shared + {drops}
solver C = shared + outcome + keeps
link   G = A -> C via shared + glue
"""


def ihs_loop(rule, score, comment, core='C.core.minimal.on(G)', score_expr='M.cost'):
    return IHS_HEAD.format(drops='drops') + comment + f"""\
best = none
loop:
    M = A.solve(optimal)
    if not M: stop
    track lower = M.cost
    if C.solve(assume G(M)):
        if best == none:
            log "{score}", {score_expr}
            best = M.cost
            A.ground(bound, best)            # from now on, only sets of the optimal cost
        for X in C.models(assume G(M)):
            accept X                         # a {rule} outcome: in(X) for the accepted issues
        A.add(G.block(M))                    # the next set of judgments to give up
    else:
        # a minimal unsat core: majority judgments that break the constraint together (an
        # MUS); the outcome must go against one of them
        A.add({core})
        count conflicts
"""


KEMENY_IHS_COMMENT = """
# Implicit hitting sets (MaxHS: Davies and Bacchus 2011) for the Kemeny rule. An outcome goes
# against some majority judgments; a Kemeny outcome goes against a set of least total margin
# that meets every minimally inconsistent subset of the majority judgment. These subsets are
# found lazily: A proposes a cheapest set of judgments to give up that meets every one found so
# far (its cost is a lower bound); C looks for an outcome that keeps all the others, and its
# minimal unsat core is one more such subset. Once C finds an outcome, the bound is the optimum
# and every outcome C has for this set is a Kemeny outcome (it cannot go against less). The set
# is blocked; from then on A proposes only sets of the optimal cost, until none is left.
"""

KEMENY_DISJOINT = IHS_HEAD.format(drops='drops') + """
# Implicit hitting sets with disjoint cores, as MaxHS solvers collect them: after a conflict,
# its judgments are left open and C looks for another conflict that shares none of them, so
# that one optimal solve of A meets several at once.
best = none
loop:
    M = A.solve(optimal)
    if not M: stop
    track lower = M.cost
    E = G(M)
    found = 0
    loop:
        X = C.solve(assume E)
        if X: break
        K = C.core.minimal
        A.add(K.on(G))                       # one conflict more to break
        count conflicts
        found = found + 1
        for a in K:                          # keep its judgments open, look for a disjoint one
            E = E.without(a)
    if found == 0:
        if best == none:
            log "Kemeny distance", M.value(base/1) + M.cost
            best = M.cost
            A.ground(bound, best)            # from now on, only sets of the optimal cost
        for X in C.models(assume G(M)):
            accept X
        A.add(G.block(M))
"""

KEMENY_LAZY = """\
solver A = shared + free
solver C = shared + violated
link   G = A -> C via shared + glue_in

# Lazy constraints (cutting planes): A picks a complete judgment set of least Kemeny cost
# without the integrity constraint; C finds a clause of the constraint that it breaks, and that
# clause (its issues are the relevant atoms) is added to A. A consistent candidate of least cost
# is a Kemeny outcome. It is blocked; from then on A proposes only judgment sets of that cost
# (the bound), until none is left.
best = none
loop:
    M = A.solve(optimal)
    if not M: stop
    track lower = M.cost
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))                # the broken clause itself
        count clauses
    else:
        if best == none:
            log "Kemeny distance", M.value(base/1) + M.cost
            best = M.cost
            A.ground(bound, best)            # from now on, only judgment sets of the optimal cost
        accept M
        A.add(G.block(M))
"""


def reference_loop(rule, what, extra=''):
    return f"""\
solver A = shared + outcome
solver C = shared + {extra}better
link   G = A -> C via shared + glue_in

# The blocking loop: A proposes an outcome, a consistent complete judgment set; C looks for
# one that is better for {rule} ({what}). A refuted outcome is blocked on its own; an outcome
# without a better one is a {rule} outcome.
loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.block(M))
    else:
        accept M
        A.add(G.block(M))
"""


MAXSAT_FRAGS = {
    'kemeny': ("""\
% Direct MaxSAT (variant maxsat): the outcome goes against majority judgments of least total
% margin; base/1 is the cost every outcome pays anyway.
#minimize { M,X : maj(X,_,M), not agree(X) }.
base(S) :- S = #sum { N,X : sup(X,N), total(T), N+N <= T ; T-N,X : sup(X,N), total(T), N+N > T }.
""", """\
#program bound(b).
% The outcomes of total margin b given up (variant maxsat; no #minimize, so that every model is listed).
:- #sum { M,X : maj(X,_,M), not agree(X) } != b.
"""),
    'slater': ("""\
% Direct MaxSAT (variant maxsat): the outcome goes against as few majority judgments as possible.
#minimize { 1,X : maj(X,_,_), not agree(X) }.
""", """\
#program bound(b).
% The outcomes that give up exactly b majority judgments (variant maxsat).
:- #count { X : maj(X,_,_), not agree(X) } != b.
"""),
}


def maxsat_loop(rule, score, score_expr):
    return f"""\
solver A = shared + outcome + mincost
solver B = shared + outcome + atcost

# Direct MaxSAT, Algorithm 1 of Conati, Niskanen and Jarvisalo (2024): the integrity
# constraint is hard, each majority judgment a soft constraint ({'weight: its margin' if rule == 'Kemeny' else 'weight 1'}). One
# optimal solve of A gives the optimum; B, the same without #minimize, lists the outcomes at
# that cost (their paper blocks each judgment set found and calls the solver again).
M = A.solve(optimal)
log "{score}", {score_expr}
B.ground(bound, M.cost)
for X in B.models():
    accept X
"""


# ---- Slater -------------------------------------------------------------------------------

SLATER_DROPS = """\
% A candidate: the majority judgments the outcome goes against (drop), as few as possible.
% Slater counts them, whatever their margins.
{ drop(X) : maj(X,_,_) }.
#minimize { 1,X : drop(X) }.
#show drop/1.

#program bound(b).
% Once the optimum b is known (A.ground(bound, b)): every set has exactly b judgments.
:- #count { X : drop(X) } != b.
"""

OLL = """\
% OLL (the default loop). The soft constraints are "drop(X) is false" and the totaliser
% outputs added by relax; viol(T) says that soft constraint T is violated.
viol(drop(X)) :- drop(X).

#program relax(k).
% core(k,T): the k-th unsat core (a minimally inconsistent subset of the majority judgment, or
% later a mix of judgments and totaliser outputs), one fact per soft constraint in it. Every
% outcome violates at least one of them: that is the +1 of the lower bound. over(k,J) says
% that at least J are violated; each over(k,J) for J >= 2 becomes a new soft constraint.
size(k,N) :- N = #count { T : core(k,T) }.
over(k,J) :- size(k,N), J = 2..N, #count { T : core(k,T), viol(T) } >= J.
viol(over(k,J)) :- over(k,J).
"""

EXACT = """\
% drop(X) only when the outcome goes against the majority on X, so that every outcome is one
% model of C (OLL leaves the relaxed judgments open, and C would otherwise list an outcome once
% per choice of them). This removes no outcome: each has a model with drop exactly its
% disagreements.
:- drop(X), agree(X).
"""

WITHIN_DIS = """\
% dis(X): the outcome goes against the majority on X.
dis(X) :- maj(X,_,_), not agree(X).

#program bound(b).
% A query "at most b": the assumption within(b) bounds the number of majority judgments the
% outcome goes against. within(b) is a free choice; the loop assumes it (or makes it a fact).
{ within(b) }.
:- within(b), #count { X : dis(X) } > b.
"""

SLATER_BETTER = """\
% A counterexample: another outcome (in2) that goes against fewer majority judgments.
""" + OUT2 + """\
:- #sum { 1,X,new : maj(X,yes,_), not in2(X) ; 1,X,new : maj(X,no,_), in2(X) ;
         -1,X,old : maj(X,yes,_), not in(X) ; -1,X,old : maj(X,no,_), in(X) } >= 0.
#show in2/1.
"""


def oll_loop(core):
    return f"""\
solver A = shared + drops
solver C = shared + outcome + keeps + oll + exact
link   G = A -> C via shared + glue

# Core-guided optimisation (OLL: Andres, Kaufmann, Matheis and Schaub 2012; Morgado, Dodaro
# and Marques-Silva 2014), then the outcomes under the final assumptions.
# Phase 1: C is called under the assumptions "every majority judgment is kept". Each unsat
# core is a set of judgments that break the constraint together (later also totaliser outputs):
# the lower bound goes up by one, the core is relaxed and replaced by the outputs over(k,J) of
# a totaliser, assumed false.
M = A.solve(optimal)               # no majority judgment given up
E = G(M)
lower = 0
loop:
    track lower = lower
    X = C.solve(assume E)
    if X: break
    K = {core}
    lower = lower + 1
    count cores
    for a in K:                    # relax the core's soft constraints
        E = E.without(a)
    C.expand(relax, core = K)      # facts core(k,T): the core's soft constraints
    j = 2
    while j <= K.size:             # the new soft constraints: not over(k,j)
        o = C.atom("over", C.step, j)
        for a in o:
            E.push(a)
            E = E.flip(a)
        j = j + 1
log "Slater distance", lower
# Phase 2: OLL keeps the number of judgments given up in every model of C equal to lower plus
# the assumptions of E it violates. So once E's assumptions are facts of C (unit clauses), the
# models of C are exactly the Slater outcomes (one model each: fragment exact), and one
# enumeration without assumptions lists them all: the run is exhausted.
for a in E:
    u = []
    u.push(a)
    C.add(u)
for X in C.models():
    accept X                       # a Slater outcome: in(X) for the accepted issues
"""


SLATER_IHS_COMMENT = """
# Implicit hitting sets (MaxHS: Davies and Bacchus 2011) for the Slater rule, the unweighted
# form of the Kemeny loop: A proposes a smallest set of majority judgments to give up that meets
# every conflict found so far; C looks for an outcome that keeps the others, and its minimal
# unsat core is a new conflict (a minimally inconsistent subset of the majority judgment).
"""

SLATER_LINEAR = """\
solver C = shared + outcome + within     options "--project"

# Solution-improving linear search (SAT-UNSAT, as in the first MaxSAT solvers): each outcome
# found is an upper bound; ask for an outcome that gives up one majority judgment fewer, until
# there is none. Every query grounds its bound (C.ground) and assumes it. Then the bound
# becomes a fact and the outcomes at the optimum are listed by one enumeration, projected on
# in/1 (option --project: the bounds of the other queries are free choices).
X = C.solve()                      # any outcome: an upper bound
best = X.count(dis/1)
grounded = none                    # set to best when a query has grounded the bound best
loop:
    track upper = best
    if best == 0: break
    k = best - 1
    C.ground(bound, k)
    count queries
    Y = C.solve(assume C.atom("within", k))
    if not Y: break
    best = Y.count(dis/1)
    if best == k: grounded = k
log "Slater distance", best
if grounded != best: C.ground(bound, best)
C.add(C.atom("within", best))      # the optimum as a fact
for X in C.models():
    accept X
"""

# ---- Leximax ------------------------------------------------------------------------------

RANKS = """\
% The levels of Leximax: the majority judgments grouped by margin, level 1 the largest margin
% (a judgment of margin M is held by (T+M)/2 of the T judges). levels(L): their number;
% size(R,N): N judgments on level R.
mar(M) :- maj(_,_,M).
level(R,M) :- mar(M), R = #count { M2 : mar(M2), M2 >= M }.
levels(L) :- L = #count { M : mar(M) }.
size(R,N) :- level(R,M), N = #count { X : maj(X,_,M) }.
"""

LEVELCOUNT = """\
% dis(X): the outcome goes against the majority on X. gone(R,G): it does so on G judgments of
% level R. atmost(R,S) for every S from G up: the order encoding the loop assumes.
dis(X) :- maj(X,_,_), not agree(X).
gone(R,G) :- level(R,M), G = #count { X : maj(X,_,M), dis(X) }.
atmost(R,S) :- size(R,N), gone(R,G), S = G..N.
"""

FOCUS = """\
% The query of level R (the loop assumes focus(R)): give up as few judgments of level R as
% possible. The levels above it are bounded by assumptions atmost(R',S). focus/1 is a free
% choice: an optimal model leaves the levels not assumed false, so only one counts.
{ focus(R) : level(R,_) }.
#minimize { 1,X : focus(R), level(R,M), maj(X,_,M), dis(X) }.
"""

LEX_DROPS = """\
% A candidate: the majority judgments the outcome goes against (drop). Leximax compares
% level by level: one judgment of a higher level outweighs any number of lower ones, so the
% margin is the priority of a judgment, not its weight.
{ drop(X) : maj(X,_,_) }.
#minimize { 1@M,X : drop(X), maj(X,_,M) }.
% dropped(R,G): the candidate gives up G judgments of level R (read by the loop).
dropped(R,G) :- level(R,M), G = #count { X : drop(X), maj(X,_,M) }.
#show drop/1.
"""

LEX_BETTER = """\
% A counterexample: another outcome (in2) that is better for Leximax: at the first level where
% the two differ, it goes against fewer majority judgments.
""" + OUT2 + """\
dis1(X) :- maj(X,yes,_), not in(X).
dis1(X) :- maj(X,no,_), in(X).
dis2(X) :- maj(X,yes,_), not in2(X).
dis2(X) :- maj(X,no,_), in2(X).
g1(R,G) :- level(R,M), G = #count { X : maj(X,_,M), dis1(X) }.
g2(R,G) :- level(R,M), G = #count { X : maj(X,_,M), dis2(X) }.
fewer(R) :- g1(R,G), g2(R,H), H < G.
more(R) :- g1(R,G), g2(R,H), H > G.
wins :- fewer(R), not more(Q) : level(Q,_), Q < R.
:- not wins.
#show in2/1.
"""

LEX_LOOP = """\
solver C = shared + outcome + ranks + tally + focus
solver D = shared + outcome + ranks + tally

# Leximax level by level (lexicographic optimisation, one optimal query per level, as in the
# iterative algorithms of Conati, Niskanen and Jarvisalo): on level 1 (the judgments of the
# largest margin) give up as few as possible; fix that number and go on with level 2, and so on.
# The queries go to C, whose #minimize counts only the level assumed by focus(R); the numbers
# found are kept as assumptions atmost(R,G) for C and for D. At the end they are facts of D,
# whose models are exactly the Leximax outcomes: an outcome within every number found is
# lexicographically at least as good, so it is optimal and gives up exactly these numbers.
X = D.solve()
L = X.value(levels/1)
fixC = []
fixD = []
r = 1
while r <= L:
    Y = C.solve(assume fixC, C.atom("focus", r), optimal)
    g = Y.cost
    count queries
    log "level", r, "gives up", g
    for a in C.atom("atmost", r, g): fixC.push(a)
    for a in D.atom("atmost", r, g): fixD.push(a)
    r = r + 1
for a in fixD:
    u = []
    u.push(a)
    D.add(u)
for X in D.models():
    accept X                       # a Leximax outcome: in(X) for the accepted issues
"""

LEX_LINEAR = """\
solver D = shared + outcome + ranks + tally

# Leximax level by level with satisfiability queries only (UNSAT-SAT on every level): on
# level R, ask "at most 0 judgments of level R given up?", then 1, 2, ..., under the numbers
# fixed for the levels above; the first yes fixes level R. Each query is an NP query; their
# number is the sum of the numbers given up plus the number of levels.
X = D.solve()
L = X.value(levels/1)
fix = []
r = 1
while r <= L:
    g = 0
    loop:
        count queries
        if D.solve(assume fix, D.atom("atmost", r, g)): break
        g = g + 1
    log "level", r, "gives up", g
    for a in D.atom("atmost", r, g): fix.push(a)
    r = r + 1
for a in fix:
    u = []
    u.push(a)
    D.add(u)
for X in D.models():
    accept X
"""

LEX_IHS = """\
solver A = shared + ranks + drops
solver C = shared + outcome + keeps
solver D = shared + outcome + ranks + tally
link   G = A -> C via shared + glue

# Implicit hitting sets with priorities: A proposes a set of majority judgments to give up that
# meets every conflict found so far and is lexicographically least (clingo's priorities, one
# per margin); C looks for an outcome that keeps the others, and its minimal unsat core is one
# more conflict. The first set C accepts is optimal; its numbers per level (dropped/2) bound D,
# whose models are then exactly the Leximax outcomes.
loop:
    M = A.solve(optimal)
    if C.solve(assume G(M)): break
    A.add(C.core.minimal.on(G))
    count conflicts
for a in M.atoms(dropped/2):
    log "level", a.arg(1), "gives up", a.arg(2)
    for b in D.atom("atmost", a.arg(1), a.arg(2)):
        u = []
        u.push(b)
        D.add(u)
for X in D.models():
    accept X
"""

# ---- MSA ----------------------------------------------------------------------------------

MAP = """\
% The map (MARCO): a seed is a set of majority judgments, seed(X), not explored yet. Grown
% seeds (maximal consistent subsets) block their subsets, shrunk seeds (minimal inconsistent
% subsets) block their supersets; the map learns only these clauses.
{ seed(X) : maj(X,_,_) }.
% Maximal seeds first (Liffiton and Malik's getUnexploredMax): with --heuristic=Domain the
% solver decides every seed atom to true first.
#heuristic seed(X) : maj(X,_,_). [1,true]
#show seed/1.
"""

GLUE_SEED = """\
% The check reads the seed.
glue(seed(X)) :- maj(X,_,_).
"""

RESPECT = """\
% Is the seed consistent? An outcome that agrees with the majority on every issue of the seed.
% An outcome that agrees on a maximal consistent seed (and so on no other majority judgment)
% is an MSA outcome.
:- seed(X), not agree(X).
"""

GLUE_AGREE = """\
% The check reads where the candidate agrees with the majority.
glue(agree(X)) :- maj(X,_,_).
"""

MORE = """\
% A counterexample: another outcome (in2) that agrees with the majority on every issue the
% candidate agrees on, and on one more: the candidate's agreement is not maximal.
""" + OUT2 + """\
agree2(X) :- maj(X,yes,_), in2(X).
agree2(X) :- maj(X,no,_), not in2(X).
:- agree(X), not agree2(X).
more :- agree2(X), not agree(X).
:- not more.
#show in2/1.
"""

MSA_LOOP = """\
solver A = shared + map            options "--heuristic=Domain"
solver C = shared + outcome + respect
link   G = A -> C via shared + glue

# MARCO (Liffiton, Previti, Malik and Marques-Silva 2016) over the majority judgment. MSA
# outcomes are the outcomes whose agreement with the majority is a maximal consistent subset
# of it (an MSS): enumerating the MSSes enumerates the outcomes. A consistent seed grows to an
# MSS (add judgments while C still finds an outcome); its outcomes are listed, and G.below(E)
# removes the MSS and its subsets from the map. An inconsistent seed shrinks to a minimal
# inconsistent subset (an MUS: drop judgments while C still fails), listed as a second kind
# (accept ... as mus); G.above(E) removes it and its supersets. The run ends when the map has
# no seed left: then every MSS and every MUS has been found.
loop:
    M = A.solve()
    if not M: stop
    E = G(M)
    if C.solve(assume E):
        for a in E:
            if not a.true and C.solve(assume E.flip(a)): E = E.flip(a)
        count mss
        for X in C.models(assume E):
            accept X                       # an MSA outcome: in(X) for the accepted issues
        A.add(G.below(E))
    else:
        for a in E:
            if a.true and not C.solve(assume E.flip(a)): E = E.flip(a)
        accept A.solve(assume E) as mus
        A.add(G.above(E))
"""

MSA_CORES = """\
solver A = shared + map            options "--heuristic=Domain"
solver C = shared + outcome + respect
link   G = A -> C via shared + glue

# MARCO with cores in place of the shrink step: an inconsistent seed refines the map with the
# minimal unsat core of C (an MUS, found by C.core.minimal) instead of shrinking the seed one
# judgment at a time. The MUSes are not listed.
loop:
    M = A.solve()
    if not M: stop
    E = G(M)
    if C.solve(assume E):
        for a in E:
            if not a.true and C.solve(assume E.flip(a)): E = E.flip(a)
        count mss
        for X in C.models(assume E):
            accept X
        A.add(G.below(E))
    else:
        A.add(C.core.minimal.on(G))
        count mus
"""

MSA_EF = """\
solver A = shared + outcome
solver C = shared + more
link   G = A -> C via shared + glue_agree

# The Sigma-2 template (exists-forall): A guesses an outcome; C looks for an outcome whose
# agreement with the majority is a strict superset of the candidate's. Such a counterexample
# also refutes every outcome that agrees on a subset of what the candidate agrees on:
# G.below(M) removes them all (a clause over agree/1: agree on one more judgment). The clause
# from relevant/1 that names only the judgments the counterexample leaves out would be unsound:
# it would also remove the outcomes that agree exactly where the counterexample does.
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X: reject M with G.below(M)
"""

MSA_REF = """\
solver A = shared + outcome
solver C = shared + more
link   G = A -> C via shared + glue_agree

# The blocking loop: a refuted outcome is blocked on its own (G.block over agree/1 blocks the
# outcomes with the same agreement, which the counterexample refutes too).
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X: reject M with G.block(M)
"""

# ---- Young --------------------------------------------------------------------------------

DELETIONS = """\
#const complete = 0.
% unit(V,K): the K-th judge with judgment set V. del(V,K): delete it. Judges with the same set
% are interchangeable: delete the K-th only if the (K-1)-th goes too.
unit(V,K) :- votes(V,N), K = 1..N.
{ del(V,K) : unit(V,K) }.
:- del(V,K), K > 1, not del(V,K-1).
% m2(X,S): a strict majority of the judges left judges X to be S.
left(T-D) :- total(T), D = #count { V,K : del(V,K) }.
s2(X,N) :- issue(X), N = #count { V,K : unit(V,K), yes(V,X), not del(V,K) }.
m2(X,yes) :- s2(X,N), left(L), N+N > L.
m2(X,no) :- s2(X,N), left(L), N+N < L.
% With complete = 1 (the instances *-complete) the majority of the judges left must also be
% complete: no tie on any issue.
:- complete = 1, issue(X), not m2(X,yes), not m2(X,no).

#program cap(b).
% Once the Young score b is known (O.ground(cap, b)): at most b deletions.
:- #count { V,K : del(V,K) } > b.
"""

FEWEST = """\
% The cost: the number of deleted judges.
#minimize { 1,V,K : del(V,K) }.
#show del/2.
"""

GLUE_M = """\
% The check reads the majority judgment of the judges left.
glue(m2(X,S)) :- issue(X), S = (yes;no).
"""

FOLLOW = """\
% An outcome that contains the majority judgment m2/2 (of the judges left, or of the changed
% profile). There is none exactly when that majority breaks the constraint.
:- m2(X,yes), not in(X).
:- m2(X,no), in(X).
"""

WITHIN_DEL = """\
#program bound(b).
% A query "at most b deletions": a free choice the loop assumes (or makes a fact).
{ within(b) }.
:- within(b), #count { V,K : del(V,K) } > b.
"""

YOUNG_LOOP = """\
solver A = shared + deletions + fewest
solver C = shared + outcome + follow
solver O = shared + deletions + outcome + follow     options "--project"
link   G = A -> C via shared + glue

# Row generation by cores. A deletes the fewest judges, knowing nothing of the integrity
# constraint but the conflicts found so far: sets of judgments that no majority may contain
# all at once. C looks for an outcome that contains the majority of the judges left; when there
# is none, its minimal unsat core is a minimally inconsistent subset of that majority, and the
# clause says that the majority of the judges left may not contain all of it, for every later
# set of deletions. The first deletions C accepts are optimal: the Young score.
best = none
loop:
    M = A.solve(optimal)
    if not M: stop
    track lower = M.cost
    if C.solve(assume G(M)):
        best = M.cost
        break
    A.add({core})
    count conflicts
log "Young score (judges deleted)", best
# The outcomes: every consistent completion of the majority of some subprofile with best
# deletions. O projects its models on in/1 (option --project), so each outcome comes once,
# however many sets of deletions give it.
O.ground(cap, best)
for X in O.models():
    accept X                       # a Young outcome: in(X) for the accepted issues
"""

YOUNG_DIRECT = """\
solver A = shared + deletions + outcome + follow + fewest
solver O = shared + deletions + outcome + follow     options "--project"

# One optimisation: A deletes the fewest judges so that the majority of the others has a
# consistent completion (the constraint in A from the start); its optimum is the Young score.
# Then O lists the outcomes, as in the default loop.
M = A.solve(optimal)
best = M.cost
log "Young score (judges deleted)", best
O.ground(cap, best)
for X in O.models():
    accept X
"""

YOUNG_LINEAR = """\
solver Q = shared + deletions + outcome + follow + within     options "--project"

# UNSAT-SAT: ask "at most 0 deletions?", then 1, 2, ... until the answer is yes: one NP
# query per step, as many as the Young score plus one. The last bound becomes a fact and the
# outcomes are listed by one enumeration (projected on in/1).
k = 0
loop:
    Q.ground(bound, k)
    count queries
    if Q.solve(assume Q.atom("within", k)): break
    k = k + 1
    track lower = k
log "Young score (judges deleted)", k
Q.add(Q.atom("within", k))
for X in Q.models():
    accept X
"""

# ---- Dodgson ------------------------------------------------------------------------------

CHANGES = """\
#const complete = 0.
% unit(V,K): the K-th judge with judgment set V. j(V,K,X): after the changes, that judge
% accepts X. Every new judgment set satisfies the constraint.
unit(V,K) :- votes(V,N), K = 1..N.
{ j(V,K,X) : issue(X) } :- unit(V,K).
:- unit(V,K), cl(C), j(V,K,X) : neg(C,X); not j(V,K,X) : pos(C,X).
% change(V,K,X): that judge changed its judgment on X. Judges with the same set are
% interchangeable: the K-th changes something only if the (K-1)-th does.
change(V,K,X) :- unit(V,K), issue(X), j(V,K,X), not yes(V,X).
change(V,K,X) :- unit(V,K), yes(V,X), not j(V,K,X).
changed(V,K) :- change(V,K,_).
:- changed(V,K), K > 1, not changed(V,K-1).
% m2(X,S): a strict majority of the changed profile judges X to be S.
s2(X,N) :- issue(X), N = #count { V,K : j(V,K,X) }.
m2(X,yes) :- s2(X,N), total(T), N+N > T.
m2(X,no) :- s2(X,N), total(T), N+N < T.
% With complete = 1 (the instances *-complete) that majority must also be complete.
:- complete = 1, issue(X), not m2(X,yes), not m2(X,no).
"""

WITHIN_CH = """\
#program bound(b).
% A query "within b changes": a free choice the loop assumes (or makes a fact).
{ within(b) }.
:- within(b), #count { V,K,X : change(V,K,X) } > b.
"""

FEWEST_CH = """\
% The cost: the number of changed judgments.
#minimize { 1,V,K,X : change(V,K,X) }.
"""

DODGSON_HEAD = 'solver C = shared + changes + outcome + follow + within     options "--project"\n'

DODGSON_TAIL = """\
log "Dodgson score (judgments changed)", best
# The outcomes: every consistent completion of the majority of a profile within best changes.
# C projects its models on in/1 (option --project), so each outcome comes once.
C.add(C.atom("within", best))      # the score as a fact: the enumeration exhausts C
for X in C.models():
    accept X                       # a Dodgson outcome: in(X) for the accepted issues
"""

DODGSON_BINARY = DODGSON_HEAD + """
# Theta-2 is P^NP[log]: polynomial time with logarithmically many NP queries (Wagner 1990). A
# binary search for the Dodgson score asks "can the judges change at most k judgments so that
# the majority has a consistent completion?", one NP query per step; each query grounds its
# bound (C.ground) and assumes it. It starts from the changes of any first model.
X = C.solve()                      # some changes: an upper bound
hi = X.count(change/3)
lo = -1                            # no profile within lo changes
grounded = none                    # set to hi when a query has grounded the bound hi
while hi - lo > 1:
    k = (lo + hi) // 2
    C.ground(bound, k)
    count queries
    Y = C.solve(assume C.atom("within", k))
    if Y:
        hi = Y.count(change/3)     # a witness within k changes, perhaps fewer
        if hi == k: grounded = k
    else:
        lo = k
    track lower = lo + 1
    track upper = hi
best = hi
if grounded != best: C.ground(bound, best)
""" + DODGSON_TAIL

DODGSON_LOOP = DODGSON_HEAD + """
# Theta-2 is P^NP[log]: polynomial time with logarithmically many NP queries (Wagner 1990). The
# question of each query: "can the judges change at most k judgments so that the majority has a
# consistent completion?"; each query grounds its bound (C.ground) and assumes it. A doubling
# search (k = 0, 1, 3, 7, ...) finds an upper bound within twice the score, then a binary
# search closes the interval: about 2 log2(score) queries, few when the score is small.
lo = -1                            # no profile within lo changes
k = 0
step = 1
grounded = none                    # set to hi when a query has grounded the bound hi
loop:
    C.ground(bound, k)
    count queries
    Y = C.solve(assume C.atom("within", k))
    if Y:
        hi = Y.count(change/3)     # a witness within k changes, perhaps fewer
        if hi == k: grounded = k
        break
    lo = k
    track lower = lo + 1
    k = k + step
    step = step * 2
while hi - lo > 1:
    k = (lo + hi) // 2
    C.ground(bound, k)
    count queries
    Y = C.solve(assume C.atom("within", k))
    if Y:
        hi = Y.count(change/3)
        if hi == k: grounded = k
    else:
        lo = k
    track lower = lo + 1
    track upper = hi
best = hi
if grounded != best: C.ground(bound, best)
""" + DODGSON_TAIL

DODGSON_UP = DODGSON_HEAD + """
# UNSAT-SAT: k = 0, 1, 2, ... until a query is satisfiable: as many queries as the score plus one.
best = 0
loop:
    C.ground(bound, best)
    count queries
    if C.solve(assume C.atom("within", best)): break
    best = best + 1
    track lower = best
""" + DODGSON_TAIL

DODGSON_DOWN = DODGSON_HEAD + """
# SAT-UNSAT: each witness is an upper bound; ask for one change fewer until there is none.
X = C.solve()
best = X.count(change/3)
grounded = none
loop:
    track upper = best
    if best == 0: break
    k = best - 1
    C.ground(bound, k)
    count queries
    Y = C.solve(assume C.atom("within", k))
    if not Y: break
    best = Y.count(change/3)
    if best == k: grounded = k
if grounded != best: C.ground(bound, best)
""" + DODGSON_TAIL

DODGSON_DIRECT = """\
solver A = shared + changes + outcome + follow + fewest
""" + DODGSON_HEAD + """
# One optimisation: A changes the fewest judgments so that the majority has a consistent
# completion; its optimum is the Dodgson score. Then C lists the outcomes, as in the default.
M = A.solve(optimal)
best = M.cost
C.ground(bound, best)
""" + DODGSON_TAIL


# ---- assembling the projects ----------------------------------------------------------------

def frag(name, text, description):
    return {'name': name, 'text': text, 'description': description}


COMMON = [
    frag('shared', SHARED, 'The scenario: issues, the integrity constraint, the profile, the support of every issue and the majority judgment maj/3. Added to every solver.'),
    frag('schema', SCHEMA, 'Constraints every instance satisfies (not in any solver).'),
    frag('outcome', OUTCOME, 'An outcome: a complete judgment set that satisfies the integrity constraint, shown as in/1.'),
]

COMPLETE_IDS = ['example', 'doctrinal']  # Young and Dodgson also run these with complete = 1


def variant(name, loop, note, constants=None):
    return {'name': name, 'swap': {}, 'constants': constants or {}, 'note': note, 'loop': {'language': 'loop', 'text': loop}}


EXAMPLES = {}

EXAMPLES['ja-kemeny'] = {
    'title': 'Judgment aggregation: Kemeny',
    'description': 'The outcomes of the Kemeny rule in judgment aggregation: the consistent complete judgment sets with the fewest disagreements with the judges (the distance-based rule of Pigozzi 2006 and Miller and Osherson 2009). Outcome determination is Theta-2-complete (Endriss, Grandi and Porello 2012). The loop is an implicit hitting set loop: A picks the majority judgments to give up at least total margin, C looks for an outcome that keeps the others, and its minimal unsat cores are the minimally inconsistent subsets of the majority judgment. Once C finds an outcome, the cost is optimal and the next sets of that cost give the other outcomes.',
    'fragments': COMMON + [
        frag('drops', KEMENY_DROPS, 'The abstraction of the default loop: the majority judgments to give up, at least total margin.'),
        frag('glue', GLUE_DROP, 'The interface: drop/1.'),
        frag('keeps', KEEP, 'The check: an outcome that keeps every majority judgment not dropped.'),
        frag('free', KEMENY_FREE, 'Variant lazy-constraints: a judgment set of least Kemeny cost without the integrity constraint.'),
        frag('violated', VIOLATED, 'Variant lazy-constraints: a clause of the constraint that the candidate breaks.'),
        frag('glue_in', GLUE_IN, 'The interface of the variants that read the outcome: in/1.'),
        frag('better', KEMENY_BETTER, 'Variant reference: an outcome of a smaller Kemeny distance.'),
        frag('mincost', MAXSAT_FRAGS['kemeny'][0], 'Variant maxsat: the Kemeny cost as one #minimize.'),
        frag('atcost', MAXSAT_FRAGS['kemeny'][1], 'Variant maxsat: the outcomes at the optimal cost.'),
    ],
    'loop': ihs_loop('Kemeny', 'Kemeny distance', KEMENY_IHS_COMMENT, score_expr='M.value(base/1) + M.cost'),
    'variants': [
        variant('plain-cores', ihs_loop('Kemeny', 'Kemeny distance', KEMENY_IHS_COMMENT, core='C.core.on(G)', score_expr='M.value(base/1) + M.cost'),
                'The cores as clasp returns them (C.core), not minimised: larger conflicts, weaker clauses.'),
        variant('disjoint-cores', KEMENY_DISJOINT, 'MaxHS with disjoint cores: after each conflict its judgments are left open and C looks for another one before A solves again.'),
        variant('lazy-constraints', KEMENY_LAZY, 'Cutting planes: A optimises without the integrity constraint, and each clause the candidate breaks is added (a clause from relevant/1).'),
        variant('maxsat', maxsat_loop('Kemeny', 'Kemeny distance', 'M.value(base/1) + M.cost'), 'Direct MaxSAT (Algorithm 1 of Conati, Niskanen and Jarvisalo): one optimal solve with the constraint hard, then the outcomes at that cost.'),
        variant('reference', reference_loop('Kemeny', 'a smaller total disagreement with the judges'), 'The blocking loop: outcomes blocked one by one, each checked against a better one (small instances only).'),
    ],
    'library': {'summary': 'Kemeny outcomes by implicit hitting sets: the minimally inconsistent subsets of the majority judgment are the minimal unsat cores (11 judges, 1 outcome); variants with plain or disjoint cores, lazy constraints, direct MaxSAT, and the blocking loop.',
                'shape': 'custom', 'tags': ['fast', 'ihs', 'cores', 'core-minimisation', 'judgment-aggregation'], 'level': 4, 'after': 14},
    'rule': 'kemeny',
}

EXAMPLES['ja-slater'] = {
    'title': 'Judgment aggregation: Slater',
    'description': 'The outcomes of the Slater rule in judgment aggregation: the consistent complete judgment sets that go against the fewest majority judgments, whatever their margins (also the maxcard subagenda rule, MCSA, of Lang, Pigozzi, Slavkovik and van der Torre). Outcome determination is Theta-2-complete (Lang and Slavkovik 2014). The loop is core-guided optimisation (OLL): unsat cores of "keep every majority judgment" are relaxed with totalisers until an outcome exists; the final assumptions then describe exactly the Slater outcomes, which one enumeration lists.',
    'fragments': COMMON + [
        frag('drops', SLATER_DROPS, 'The abstraction of the variants ihs: the majority judgments to give up, as few as possible.'),
        frag('glue', GLUE_DROP, 'The interface: drop/1.'),
        frag('keeps', KEEP, 'The check: an outcome that keeps every majority judgment not dropped.'),
        frag('oll', OLL, 'OLL: soft constraints viol/1 and the totalisers grounded per core (relax(k)).'),
        frag('exact', EXACT, 'One model per outcome: drop/1 exactly where the outcome disagrees.'),
        frag('within', WITHIN_DIS, 'Variant linear-down: the bound "at most b judgments given up", grounded per query.'),
        frag('glue_in', GLUE_IN, 'The interface of the reference variant: in/1.'),
        frag('better', SLATER_BETTER, 'Variant reference: an outcome that gives up fewer majority judgments.'),
        frag('mincost', MAXSAT_FRAGS['slater'][0], 'Variant maxsat: the Slater cost as one #minimize.'),
        frag('atcost', MAXSAT_FRAGS['slater'][1], 'Variant maxsat: the outcomes at the optimal cost.'),
    ],
    'loop': oll_loop('C.core.minimal'),
    'variants': [
        variant('plain-cores', oll_loop('C.core'), 'OLL with the cores as clasp returns them (C.core).'),
        variant('ihs', ihs_loop('Slater', 'Slater distance', SLATER_IHS_COMMENT), 'Implicit hitting sets, as for Kemeny with unit weights.'),
        variant('linear-down', SLATER_LINEAR, 'Solution-improving linear search (SAT-UNSAT): one satisfiability query per improvement.'),
        variant('maxsat', maxsat_loop('Slater', 'Slater distance', 'M.cost'), 'Direct MaxSAT (Algorithm 1 of Conati, Niskanen and Jarvisalo): one optimal solve, then the outcomes at that cost.'),
        variant('reference', reference_loop('Slater', 'fewer majority judgments given up'), 'The blocking loop (small instances only).'),
    ],
    'library': {'summary': 'Slater (maxcard subagenda) outcomes by core-guided optimisation (OLL), then every model under the final assumptions (11 judges, 2 outcomes); variants with implicit hitting sets, a linear search, plain cores, direct MaxSAT, and the blocking loop.',
                'shape': 'custom', 'tags': ['fast', 'oll', 'cores', 'core-minimisation', 'judgment-aggregation'], 'level': 4, 'after': 17},
    'rule': 'slater',
}

EXAMPLES['ja-leximax'] = {
    'title': 'Judgment aggregation: Leximax',
    'description': 'The outcomes of the Leximax rule in judgment aggregation: compare the consistent complete judgment sets by the judgments they accept, most supported first, and keep the lexicographically best. Outcome determination is Delta-2-complete (Endriss, de Haan, Lang and Slavkovik 2020), a class of its own in this group. The loop goes level by level, as Algorithm 5 of Conati, Niskanen and Jarvisalo (2024): one optimal query per margin, each fixing the number of majority judgments given up on its level for the levels below; then one enumeration lists the outcomes.',
    'fragments': COMMON + [
        frag('ranks', RANKS, 'The levels: the majority judgments grouped by margin.'),
        frag('tally', LEVELCOUNT, 'The judgments an outcome gives up per level, and the order encoding atmost/2 the loop assumes.'),
        frag('focus', FOCUS, 'The query of one level: #minimize over the level assumed by focus/1.'),
        frag('drops', LEX_DROPS, 'Variant ihs: the majority judgments to give up, with the margin as priority.'),
        frag('glue', GLUE_DROP, 'Variant ihs: the interface drop/1.'),
        frag('keeps', KEEP, 'Variant ihs: an outcome that keeps every majority judgment not dropped.'),
        frag('glue_in', GLUE_IN, 'The interface of the reference variant: in/1.'),
        frag('better', LEX_BETTER, 'Variant reference: a lexicographically better outcome.'),
    ],
    'loop': LEX_LOOP,
    'variants': [
        variant('linear-levels', LEX_LINEAR, 'Satisfiability queries only: on each level, at most 0, 1, 2, ... judgments given up until the answer is yes.'),
        variant('ihs', LEX_IHS, 'Implicit hitting sets with clingo priorities (one per margin) in the hitting set solver.'),
        variant('reference', reference_loop('Leximax', 'lexicographically fewer judgments given up, most supported first', extra='ranks + '), 'The blocking loop (small instances only).'),
    ],
    'library': {'summary': 'Leximax outcomes level by level (Delta-2): one optimal query per margin, each fixing the judgments given up on its level (11 judges, 1 outcome); variants with satisfiability queries only, implicit hitting sets with priorities, and the blocking loop.',
                'shape': 'custom', 'tags': ['fast', 'bounds', 'judgment-aggregation'], 'level': 4, 'after': 11},
    'rule': 'leximax',
}

EXAMPLES['ja-msa'] = {
    'title': 'Judgment aggregation: MSA',
    'description': 'The outcomes of the maximal subagenda rule (MSA) in judgment aggregation: the consistent complete judgment sets whose agreement with the majority is a maximal consistent subset of the majority judgment (Lang, Pigozzi, Slavkovik and van der Torre 2011). Deciding whether some outcome contains a judgment is Sigma-2-complete (Lang and Slavkovik 2014 prove the sceptical question Pi-2-complete), a level above the other rules of this group; Conati, Niskanen and Jarvisalo call it the Condorcet rule. The loop is MARCO: seeds of majority judgments grow to maximal consistent subsets, whose outcomes are listed, or shrink to minimal inconsistent ones, listed as a second kind.',
    'fragments': COMMON + [
        frag('map', MAP, 'The map of MARCO: seeds of majority judgments.'),
        frag('glue', GLUE_SEED, 'The interface: seed/1.'),
        frag('respect', RESPECT, 'The check: an outcome that agrees with the majority on the seed.'),
        frag('glue_agree', GLUE_AGREE, 'The interface of the exists-forall variants: agree/1.'),
        frag('more', MORE, 'Variants exists-forall and reference: an outcome that agrees with the majority on more.'),
    ],
    'loop': MSA_LOOP,
    'variants': [
        variant('cores', MSA_CORES, 'MARCO with minimal cores in place of the shrink step; the MUSes are not listed.'),
        variant('exists-forall', MSA_EF, 'The Sigma-2 template: an outcome against one that agrees on more; G.below removes every outcome that agrees on less.'),
        variant('reference', MSA_REF, 'The blocking loop (small instances only).'),
    ],
    'library': {'summary': 'MSA (maximal subagenda) outcomes by MARCO: maximal consistent subsets of the majority judgment give the outcomes, minimal inconsistent ones are listed apart (Sigma-2; 11 judges, 3 outcomes); variants with cores, exists-forall, and the blocking loop.',
                'shape': 'custom', 'tags': ['fast', 'marco', 'exists-forall', 'judgment-aggregation'], 'level': 4, 'after': 15},
    'rule': 'msa',
}

EXAMPLES['ja-young'] = {
    'title': 'Judgment aggregation: Young',
    'description': 'The outcomes of the Young rule in judgment aggregation: delete the fewest judges so that the majority judgment of the others is consistent; the outcomes are its consistent completions (Lang, Pigozzi, Slavkovik and van der Torre 2011; as in de Haan and Slavkovik 2019 and Conati, Niskanen and Jarvisalo 2024). Outcome determination is Theta-2-complete (Endriss and de Haan 2015). The loop is row generation by cores: the deletion solver knows only the conflicts found so far (minimally inconsistent subsets of a majority judgment, from minimal unsat cores) and learns one per refinement.',
    'fragments': COMMON + [
        frag('deletions', DELETIONS, 'The judges to delete and the majority m2/2 of the others.'),
        frag('fewest', FEWEST, 'The cost: the number of deleted judges.'),
        frag('glue', GLUE_M, 'The interface: the majority m2/2 of the judges left.'),
        frag('follow', FOLLOW, 'An outcome that contains the majority m2/2.'),
        frag('within', WITHIN_DEL, 'Variant linear-up: the bound "at most b deletions", grounded per query.'),
    ],
    'loop': YOUNG_LOOP.replace('{core}', 'C.core.minimal.on(G)'),
    'variants': [
        variant('plain-cores', YOUNG_LOOP.replace('{core}', 'C.core.on(G)'), 'The cores as clasp returns them (C.core), not minimised.'),
        variant('direct', YOUNG_DIRECT, 'No refinement: the integrity constraint in the deletion solver from the start, one optimal solve.'),
        variant('linear-up', YOUNG_LINEAR, 'UNSAT-SAT: at most 0, 1, 2, ... deletions until the answer is yes.'),
    ],
    'library': {'summary': 'Young outcomes by row generation: the deletion solver learns the conflicts of the majority judgment from minimal unsat cores (11 judges, 4 outcomes); variants with plain cores, one optimisation, and a linear search.',
                'shape': 'custom', 'tags': ['fast', 'lazy-constraints', 'cores', 'judgment-aggregation'], 'level': 4, 'after': 20},
    'rule': 'young',
    'complete': True,
}

EXAMPLES['ja-dodgson'] = {
    'title': 'Judgment aggregation: Dodgson',
    'description': 'The outcomes of the Dodgson rule in judgment aggregation: change the fewest individual judgments (every judgment set staying consistent) so that the majority judgment becomes consistent; the outcomes are its consistent completions (Miller and Osherson 2009; MNAC in Lang and Slavkovik 2014). Outcome determination is Theta-2-complete (Lang and Slavkovik 2014). The loop is a doubling and then binary search over the number of changes with one NP query per step (P^NP[log]), then one enumeration of the outcomes at the score.',
    'fragments': COMMON + [
        frag('changes', CHANGES, 'The changed profile: a new consistent judgment set per judge, the changes, and its majority m2/2.'),
        frag('follow', FOLLOW, 'An outcome that contains the majority m2/2.'),
        frag('within', WITHIN_CH, 'The bound "within b changes", grounded per query.'),
        frag('fewest', FEWEST_CH, 'Variant direct: the cost, the number of changed judgments.'),
    ],
    'loop': DODGSON_LOOP,
    'variants': [
        variant('binary', DODGSON_BINARY, 'Binary search from the changes of a first model: few queries when that bound is good, many when it is far above the score.'),
        variant('linear-up', DODGSON_UP, 'UNSAT-SAT: k = 0, 1, 2, ... until a query is satisfiable.'),
        variant('linear-down', DODGSON_DOWN, 'SAT-UNSAT: each witness is an upper bound; ask for one change fewer.'),
        variant('direct', DODGSON_DIRECT, 'One optimisation of the number of changes, then the enumeration.'),
    ],
    'library': {'summary': 'Dodgson outcomes by a doubling and binary search over the number of changed judgments, one NP query per step (P^NP[log]; 11 judges, 1 outcome); variants with a plain binary search, linear searches up and down, and one optimisation.',
                'shape': 'custom', 'tags': ['fast', 'bounds', 'judgment-aggregation'], 'level': 4, 'after': 11},
    'rule': 'dodgson',
    'complete': True,
}


def build(eid, spec, counts, readme):
    insts = []
    for inst in INSTANCES:
        x = {'id': inst['id'], 'facts': inst['facts'], 'constants': {}, 'expected': {'solutions': counts[(spec['rule'], inst['id'], False)]},
             'tags': list(inst.get('tags', []))}
        if inst.get('audit') is False:
            x['audit'] = False
        insts.append(x)
    if spec.get('complete'):
        for iid in COMPLETE_IDS:
            base = next(i for i in INSTANCES if i['id'] == iid)
            first, rest = base['facts'].split('\n', 1)
            insts.append({'id': f'{iid}-complete', 'facts': f'% The instance {iid} with complete = 1: the majority must also be complete (no tie).\n' + base['facts'],
                          'constants': {'complete': '1'}, 'expected': {'solutions': counts[(spec['rule'], iid, True)]}, 'tags': []})
    for r in RECIPES:
        if spec['rule'] not in r.get('rules', RULES):
            continue
        insts.append({'id': r['id'], 'recipe': {'generator': GENERATOR['name'], 'params': r['params'], 'seed': r['seed']},
                      'constants': {}, 'expected': {'solutions': counts[(spec['rule'], r['id'], False)]}, 'tags': list(r.get('tags', ['generated']))}
                     | ({'audit': False} if 'bench' in r.get('tags', []) else {}))
    names = ['default'] + [v['name'] for v in spec['variants']]
    p = {
        'format': 'cegarplay', 'version': 2, 'title': spec['title'], 'description': spec['description'], 'readme': readme,
        'fragments': spec['fragments'], 'loop': {'language': 'loop', 'text': spec['loop']},
        'settings': {'constants': {}, 'solutions': 0, 'seconds': 60, 'candidates': 0, 'trace': 200, 'seed': 0, 'instance': 'example'},
        'instances': insts, 'generators': [GENERATOR], 'variants': spec['variants'],
        'suites': [
            {'name': 'loops', 'instances': {'ids': 'all'}, 'variants': [n for n in names if n != 'reference'], 'limits': {'seconds': 60}},
            {'name': 'random', 'instances': {'generator': GENERATOR['name'], 'grid': {'n': [8, 12, 16], 'k': [6, 10], 'v': [15]}, 'seeds': 3},
             'variants': [n for n in names if n != 'reference'], 'limits': {'seconds': 60}},
        ],
        'library': dict(spec['library'], id=eid, group='judgment', expected=counts[(spec['rule'], 'example', False)]),
    }
    return p


# The large random scenarios only for the rules whose outcomes can be listed there (Young and
# Dodgson do not finish them in minutes, with any loop or with clingo's own optimisation).
RULES = ['kemeny', 'slater', 'leximax', 'msa', 'young', 'dodgson']
BIG_RULES = ['kemeny', 'slater', 'leximax', 'msa']
RECIPES = [
    {'id': 'random-1', 'params': {'n': 6, 'k': 4, 'v': 9}, 'seed': 2},
    {'id': 'random-2', 'params': {'n': 10, 'k': 8, 'v': 15}, 'seed': 3},
    {'id': 'random-22a', 'params': {'n': 12, 'k': 10, 'v': 21, 'e': 350}, 'seed': 1, 'tags': ['slow', 'bench', 'generated']},
    {'id': 'random-22b', 'params': {'n': 12, 'k': 10, 'v': 21, 'e': 350}, 'seed': 2, 'tags': ['slow', 'bench', 'generated']},
    {'id': 'random-30', 'params': {'n': 16, 'k': 14, 'v': 31, 'e': 400}, 'seed': 3, 'rules': BIG_RULES, 'tags': ['slow', 'bench', 'generated']},
    {'id': 'random-38', 'params': {'n': 20, 'k': 18, 'v': 41, 'e': 420}, 'seed': 9, 'rules': BIG_RULES, 'tags': ['slow', 'bench', 'generated']},
    {'id': 'random-44', 'params': {'n': 24, 'k': 20, 'v': 51, 'e': 430}, 'seed': 8, 'rules': BIG_RULES, 'tags': ['slow', 'bench', 'generated']},
]


def all_facts():
    """Every instance with facts (recipes generated), for tools/ja-check.py."""
    out = [dict(i) for i in INSTANCES]
    for r in RECIPES:
        out.append({'id': r['id'], 'facts': generate(r['params'], r['seed'])})
    out += [{'id': f'{i}-complete', 'facts': next(x for x in INSTANCES if x['id'] == i)['facts'], 'constants': {'complete': '1'}} for i in COMPLETE_IDS]
    return out


def known_counts():
    """The expected counts already in the contrib files: (rule, instance, complete) -> count."""
    counts = {}
    for eid, spec in EXAMPLES.items():
        path = os.path.join(ROOT, 'examples', 'contrib', f'{eid}.json')
        if not os.path.exists(path):
            continue
        for inst in json.load(open(path)).get('instances', []):
            n = (inst.get('expected') or {}).get('solutions')
            if n is None:
                continue
            iid, complete = inst['id'], inst['id'].endswith('-complete')
            counts[(spec['rule'], iid[:-len('-complete')] if complete else iid, complete)] = n
    return counts


def counts_from_checker(ids=None):
    """Counts by tools/ja-check.py --method clingo, for the instances ids (all when None)."""
    import subprocess
    import tempfile
    path = os.path.join(tempfile.mkdtemp(), 'all.json')
    json.dump({'instances': [i for i in all_facts() if ids is None or i['id'] in ids]}, open(path, 'w'))
    counts = {}
    out = []
    for i in all_facts():
        if ids is not None and i['id'] not in ids:
            continue
        rules = next((r.get('rules', RULES) for r in RECIPES if r['id'] == i['id']), RULES)
        res = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'ja-check.py'), path, '--method', 'clingo',
                              '--instance', i['id'], '--rule', ','.join(rules)], capture_output=True, text=True)
        if res.returncode:
            raise SystemExit(res.stdout + res.stderr)
        print(res.stdout.strip(), flush=True)
        out += res.stdout.splitlines()
    for line in out:
        iid, rest = line.split(' (', 1)
        complete = iid.endswith('-complete')
        iid = iid[:-len('-complete')] if complete else iid
        for part in rest.split('): ', 1)[1].split(', '):
            rule, n = part.split(' ')
            counts[(rule, iid, complete)] = int(n)
    return counts


INPUT_MD = """## The scenario

A scenario is an instance, in the formula-based framework of Endriss, de Haan, Lang and
Slavkovik (2020) with the integrity constraint over the issues: `issue(X)` for the issues of the
agenda, the integrity constraint in CNF as `cl(C)`, `pos(C,X)` and `neg(C,X)` (clause C holds when
a judgment set accepts some X with `pos(C,X)` or rejects some X with `neg(C,X)`), and the profile as
`voter(V)` with `yes(V,X)` for the issues judge V accepts (it rejects the others) and optionally
`count(V,N)` (N judges hold this judgment set). A formula on the agenda is an issue whose
definition is part of the constraint (the doctrinal paradox: `c` holds exactly when `p` and `q`
do). The fragment `shared` derives `sup(X,N)` (N judges accept X) and `maj(X,S,M)` (a strict
majority judges X to be S, yes or no, by a margin of M); the set of these literals is the
majority judgment. An outcome is a complete judgment set that satisfies the constraint, shown
as `in/1` (the accepted issues). With all solutions, the solution count is the number of
outcomes."""

MEASURE_MD = """## How to measure

Each suite runs its variants (Campaign tab, Advanced mode); headless:
`node tools/bench.mjs {eid} --suite loops --out rows.jsonl` and `node tools/report.mjs rows.jsonl`.
The instances tagged `bench` (two Formula 1 seasons in the preference agenda and three large
random scenarios) are where the loops differ; they run in the suites, never in the tests. The
small ones are for the audit and the tests. The suite `random` draws scenarios from the
generator `ja-random`. Every expected count was checked by `tools/ja-check.py`: brute force on
the small scenarios and an independent clingo encoding (clingo's own optimisation, or for MSA a
disjunctive encoding with saturation) on all of them."""

INSTANCES_MD = """## Instances

The same in each example of the group: `example` (the running example of Endriss, de Haan,
Lang and Slavkovik 2020: four issues, two clauses, 11 judges), `taxonomy` (Example 1 of de Haan
and Slavkovik 2019, the profile of Lang, Pigozzi, Slavkovik, van der Torre and Vesic 2017: the
outcomes those papers and Lang and Slavkovik 2014 state for every rule here are reproduced, see
the comment of the instance), `doctrinal` (the doctrinal
paradox), `consistent` (a majority that is consistent: every rule keeps it), `tie` (a tie that
the outcome must complete), `paradox` and `election` (the Condorcet paradox and the election
`example` of the Voting group in the preference agenda of Dietrich and List: the Kemeny and
Slater outcomes there are the Kemeny and Slater rankings of `kemeny-rankings` and
`slater-rankings`), two scenarios of the generator `ja-random` (premises and conclusions defined
from them, judged around a hidden truth), and for the suites the Formula 1 seasons 1964 and 1970
from PrefLib (36 issues, 168 transitivity clauses) and three larger random scenarios."""

REFS_JA = """- U. Endriss, R. de Haan, J. Lang and M. Slavkovik. The complexity landscape of outcome determination in judgment aggregation. *Journal of Artificial Intelligence Research* 69:687–731, 2020.
- R. de Haan and M. Slavkovik. Complexity results for aggregating judgments using scoring or distance-based procedures. *AAMAS 2017*, 952–961.
- R. de Haan and M. Slavkovik. Answer set programming for judgment aggregation. *IJCAI 2019*, 1668–1674.
- A. Conati, A. Niskanen and M. Järvisalo. SAT-based judgment aggregation. *AAMAS 2023*, 1412–1420.
- A. Conati, A. Niskanen and M. Järvisalo. Declarative approaches to outcome determination in judgment aggregation. *Journal of Artificial Intelligence Research* 81:793–836, 2024."""

READMES = {}

READMES['ja-kemeny'] = """# Project: Kemeny outcomes in judgment aggregation

## Research question

The Kemeny rule of judgment aggregation (Pigozzi 2006; Miller and Osherson 2009) outputs the
consistent complete judgment sets with the fewest disagreements with the judges, summed over
judges and issues. Outcome determination is Theta-2-complete (Endriss, Grandi and Porello 2012).
Its cost is the total margin of the majority judgments an outcome goes against, so it is a
weighted MaxSAT problem whose hard part is the integrity constraint. Conati, Niskanen and
Järvisalo (2023, 2024) solve it with MaxSAT; this project asks which MaxSAT algorithm, written as
a loop, suits it: implicit hitting sets over the minimally inconsistent subsets of the majority
judgment, with or without minimal and disjoint cores, or the constraint added lazily, clause by
clause?

""" + INPUT_MD + """

## The loops

- **default**: implicit hitting sets (MaxHS: Davies and Bacchus 2011). A picks the majority
  judgments to give up (`drop/1`) at least total margin, meeting every conflict found so far; C
  looks for an outcome that keeps all the others. A minimal unsat core of C is a minimally
  inconsistent subset of the majority judgment (an MUS): the outcome must go against one of its
  judgments. Once C finds an outcome, A's cost is the optimum and every outcome C has for that
  set is a Kemeny outcome (`C.models`). The optimum is then grounded into A as a bound
  (`A.ground(bound, best)`), each set is blocked after its outcomes are listed, and the run ends
  exhausted when A has none left.
- **plain-cores**: the same with the cores as clasp returns them.
- **disjoint-cores**: after a conflict, its judgments are left open and C looks for a disjoint
  one, so that one optimal solve of A meets several, as MaxHS solvers do.
- **lazy-constraints**: cutting planes. A optimises a complete judgment set without the
  integrity constraint (at first the majority judgment itself, with the ties open); C finds a
  clause it breaks, and that clause, built from `relevant/1`, goes to A. A consistent candidate of
  least cost is a Kemeny outcome.
- **maxsat**: direct MaxSAT, Algorithm 1 of Conati, Niskanen and Järvisalo (2024): the
  integrity constraint hard, every majority judgment soft with its margin as weight; one optimal
  solve, then the outcomes at that cost from a copy without `#minimize`.
- **reference**: outcomes blocked one by one, each checked against a better one (small instances
  only).

{BASELINE}

""" + INSTANCES_MD + """

## Things to try

- Conati, Niskanen and Järvisalo benchmark on PrefLib profiles in the preference agenda; their
  query is one literal set L (is the first candidate a winner), not every outcome. Restrict the
  loops to that query (assume L in C) and compare.
- Stratification: give up the judgments of large margins last (MaxHS's stratified mode).
- MaxHamming, the egalitarian sibling: minimise the largest distance to a judge.
- Which conflicts does the hitting set loop meet on the preference agenda? They are majority
  cycles, as in `kemeny-rankings`.

""" + MEASURE_MD.replace('{eid}', 'ja-kemeny') + """

## References

- G. Pigozzi. Belief merging and the discursive dilemma: an argument-based account to paradoxes of judgment aggregation. *Synthese* 152(2):285–298, 2006.
- M. K. Miller and D. Osherson. Methods for distance-based judgment aggregation. *Social Choice and Welfare* 32(4):575–601, 2009.
- U. Endriss, U. Grandi and D. Porello. Complexity of judgment aggregation. *Journal of Artificial Intelligence Research* 45:481–514, 2012.
- J. Davies and F. Bacchus. Solving MAXSAT by solving a sequence of simpler SAT instances. *CP 2011*, LNCS 6876, 225–239.
""" + REFS_JA + "\n"

READMES['ja-slater'] = """# Project: Slater outcomes in judgment aggregation

## Research question

The Slater rule of judgment aggregation outputs the consistent complete judgment sets that go
against the fewest majority judgments, whatever their margins: the maxcard subagenda rule (MCSA)
of Lang, Pigozzi, Slavkovik and van der Torre (2011). Outcome determination is Theta-2-complete
(Lang and Slavkovik 2014; Endriss and de Haan 2015). It is unweighted MaxSAT with the integrity
constraint as the hard part, so core-guided algorithms apply directly. Does OLL beat implicit
hitting sets and a plain linear search here, and what do the cores look like?

""" + INPUT_MD + """

## The loops

- **default**: core-guided optimisation (OLL: Andres, Kaufmann, Matheis and Schaub 2012; Morgado,
  Dodaro and Marques-Silva 2014). C is called under the assumptions "keep every majority
  judgment". Each minimal unsat core is a set of judgments that break the constraint together
  (later also totaliser outputs): the lower bound goes up by one, and the core is relaxed and
  replaced by a totaliser grounded from `relax(k)`. When C is satisfiable, the lower bound is the
  Slater distance and the assumptions describe exactly the optimal outcomes: they become facts of
  C, and one enumeration lists the outcomes (fragment `exact` gives one model per outcome).
- **plain-cores**: OLL with the cores as clasp returns them.
- **ihs**: implicit hitting sets, the Kemeny loop with unit weights.
- **linear-down**: solution-improving linear search (SAT-UNSAT): each outcome is an upper bound;
  ask for one judgment fewer until there is none (`C.ground(bound, k)` per query).
- **maxsat**: direct MaxSAT, Algorithm 1 of Conati, Niskanen and Järvisalo (2024): one optimal
  solve with the constraint hard, then the outcomes at that cost.
- **reference**: the blocking loop (small instances only).

{BASELINE}

""" + INSTANCES_MD + """

## Things to try

- MSA, the subset-maximal sibling of this rule, is a level higher (`ja-msa`).
- Stratification and weight-aware core extraction do not apply here: every weight is 1. What
  makes the cores large or small?

""" + MEASURE_MD.replace('{eid}', 'ja-slater') + """

## References

- J. Lang, G. Pigozzi, M. Slavkovik and L. van der Torre. Judgment aggregation rules based on minimization. *TARK 2011*, 238–246.
- J. Lang and M. Slavkovik. How hard is it to compute majority-preserving judgment aggregation rules? *ECAI 2014*, 501–506.
- U. Endriss and R. de Haan. Complexity of the winner determination problem in judgment aggregation: Kemeny, Slater, Tideman, Young. *AAMAS 2015*, 117–125.
- B. Andres, B. Kaufmann, O. Matheis and T. Schaub. Unsatisfiability-based optimization in clasp. *ICLP 2012 (Technical Communications)*.
- A. Morgado, C. Dodaro and J. Marques-Silva. Core-guided MaxSAT with soft cardinality constraints. *CP 2014*.
""" + REFS_JA + "\n"

READMES['ja-leximax'] = """# Project: Leximax outcomes in judgment aggregation

## Research question

The Leximax rule compares consistent complete judgment sets by the support of the judgments they
accept, most supported first: an outcome must accept as many judgments of the highest support as
possible, then as many of the next, and so on. Since an outcome accepts one of X and not X, this
is the same as giving up as few majority judgments as possible level by level, largest margin
first (Everaere, Konieczny and Marquis 2014; Nehring and Pivato 2019; procedurally in Lang et al.
2017, Definition 4; the scores of de Haan and Slavkovik 2019). Outcome determination is
Delta-2-complete (Endriss, de Haan, Lang and Slavkovik 2020): the only rule of this group in
that class, since the levels are many and each depends on the ones above. Conati, Niskanen and
Järvisalo (2023, 2024) compute it level by level with MaxSAT (their Algorithm 5); which form of
lexicographic optimisation is best as a loop: one optimal query per level, satisfiability queries
only, or a hitting set solver with clingo's priorities?

""" + INPUT_MD + """

## The loops

- **default**: level by level, as Algorithm 5 of Conati, Niskanen and Järvisalo (2024), which
  fixes the count of each level with a cardinality constraint. The majority judgments are grouped by margin (`ranks`: level 1 is
  the largest margin). For each level R in turn, C minimises the number of judgments of level R
  given up (its `#minimize` counts only the level assumed by `focus(R)`), under the numbers
  already fixed for the levels above (assumptions `atmost(R',G)`). Then the numbers become facts
  of D, a copy without `#minimize`, whose models are exactly the Leximax outcomes: an outcome
  within every number is lexicographically at least as good, so it is optimal.
- **linear-levels**: the same with satisfiability queries only: on each level, "at most 0?",
  "at most 1?", ... until the answer is yes.
- **ihs**: implicit hitting sets whose hitting set solver minimises with priorities (`1@M` for a
  judgment of margin M); the first set C accepts is optimal, and its numbers per level
  (`dropped/2`) bound D.
- **reference**: the blocking loop, with a check that finds a lexicographically better outcome
  (small instances only).

{BASELINE}

""" + INSTANCES_MD + """

## Things to try

- The ranked agenda rule (Tideman's ranked pairs for judgments) also works level by level, but
  fixes judgments greedily in order of support: how far are its outcomes from Leximax's?
- On which instances does the order of the levels make the queries hard?

""" + MEASURE_MD.replace('{eid}', 'ja-leximax') + """

## References

- P. Everaere, S. Konieczny and P. Marquis. Counting votes for aggregating judgments. *AAMAS 2014*, 1177–1184.
- K. Nehring and M. Pivato. Majority rule in the absence of a majority. *Journal of Economic Theory* 183:213–257, 2019.
- J. Lang, G. Pigozzi, M. Slavkovik, L. van der Torre and S. Vesic. A partial taxonomy of judgment aggregation rules and their properties. *Social Choice and Welfare* 48(2):327–356, 2017.
- J. Davies and F. Bacchus. Solving MAXSAT by solving a sequence of simpler SAT instances. *CP 2011*, LNCS 6876, 225–239.
""" + REFS_JA + "\n"

READMES['ja-msa'] = """# Project: MSA outcomes in judgment aggregation

## Research question

The maximal subagenda rule (MSA; Lang, Pigozzi, Slavkovik and van der Torre 2011) outputs the
consistent complete judgment sets whose agreement with the majority is a maximal consistent
subset of the majority judgment: no outcome agrees with the majority on more, in the sense of
sets. Conati, Niskanen and Järvisalo (2024) call it the Condorcet rule. Deciding whether some
outcome contains a judgment is Sigma-2-complete (Lang and Slavkovik 2014 prove the sceptical
question, whether every outcome contains it, Pi-2-complete), a level above every other rule of
this group: checking that an agreement is maximal is a coNP question. Its outcomes are the outcomes of the maximal satisfiable subsets (MSSes) of the
majority judgment under the integrity constraint, which MARCO enumerates together with the
minimal unsatisfiable ones (MUSes). Is MARCO, built for MUSes, a good outcome enumerator, and how
does it compare with the plain exists-forall loop?

""" + INPUT_MD + """

## The loops

- **default**: MARCO (Liffiton, Previti, Malik and Marques-Silva 2016) over the majority
  judgment. A's seeds are sets of majority judgments (maximal ones first, with a domain
  heuristic). A consistent seed grows to an MSS (add judgments while C still finds an outcome);
  its outcomes are listed (`C.models` under the MSS) and `G.below(E)` removes it and its subsets.
  An inconsistent seed shrinks to an MUS (drop judgments while C still fails), listed as a second
  kind (`accept ... as mus`), and `G.above(E)` removes it and its supersets. The run ends when the
  map is empty; then every MSS and every MUS has been found.
- **cores**: MARCO with `C.core.minimal` in place of the shrink step; the MUSes are not listed.
- **exists-forall**: the Sigma-2 template. A guesses an outcome; C looks for an outcome whose
  agreement with the majority is a strict superset. Such a counterexample refutes every outcome
  that agrees on a subset of the candidate's agreement, so `G.below(M)` (a clause over `agree/1`)
  removes them all. The clause built from the counterexample instead (agree on a judgment it
  leaves out) would be unsound here: it also removes the outcomes that agree exactly where the
  counterexample does, which may be MSA outcomes. Algorithm 3 of Conati, Niskanen and Järvisalo
  (2024) uses that stronger clause soundly because it answers one query L with candidates that are
  subset-maximal under L (preferential SAT): a set with the counterexample's agreement cannot
  contain L.
- **reference**: the blocking loop (`G.block` over `agree/1`; small instances only).

{BASELINE}

""" + INSTANCES_MD + """

## Things to try

- Make the unsound clause of exists-forall and let the Audit find the outcome it loses.
- MCSA (maximum cardinality instead of maximal) is the Slater rule (`ja-slater`): how many MSSes
  are not of maximum size?
- Use the MUSes: they are the conflicts that implicit hitting sets find one by one in `ja-kemeny`.

""" + MEASURE_MD.replace('{eid}', 'ja-msa') + """

## References

- J. Lang, G. Pigozzi, M. Slavkovik and L. van der Torre. Judgment aggregation rules based on minimization. *TARK 2011*, 238–246.
- J. Lang and M. Slavkovik. How hard is it to compute majority-preserving judgment aggregation rules? *ECAI 2014*, 501–506.
- M. H. Liffiton, A. Previti, A. Malik and J. Marques-Silva. Fast, flexible MUS enumeration. *Constraints* 21(2):223–250, 2016.
""" + REFS_JA + "\n"

COMPLETE_MD = """With the constant `complete` set to 1 (the instances `example-complete` and
`doctrinal-complete`) the majority must also be complete (no tie on any issue), as in the
definitions that take the majority judgment itself as the outcome; with 0 (the default, as in
jaggpy's encoding) a consistent majority judgment is completed in every consistent way."""

READMES['ja-young'] = """# Project: Young outcomes in judgment aggregation

## Research question

The Young rule of judgment aggregation deletes the fewest judges so that the majority judgment of
the others is consistent; the outcomes are its consistent completions, over every largest such
subprofile (Lang, Pigozzi, Slavkovik and van der Torre 2011; the definition of de Haan and
Slavkovik 2019 and of Conati, Niskanen and Järvisalo 2024, Definition 10). Outcome determination
is Theta-2-complete (Endriss and de Haan 2015). With `complete = 1` it is the variant of de Haan
(2018), whose subprofile must have a complete and consistent majority, which is the outcome. The integrity constraint matters only through the
conflicts of a majority judgment, and few of them matter: can a deletion solver that learns them
one at a time (row generation) beat one that has the whole constraint from the start?

""" + INPUT_MD + """

""" + COMPLETE_MD + """

## The loops

- **default**: row generation by cores. A deletes the fewest judges (`del(V,K)`: judges with the
  same judgment set are interchangeable) and computes the majority `m2/2` of the judges left, but
  knows nothing of the constraint except the conflicts found so far. C looks for an outcome that
  contains `m2/2`; when there is none, its minimal unsat core is a minimally inconsistent subset of
  that majority, and the clause says that the majority of the judges left may not contain all of
  it, for every later set of deletions. The first deletions C accepts give the Young score. Then
  O lists the outcomes: every consistent completion of the majority of some subprofile with that
  many deletions, projected on `in/1` (option `--project`), so that each outcome comes once.
- **plain-cores**: the same with the cores as clasp returns them.
- **direct**: the constraint in the deletion solver from the start; one optimal solve (the MaxSAT
  encoding of Conati, Niskanen and Järvisalo, whose soft constraints keep each judge).
- **linear-up**: UNSAT-SAT, "at most 0 deletions?", "at most 1?", ... until the answer is yes.

{BASELINE}

""" + INSTANCES_MD + """

## Things to try

- Most of the time goes into listing the outcomes, not into finding the score: many subprofiles
  of the same size have different majorities. Could the loop list the majorities first?
- Young with the most judges kept instead of the fewest deleted is the same; a variant that
  replaces judges instead of deleting them is Dodgson-like (`ja-dodgson`).

""" + MEASURE_MD.replace('{eid}', 'ja-young') + """

## References

- J. Lang, G. Pigozzi, M. Slavkovik, L. van der Torre and S. Vesic. A partial taxonomy of judgment aggregation rules and their properties. *Social Choice and Welfare* 48(2):327–356, 2017.
- U. Endriss and R. de Haan. Complexity of the winner determination problem in judgment aggregation: Kemeny, Slater, Tideman, Young. *AAMAS 2015*, 117–125.
- J. Lang, G. Pigozzi, M. Slavkovik and L. van der Torre. Judgment aggregation rules based on minimization. *TARK 2011*, 238–246.
- R. de Haan. Hunting for tractable languages for judgment aggregation. *KR 2018*.
""" + REFS_JA + "\n"

READMES['ja-dodgson'] = """# Project: Dodgson outcomes in judgment aggregation

## Research question

The Dodgson rule of judgment aggregation changes the fewest individual judgments, every judgment
set staying consistent, so that the majority judgment becomes consistent; the outcomes are its
consistent completions, over every optimal changed profile (Miller and Osherson 2009; MNAC, the
minimal number of atomic changes, in Lang and Slavkovik 2014; Conati, Niskanen and Järvisalo 2024,
Definition 11). Outcome determination is Theta-2-complete (Lang and Slavkovik 2014, for MNAC). Theta-2 is
P^NP[log]: logarithmically many NP queries suffice (Wagner 1990). Does the textbook search,
one NP query per step, pay off against linear searches and one optimisation, and which search
should it be?

""" + INPUT_MD + """

""" + COMPLETE_MD + """

## The loops

- **default**: doubling, then binary search. Each query asks "can the judges change at most k
  judgments so that the majority has a consistent completion?" (`C.ground(bound, k)` grounds the
  bound; `within(k)` assumes it). k = 0, 1, 3, 7, ... until the first yes, then bisection: about
  2 log2(score) queries. Then the score becomes a fact and one enumeration, projected on `in/1`,
  lists the outcomes.
- **binary**: bisection from the changes of any first model: few queries when that bound is
  good, but a first model may change hundreds of judgments where two suffice.
- **linear-up**: UNSAT-SAT, k = 0, 1, 2, ... until a query is satisfiable.
- **linear-down**: SAT-UNSAT, each witness an upper bound, one change fewer each time.
- **direct**: one optimisation of the number of changes (`#minimize`), then the enumeration (the
  MaxSAT encoding of Conati, Niskanen and Järvisalo: a soft constraint per individual judgment).

{BASELINE}

""" + INSTANCES_MD + """

## Things to try

- Symmetry: judges with the same judgment set are interchangeable, but only the order in which
  they change is fixed here; their new judgment sets could be ordered too.
- Count a changed judge instead of a changed judgment (a Young-like Dodgson).

""" + MEASURE_MD.replace('{eid}', 'ja-dodgson') + """

## References

- M. K. Miller and D. Osherson. Methods for distance-based judgment aggregation. *Social Choice and Welfare* 32(4):575–601, 2009.
- J. Lang and M. Slavkovik. How hard is it to compute majority-preserving judgment aggregation rules? *ECAI 2014*, 501–506.
- K. W. Wagner. Bounded query classes. *SIAM Journal on Computing* 19(5):833–846, 1990.
""" + REFS_JA + "\n"

BASELINES = {
 "ja-kemeny": "## Baseline\n\nTime of a run with all solutions on clingo-wasm (`tools/bench.mjs`, suite `loops`, limit 60 s, two runs at a time) and, in brackets, the refinements added (clauses, cores, blocks and unit clauses); the outcome count is after the instance name. The small instances take under 0.1 s with every loop.\n\n| instance | default | plain-cores | disjoint-cores | lazy-constraints | maxsat |\n| --- | --- | --- | --- | --- | --- |\n| 1964: 9 drivers, 10 races (26) | 0.0 s (5) | 0.1 s (103) | 0.1 s (5) | 0.1 s (37) | 0.0 s (0) |\n| 1970: 9 drivers, 13 races (3) | 0.1 s (8) | 0.5 s (239) | 0.1 s (8) | 0.1 s (9) | 0.0 s (0) |\n| random-22a: 22 issues, 21 judges (2) | 0.0 s (7) | 0.0 s (23) | 0.0 s (6) | 0.0 s (6) | 0.0 s (0) |\n| random-22b: 22 issues, 21 judges (1) | 0.0 s (4) | 0.0 s (8) | 0.0 s (4) | 0.0 s (4) | 0.0 s (0) |\n| random-30: 30 issues, 31 judges (1) | 0.0 s (6) | 0.5 s (257) | 0.0 s (6) | 0.0 s (6) | 0.0 s (0) |\n| random-38: 38 issues, 41 judges (2) | 0.0 s (6) | 0.6 s (147) | 0.0 s (6) | 0.0 s (6) | 0.0 s (0) |\n| random-44: 44 issues, 51 judges (1) | 0.1 s (6) | 0.4 s (80) | 0.1 s (6) | 0.1 s (6) | 0.0 s (0) |\n\nEvery loop is fast on these scenarios: the majority judgments conflict in few places. The loops differ in what they learn: the cores as clasp returns them are long, so the hitting set solver needs 15 to 40 times more of them (hundreds on the F1 seasons, whose conflicts are majority cycles), and disjoint cores save a round now and then. The lazy constraints need few clauses on the random scenarios, but 37 on the 1964 season, one per 3-cycle the candidates run into. Direct MaxSAT (maxsat) is as fast: one optimal solve with the whole constraint, no rounds; at these sizes clingo's own optimisation needs no help, as Conati, Niskanen and Järvisalo found with MaxSAT solvers on much larger PrefLib profiles.",
 "ja-slater": "## Baseline\n\nTime of a run with all solutions on clingo-wasm (`tools/bench.mjs`, suite `loops`, limit 60 s, two runs at a time) and, in brackets, the refinements added (clauses, cores, blocks and unit clauses); the outcome count is after the instance name. The small instances take under 0.1 s with every loop.\n\n| instance | default | plain-cores | ihs | linear-down | maxsat |\n| --- | --- | --- | --- | --- | --- |\n| 1964: 9 drivers, 10 races (30) | 0.1 s (28) | 0.1 s (28) | 0.1 s (6) | 0.0 s (1) | 0.0 s (0) |\n| 1970: 9 drivers, 13 races (3) | 0.0 s (36) | 0.0 s (36) | 0.1 s (8) | 0.0 s (1) | 0.0 s (0) |\n| random-22a: 22 issues, 21 judges (9) | 0.0 s (22) | 0.0 s (22) | 0.0 s (14) | 0.0 s (1) | 0.0 s (0) |\n| random-22b: 22 issues, 21 judges (2) | 0.0 s (22) | 0.0 s (22) | 0.0 s (5) | 0.0 s (1) | 0.0 s (0) |\n| random-30: 30 issues, 31 judges (7) | 0.1 s (30) | 0.0 s (30) | 0.0 s (13) | 0.0 s (1) | 0.0 s (0) |\n| random-38: 38 issues, 41 judges (36) | 0.1 s (38) | 0.0 s (38) | 0.1 s (42) | 0.0 s (1) | 0.0 s (0) |\n| random-44: 44 issues, 51 judges (26) | 0.1 s (44) | 0.1 s (44) | 0.1 s (32) | 0.0 s (1) | 0.0 s (0) |\n\nOLL needs one core per judgment given up (the Slater distance: 22 to 44 here) and then one enumeration; implicit hitting sets need fewer conflicts but an optimal hitting set per round; the linear search adds one unit clause (the optimum). All are fast at these sizes: the differences grow with the distance. Direct MaxSAT (maxsat) is as fast: one optimal solve, no rounds.",
 "ja-leximax": "## Baseline\n\nTime of a run with all solutions on clingo-wasm (`tools/bench.mjs`, suite `loops`, limit 60 s, two runs at a time) and, in brackets, the refinements added (clauses, cores, blocks and unit clauses); the outcome count is after the instance name. The small instances take under 0.1 s with every loop.\n\n| instance | default | linear-levels | ihs |\n| --- | --- | --- | --- |\n| 1964: 9 drivers, 10 races (26) | 0.1 s (3) | 0.0 s (3) | 0.0 s (6) |\n| 1970: 9 drivers, 13 races (3) | 0.1 s (6) | 0.0 s (6) | 0.1 s (10) |\n| random-22a: 22 issues, 21 judges (2) | 0.0 s (9) | 0.0 s (9) | 0.0 s (12) |\n| random-22b: 22 issues, 21 judges (1) | 0.0 s (10) | 0.0 s (10) | 0.0 s (14) |\n| random-30: 30 issues, 31 judges (1) | 0.0 s (14) | 0.0 s (14) | 0.1 s (19) |\n| random-38: 38 issues, 41 judges (2) | 0.0 s (17) | 0.0 s (17) | 0.1 s (21) |\n| random-44: 44 issues, 51 judges (1) | 0.0 s (19) | 0.0 s (19) | 0.1 s (24) |\n\nLevel by level needs one query per margin (the refinements are the unit clauses that fix the levels at the end); with satisfiability queries only, as many queries as the levels plus the judgments given up, and as fast here. The hitting set solver with priorities needs a few conflicts more than the levels.",
 "ja-msa": "## Baseline\n\nTime of a run with all solutions on clingo-wasm (`tools/bench.mjs`, suite `loops`, limit 60 s, two runs at a time) and, in brackets, the refinements added (clauses, cores, blocks and unit clauses); the outcome count is after the instance name. The small instances take under 0.1 s with every loop.\n\n| instance | default | cores | exists-forall |\n| --- | --- | --- | --- |\n| 1964: 9 drivers, 10 races (141) | 0.1 s (18) | 0.1 s (18) | 0.1 s (286) |\n| 1970: 9 drivers, 13 races (69) | 0.3 s (127) | 0.3 s (127) | 0.3 s (1078) |\n| random-22a: 22 issues, 21 judges (18) | 0.0 s (26) | 0.0 s (26) | 0.0 s (148) |\n| random-22b: 22 issues, 21 judges (8) | 0.0 s (12) | 0.0 s (12) | 0.0 s (72) |\n| random-30: 30 issues, 31 judges (102) | 0.2 s (111) | 0.2 s (111) | 0.2 s (942) |\n| random-38: 38 issues, 41 judges (576) | 0.6 s (584) | 0.5 s (584) | 1.1 s (6085) |\n| random-44: 44 issues, 51 judges (431) | 0.6 s (445) | 0.6 s (445) | 1.3 s (6836) |\n\nMARCO's refinements are one block per MSS and one per MUS, close to the number of outcomes; the exists-forall loop blocks every refuted candidate's subsets separately and needs about ten times as many refinements, but its checks are cheap, so it is only twice as slow on the largest scenarios. Shrinking a seed one judgment at a time and the minimal core cost the same here.",
 "ja-young": "## Baseline\n\nTime of a run with all solutions on clingo-wasm (`tools/bench.mjs`, suite `loops`, limit 60 s, two runs at a time) and, in brackets, the refinements added (clauses, cores, blocks and unit clauses); the outcome count is after the instance name. The small instances take under 0.1 s with every loop.\n\n| instance | default | plain-cores | direct | linear-up |\n| --- | --- | --- | --- | --- |\n| 1964: 9 drivers, 10 races (535) | 0.2 s (1) | 0.2 s (12) | 0.2 s (0) | 0.2 s (1) |\n| 1970: 9 drivers, 13 races (40) | 0.1 s (1) | 0.1 s (1) | 0.1 s (0) | 0.1 s (1) |\n| random-22a: 22 issues, 21 judges (20) | 0.9 s (6) | 8.6 s (57) | 0.5 s (0) | 1.4 s (1) |\n| random-22b: 22 issues, 21 judges (41) | 16.0 s (5) | 18.4 s (36) | 6.7 s (0) | 10.4 s (1) |\n\nThe Young score is found in a few rounds (minimal cores: 5 to 6 conflicts; plain cores: up to 57, which costs 8 s on random-22a); most of the time is the enumeration of the outcomes over every subprofile of that size, which the direct loop does fastest only because it has no rounds before it. The large random scenarios (30 to 44 issues) do not finish in minutes with any loop: there are too many subprofiles of the optimal size.",
 "ja-dodgson": "## Baseline\n\nTime of a run with all solutions on clingo-wasm (`tools/bench.mjs`, suite `loops`, limit 60 s, two runs at a time) and, in brackets, the refinements added (clauses, cores, blocks and unit clauses); the outcome count is after the instance name. The small instances take under 1.3 s with every loop.\n\n| instance | default | binary | linear-up | linear-down | direct |\n| --- | --- | --- | --- | --- | --- |\n| 1964: 9 drivers, 10 races (18) | 0.2 s (1) | 0.4 s (1) | 0.1 s (1) | 4.3 s (1) | 13.3 s (1) |\n| 1970: 9 drivers, 13 races (3) | 0.2 s (1) | 2.2 s (1) | 0.3 s (1) | 52.0 s (1) | 38.0 s (1) |\n| random-22a: 22 issues, 21 judges (2) | 3.6 s (1) | 11.4 s (1) | 3.1 s (1) | 58.0 s (1) | 13.2 s (1) |\n| random-22b: 22 issues, 21 judges (1) | 1.1 s (1) | 5.2 s (1) | 1.2 s (1) | > 60 s | 11.0 s (1) |\n\nThe doubling search asks about 2 log2(score) queries from below; the plain binary search starts at the changes of a first model (hundreds where the score is 1 to 3) and so asks more and harder queries; the linear search up is as good here because the scores are small, and the linear search down, from that first model, is the slowest. One optimisation (direct) is slower than a few bounded queries: proving the optimum of the change count is harder than answering \"within k?\". The large random scenarios do not finish in minutes."
}


def main():
    if len(sys.argv) > 2 and sys.argv[1] == '--facts':
        for i in all_facts():
            if i['id'] == sys.argv[2]:
                sys.stdout.write(i['facts'])
                return
        raise SystemExit(f'no instance {sys.argv[2]}')
    if len(sys.argv) > 1 and sys.argv[1] == '--all-facts':
        json.dump({'instances': all_facts()}, sys.stdout, indent=1)
        return
    # The counts: those in the contrib files, the missing ones from tools/ja-check.py
    # (--recount: all of them again; the large instances take minutes).
    counts = {} if '--recount' in sys.argv else known_counts()
    need = []
    for i in all_facts():
        complete = i['id'].endswith('-complete')
        iid = i['id'][:-len('-complete')] if complete else i['id']
        rules = next((r.get('rules', RULES) for r in RECIPES if r['id'] == iid), RULES)
        if any((spec['rule'], iid, complete) not in counts for spec in EXAMPLES.values() if (spec.get('complete') or not complete) and spec['rule'] in rules):
            need.append(i['id'])
    if need:
        print('counting', ', '.join(need))
        counts.update(counts_from_checker(set(need)))
    for eid, spec in EXAMPLES.items():
        readme = READMES[eid].replace('{BASELINE}', BASELINES.get(eid, '## Baseline\n\nNot measured yet.'))
        p = build(eid, spec, counts, readme)
        with open(os.path.join(ROOT, 'examples', 'contrib', f'{eid}.json'), 'w') as f:
            json.dump(p, f, indent=2, ensure_ascii=False)
            f.write('\n')
        print(f'wrote examples/contrib/{eid}.json: example {p["library"]["expected"]} outcomes')


if __name__ == '__main__':
    main()
