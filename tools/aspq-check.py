#!/usr/bin/env python3
"""Checks the ASP(Q) examples by brute force (tools/make-aspq.py writes them).

    python3 tools/aspq-check.py instances
        every instance of the generic examples (aspq, aspq-deep): the quantified answer sets
        counted by brute force against the instance's expected count
    python3 tools/aspq-check.py count FILE.aspq ...
        the number of quantified answer sets of ASP(Q) files (%@exists / %@forall / %@constraint)
    python3 tools/aspq-check.py random N [--depth D] [--seed S] [--separate] [--loops] [--qasp PYQASP]
        N random programs of D levels (default 2): brute force, and with --loops every variant
        of aspq (D = 2) or aspq-deep (any D) on all of them (node tools/run.mjs), with --qasp
        the solver pyqasp (its path) on each; --separate: no atom is the head of both a choice
        rule and a normal rule (pyqasp loses answer sets of such programs)
    python3 tools/aspq-check.py minmax
        every instance of aspq-minmax-clique, counted on the graph directly

The brute force uses no solver: the answer sets of a level are the subsets S of its atoms
that are models of its rules and the least models of their reducts (choice rules: Simons,
Niemela and Soininen), with the atoms of the outer levels fixed (fix_P of Amendola, Ricca and
Truszczynski). Only clingo's parser is used, to read the rules.
"""
import importlib.util, itertools, json, os, random, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("make_aspq", os.path.join(ROOT, "tools", "make-aspq.py"))
MA = importlib.util.module_from_spec(spec)
spec.loader.exec_module(MA)


class Program:
    def __init__(self, text):
        levels, cons = MA.parse_program(text)
        self.quant = [q for q, _ in levels]
        self.rules = [rs for _, rs in levels]
        self.cons = cons
        self.owner = {}
        for i, rs in enumerate(self.rules + [cons]):
            for kind, heads, pos, neg in rs:
                for a in heads + pos + neg:
                    self.owner.setdefault(a, i)
        n = len(self.rules)
        # The reduct of level i depends on an interpretation only through its own atoms that
        # occur negatively or in the head of a choice rule; guessing those suffices.
        self.guess = [sorted({a for kind, hs, _, ng in self.rules[i] for a in ng + (hs if kind == "choice" else [])
                              if self.owner[a] == i}) for i in range(n)]

    def answer_sets(self, i, fixed):
        """The answer sets of level i (0-based) with the outer atoms fixed (a set of true atoms;
        every other outer atom is false): a list of sets of own atoms. For each guess T on the
        atoms that fix the reduct, the least model L of that reduct is an answer set iff it
        agrees with T and satisfies every rule (constraints, and heads of outer atoms)."""
        rules, guess, out = self.rules[i], self.guess[i], []
        for bits in itertools.product((0, 1), repeat=len(guess)):
            T = {a for a, b in zip(guess, bits) if b}
            # the least model of the reduct, own atoms only (outer atoms are fixed)
            L, changed = set(), True
            while changed:
                changed = False
                for kind, heads, pos, neg in rules:
                    if kind == "constraint" or any(q in fixed or q in T for q in neg):
                        continue
                    if not all(p in L or p in fixed for p in pos):
                        continue
                    for h in heads:
                        if self.owner[h] == i and h not in L and (kind == "rule" or h in T):
                            L.add(h); changed = True
            if {a for a in L if a in guess} != T:
                continue
            I = fixed | L
            ok = True
            for kind, heads, pos, neg in rules:
                body = all(p in I for p in pos) and not any(q in I for q in neg)
                if body and kind == "constraint": ok = False; break
                if body and kind == "rule" and heads[0] not in I: ok = False; break
            if ok:
                out.append(L)
        return out

    def holds(self, i, fixed):
        if i == len(self.rules):
            return not any(all(p in fixed for p in pos) and not any(q in fixed for q in neg)
                           for _, _, pos, neg in self.cons)
        sets = self.answer_sets(i, fixed)
        if self.quant[i] == "exists":
            return any(self.holds(i + 1, fixed | S) for S in sets)
        return all(self.holds(i + 1, fixed | S) for S in sets)

    def count(self):
        """The quantified answer sets: answer sets of P1 for which the rest holds."""
        assert self.quant[0] == "exists"
        return sum(1 for S in self.answer_sets(0, set()) if self.holds(1, S))


# ---------------------------------------------------------------------------
# Random programs
# ---------------------------------------------------------------------------
def minmax_count(data):
    """The picks t (one block per row) whose blocks hold no clique of k vertices."""
    vs, es, k = data
    E = set(es) | {(b, a) for a, b in es}
    rows = sorted({i for _, i, _ in vs})
    cols = {i: sorted({j for _, r, j in vs if r == i}) for i in rows}
    n = 0
    for pick in itertools.product(*[cols[i] for i in rows]):
        t = dict(zip(rows, pick))
        U = [v for v, i, j in vs if t[i] == j]
        if not any(all((a, b) in E for a, b in itertools.combinations(Q, 2)) for Q in itertools.combinations(U, k)):
            n += 1
    return n


def run_loops(example, programs, expected):
    """Every variant of the example on the programs; returns the mismatches per variant."""
    proj = json.load(open(os.path.join(ROOT, "examples", "contrib", example + ".json")))
    proj.pop("library", None)
    insts = []
    for k, (p, e) in enumerate(zip(programs, expected)):
        facts = MA.to_facts(p)
        c = {"depth": str(len(Program(p).rules))} if example == "aspq-deep" else {}
        insts.append({"id": f"r{k}", "facts": facts, "constants": c, "expected": {"solutions": e}, "tags": []})
    proj["instances"] = insts
    proj["settings"]["instance"] = "r0"
    bad = {}
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, example + "-random.json")
        json.dump(proj, open(path, "w"))
        for v in [None] + [x["name"] for x in proj.get("variants", [])]:
            cmd = ["node", os.path.join(ROOT, "tools", "run.mjs"), path, "--instance", "all", "--solutions", "all", "--quiet", "--seconds", "60"]
            if v: cmd += ["--variant", v]
            r = subprocess.run(cmd, capture_output=True, text=True)
            lines = [l for l in r.stdout.splitlines() if l.strip().startswith("r")]
            wrong = [l for l in lines if "MISMATCH" in l or "as expected" not in l]
            if r.returncode != 0 or len(lines) < len(programs):
                wrong = wrong or (r.stdout + r.stderr).splitlines()[-5:]
            bad[v or "default"] = wrong
    return bad


def qasp_count(pyqasp, text):
    with tempfile.NamedTemporaryFile("w", suffix=".aspq", delete=False) as f:
        f.write(text)
    try:
        r = subprocess.run([pyqasp, "-s", "quabs", "-g", "gringo", "--no-wf", "--count-qans", f.name],
                           capture_output=True, text=True, timeout=300)
        for l in r.stdout.splitlines():
            if l.startswith("Quantified Answer Set"):
                return int(l.split(":")[1])
        return 0 if r.returncode == 20 else None   # 20: false (QBF convention), printed without a count
    finally:
        os.unlink(f.name)


def main(args):
    if not args:
        print(__doc__); return 2
    cmd = args[0]
    if cmd == "count":
        for f in args[1:]:
            print(f, Program(open(f).read()).count())
        return 0
    if cmd == "instances":
        bad = 0
        for name, _, insts in MA.BUILDERS:
            for i in insts:
                if "program" not in i:
                    continue
                n = Program(i["program"]).count()
                e = i["expected"]["solutions"]
                ok = n == e
                bad += not ok
                print(f"{name:12} {i['id']:22} brute force {n:4}  expected {e}  {'ok' if ok else 'MISMATCH'}")
        return 1 if bad else 0
    if cmd == "minmax":
        bad = 0
        for i in MA.MM_INSTANCES:
            n, e = minmax_count(i["data"]), i["expected"]["solutions"]
            bad += n != e
            print(f"{i['id']:22} brute force {n:4}  expected {e}  {'ok' if n == e else 'MISMATCH'}")
        return 1 if bad else 0
    if cmd == "random":
        n = int(args[1])
        depth = int(args[args.index("--depth") + 1]) if "--depth" in args else 2
        seed = int(args[args.index("--seed") + 1]) if "--seed" in args else 1
        pyqasp = args[args.index("--qasp") + 1] if "--qasp" in args else None
        rng = random.Random(seed)
        progs = [MA.random_program(rng, depth, separate="--separate" in args or "--plain" in args,
                                outer_heads="--plain" not in args) for _ in range(n)]
        counts = [Program(p).count() for p in progs]
        print(f"{n} random programs of depth {depth} (seed {seed}): counts {counts}")
        print(f"  zero: {counts.count(0)}, nonzero: {n - counts.count(0)}")
        bad = 0
        if pyqasp:
            for k, p in enumerate(progs):
                q = qasp_count(pyqasp, p)
                if q != counts[k]:
                    bad += 1
                    print(f"  pyqasp r{k}: {q} vs brute force {counts[k]}\n{p}")
            print(f"  pyqasp: {n - bad} of {n} agree")
        if "--loops" in args:
            ex = "aspq" if depth == 2 and "--deep" not in args else "aspq-deep"
            for v, wrong in run_loops(ex, progs, counts).items():
                print(f"  {ex} {v}: {'all agree' if not wrong else 'DISAGREE'}")
                for l in wrong[:10]:
                    print("    " + l)
                bad += bool(wrong)
        return 1 if bad else 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
