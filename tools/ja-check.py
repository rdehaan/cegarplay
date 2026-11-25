#!/usr/bin/env python3
"""Independent outcome counts for the Judgment Aggregation examples (examples/contrib/ja-*.json).

Two methods, both independent of CegarPlay's loops:

  brute   enumerate every complete judgment set consistent with the integrity constraint and
          apply the definition of the rule (Young and Dodgson by a search over subprofiles and
          over changed profiles). Small agendas only (2^issues judgment sets).
  clingo  one direct ASP encoding per rule, solved by Python clingo with its own optimisation
          (--opt-mode=optN, projected on the outcome); MSA (Sigma-2) by a disjunctive
          encoding with saturation.

Input: the instance facts of a ja-* project (issue/1, cl/1, pos/2, neg/2, voter/1, yes/2,
count/2), from a project file and instance id, or from a facts file.

  python3 tools/ja-check.py examples/contrib/ja-kemeny.json --instance all
  python3 tools/ja-check.py facts.lp --rule young --method clingo --show
"""
import argparse
import itertools
import json
import sys

import clingo

RULES = ['kemeny', 'slater', 'leximax', 'msa', 'young', 'dodgson']


# ---- reading an instance ----------------------------------------------------------------
class Scenario:
    def __init__(self, facts, complete=False):
        ctl = clingo.Control(['--warn=none'])
        ctl.add('base', [], facts)
        ctl.ground([('base', [])])
        atoms = [a.symbol for a in ctl.symbolic_atoms if a.is_fact]
        by = lambda n, k: [s for s in atoms if s.name == n and len(s.arguments) == k]
        self.issues = sorted(str(s.arguments[0]) for s in by('issue', 1))
        idx = {x: i for i, x in enumerate(self.issues)}
        clauses = {}
        for s in by('cl', 1):
            clauses.setdefault(str(s.arguments[0]), [])
        for s in by('pos', 2) + by('neg', 2):
            c, x = str(s.arguments[0]), str(s.arguments[1])
            if x not in idx:
                raise SystemExit(f'clause {c}: {x} is not an issue')
            clauses.setdefault(c, []).append((idx[x], s.name == 'pos'))
        self.clauses = list(clauses.values())
        counts = {str(s.arguments[0]): s.arguments[1].number for s in by('count', 2)}
        yes = {}
        for s in by('yes', 2):
            yes.setdefault(str(s.arguments[0]), set()).add(idx[str(s.arguments[1])])
        self.groups = []  # (judgment as a tuple of bools, multiplicity)
        for s in by('voter', 1):
            v = str(s.arguments[0])
            j = tuple(i in yes.get(v, set()) for i in range(len(self.issues)))
            if not self.consistent(j):
                raise SystemExit(f'voter {v}: the judgment set violates the integrity constraint')
            self.groups.append((j, counts.get(v, 1)))
        self.total = sum(n for _, n in self.groups)
        self.complete = complete

    def consistent(self, j):
        return all(any(j[i] == p for i, p in c) for c in self.clauses)

    def support(self, groups=None):
        groups = self.groups if groups is None else groups
        return [sum(n for j, n in groups if j[i]) for i in range(len(self.issues))]

    def majority(self, sup, total):
        """issue index -> True/False for the issues with a strict majority."""
        return {i: s + s > total for i, s in enumerate(sup) if s + s != total}

    def name(self, j):
        return ' '.join(f'in({x})' for x, b in zip(self.issues, j) if b)


def all_sets(sc):
    return [j for j in itertools.product([False, True], repeat=len(sc.issues)) if sc.consistent(j)]


# ---- brute force ------------------------------------------------------------------------
def brute(sc, rule):
    sets = all_sets(sc)
    sup = sc.support()
    T = sc.total
    maj = sc.majority(sup, T)
    if rule == 'kemeny':
        score = lambda j: sum(s if j[i] else T - s for i, s in enumerate(sup))
        best = max(map(score, sets))
        return {j for j in sets if score(j) == best}
    if rule == 'slater':
        score = lambda j: sum(1 for i, b in maj.items() if j[i] == b)
        best = max(map(score, sets))
        return {j for j in sets if score(j) == best}
    if rule == 'leximax':
        def vec(j):
            v = [0] * (T + 1)
            for i, s in enumerate(sup):
                v[s if j[i] else T - s] += 1
            return tuple(reversed(v))
        best = max(map(vec, sets))
        return {j for j in sets if vec(j) == best}
    if rule == 'msa':
        agree = {j: frozenset(i for i, b in maj.items() if j[i] == b) for j in sets}
        values = set(agree.values())
        maximal = {a for a in values if not any(a < b for b in values)}
        return {j for j in sets if agree[j] in maximal}
    if rule == 'young':
        return young_brute(sc, sets)
    if rule == 'dodgson':
        return dodgson_brute(sc, sets)
    raise ValueError(rule)


def completions(sc, sets, maj):
    return {j for j in sets if all(j[i] == b for i, b in maj.items())}


def acceptable(sc, maj):
    """The majority may be an outcome's core: consistent (and complete, with --complete)."""
    if sc.complete and len(maj) < len(sc.issues):
        return False
    return True


def young_brute(sc, sets):
    ranges = [range(n + 1) for _, n in sc.groups]  # voters deleted per group
    best, out = None, set()
    for dels in itertools.product(*ranges):
        k = sum(dels)
        if best is not None and k > best:
            continue
        groups = [(j, n - d) for (j, n), d in zip(sc.groups, dels)]
        total = sc.total - k
        maj = sc.majority(sc.support(groups), total)
        if not acceptable(sc, maj):
            continue
        outs = completions(sc, sets, maj)
        if not outs:
            continue
        if best is None or k < best:
            best, out = k, set()
        out |= outs
    return out


def dodgson_brute(sc, sets):
    # Every voter (one unit per voter) gets a consistent judgment set; the cost is the number
    # of changed judgments. Dynamic programming over the support vectors of the voters so far.
    n = len(sc.issues)
    states = {tuple([0] * n): 0}
    for j0, mult in sc.groups:
        options = [(j, sum(a != b for a, b in zip(j, j0))) for j in sets]
        for _ in range(mult):
            nxt = {}
            for st, c in states.items():
                for j, d in options:
                    s2 = tuple(a + b for a, b in zip(st, j))
                    if c + d < nxt.get(s2, 1 << 30):
                        nxt[s2] = c + d
            states = nxt
    best, out = None, set()
    for st, c in sorted(states.items(), key=lambda x: x[1]):
        if best is not None and c > best:
            break
        maj = sc.majority(list(st), sc.total)
        if not acceptable(sc, maj):
            continue
        outs = completions(sc, sets, maj)
        if not outs:
            continue
        best = c
        out |= outs
    return out


# ---- direct clingo encodings --------------------------------------------------------------
BASE = """
#defined count/2. #defined yes/2. #defined pos/2. #defined neg/2. #defined cl/1.
votes(V,N) :- voter(V), N = #max { 1; M : count(V,M) }.
total(T) :- T = #sum { N,V : votes(V,N) }.
sup(X,N) :- issue(X), N = #sum { W,V : votes(V,W), yes(V,X) }.
{ in(X) : issue(X) }.
:- cl(C), in(X) : neg(C,X); not in(X) : pos(C,X).
#show in/1.
"""
MAJ = """
maj(X) :- sup(X,N), total(T), N+N > T.
min(X) :- sup(X,N), total(T), N+N < T.
"""
ENC = {
    'kemeny': BASE + """
#maximize { N,X : in(X), sup(X,N) ; T-N,X : issue(X), not in(X), sup(X,N), total(T) }.
""",
    'slater': BASE + MAJ + """
#minimize { 1,X : maj(X), not in(X) ; 1,X : min(X), in(X) }.
""",
    'leximax': BASE + """
#maximize { 1@N,X,y : in(X), sup(X,N) ; 1@T-N,X,n : issue(X), not in(X), sup(X,N), total(T) }.
""",
    # Young: unit(V,K), the K-th voter of group V; delete some, the strict majority of the
    # others must be in the outcome; fewest deletions.
    'young': BASE + """
unit(V,K) :- votes(V,N), K = 1..N.
{ del(V,K) : unit(V,K) }.
:- del(V,K), K > 1, not del(V,K-1).
left(T-D) :- total(T), D = #count { V,K : del(V,K) }.
s2(X,N) :- issue(X), N = #count { V,K : unit(V,K), yes(V,X), not del(V,K) }.
:- s2(X,N), left(L), N+N > L, not in(X).
:- s2(X,N), left(L), N+N < L, in(X).
:- complete = 1, s2(X,N), left(L), N+N = L.
#minimize { 1,V,K : del(V,K) }.
""",
    # Dodgson: every voter unit gets a new consistent judgment set j(V,K,X); the cost is the
    # number of changed judgments; the strict majority of the new profile is in the outcome.
    'dodgson': BASE + """
unit(V,K) :- votes(V,N), K = 1..N.
{ j(V,K,X) : issue(X) } :- unit(V,K).
:- unit(V,K), cl(C), j(V,K,X) : neg(C,X); not j(V,K,X) : pos(C,X).
change(V,K,X) :- unit(V,K), issue(X), j(V,K,X), not yes(V,X).
change(V,K,X) :- unit(V,K), yes(V,X), not j(V,K,X).
s2(X,N) :- issue(X), N = #count { V,K : j(V,K,X) }.
:- s2(X,N), total(T), N+N > T, not in(X).
:- s2(X,N), total(T), N+N < T, in(X).
:- complete = 1, s2(X,N), total(T), N+N = T.
#minimize { 1,V,K,X : change(V,K,X) }.
""",
}


def clingo_outcomes(facts, rule, complete=False):
    if rule == 'msa':
        return msa_saturation(facts)
    ctl = clingo.Control(['0', '--opt-mode=optN', '--project=show', '--warn=none',
                          '-c', f'complete={1 if complete else 0}'])
    ctl.add('base', [], facts + ENC[rule])
    ctl.ground([('base', [])])
    out = set()
    with ctl.solve(yield_=True) as h:
        for m in h:
            if m.optimality_proven:
                out.add(frozenset(str(s.arguments[0]) for s in m.symbols(shown=True)))
    return out


MSA_SATURATION = """
agree(X) :- maj(X), in(X).
agree(X) :- min(X), not in(X).
% Saturation (Eiter and Gottlob): bad holds in every guess of another judgment set (in2/out2)
% that is not a counterexample, i.e. that breaks a clause, or fails to agree on some issue the
% outcome agrees on, or agrees on nothing more. An outcome survives when every guess is bad.
in2(X) ; out2(X) :- issue(X).
bad :- cl(C), out2(X) : pos(C,X); in2(X) : neg(C,X).
bad :- agree(X), maj(X), out2(X).
bad :- agree(X), min(X), in2(X).
noextra(X) :- agree(X).
noextra(X) :- maj(X), out2(X).
noextra(X) :- min(X), in2(X).
bad :- noextra(X) : maj(X); noextra(Y) : min(Y).
in2(X) :- bad, issue(X).
out2(X) :- bad, issue(X).
:- not bad.
"""


def msa_saturation(facts):
    ctl = clingo.Control(['0', '--project=show', '--warn=none'])
    ctl.add('base', [], facts + BASE + MAJ + MSA_SATURATION)
    ctl.ground([('base', [])])
    out = set()
    with ctl.solve(yield_=True) as h:
        for m in h:
            out.add(frozenset(str(s.arguments[0]) for s in m.symbols(shown=True)))
    return out


# ---- main -------------------------------------------------------------------------------
def instances(path, which):
    if path.endswith('.json'):
        p = json.load(open(path))
        for inst in p.get('instances', []):
            if which == 'all' or inst['id'] in which.split(','):
                if 'facts' not in inst:
                    print(f'{inst["id"]}: recipe only, skipped (write out its facts first)')
                    continue
                yield inst['id'], inst['facts'], inst.get('constants', {})
    else:
        yield path, open(path).read(), {}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('file')
    ap.add_argument('--instance', default='all')
    ap.add_argument('--rule', default='all', help='one of ' + ', '.join(RULES) + ', or all')
    ap.add_argument('--method', default='both', choices=['brute', 'clingo', 'both'])
    ap.add_argument('--complete', action='store_true', help='Young and Dodgson: the majority must also be complete')
    ap.add_argument('--max-issues', type=int, default=12, help='brute force only up to this many issues')
    ap.add_argument('--show', action='store_true', help='print the outcomes')
    a = ap.parse_args()
    rules = RULES if a.rule == 'all' else a.rule.split(',')
    bad = False
    for iid, facts, consts in instances(a.file, a.instance):
        complete = a.complete or consts.get('complete') == '1'
        sc = Scenario(facts, complete)
        row = []
        for r in rules:
            res = {}
            if a.method in ('clingo', 'both'):
                res['clingo'] = clingo_outcomes(facts, r, complete)
            # Dodgson's brute force walks the support vectors of every partial profile: small only.
            limit = min(a.max_issues, 6) if r == 'dodgson' else a.max_issues
            if a.method in ('brute', 'both') and len(sc.issues) <= limit:
                res['brute'] = {frozenset(x for x, b in zip(sc.issues, j) if b) for j in brute(sc, r)}
            vals = list(res.values())
            agree = all(v == vals[0] for v in vals)
            bad |= not agree
            row.append(f'{r} {len(vals[0])}' + ('' if agree else ' DISAGREE ' + str({k: len(v) for k, v in res.items()})))
            if a.show:
                for o in sorted(vals[0], key=sorted):
                    print(f'  {r}: {" ".join(sorted(o)) or "(nothing accepted)"}')
        print(f'{iid} ({len(sc.issues)} issues, {sc.total} voters): ' + ', '.join(row))
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
