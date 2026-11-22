#!/usr/bin/env python3
"""Check a CegarPlay proof log with Python clingo (docs/spec-soundness.md section 6).

    python3 tools/certcheck.py <project.json> <log.jsonl> [--json]

The log is a recording with settings.record.proof (tools/run.mjs --proof): a header line, the I
and Q events, the R events (with x = the counterexample over the Q table, v = the certificate
level) and the M events. Four checks, with code that shares nothing with lua/:

  1. every counterexample is an answer set of the check under its candidate;
  2. every refinement carries a certificate that verifies at its level (0 a full block, 1 the
     check is unsatisfiable under the kept values, 2 this file's own well-founded evaluation,
     3 this file's own product of abstraction and check, 4 an exhaustive search);
  3. no solution has a counterexample;
  4. the abstraction with every refinement and the block of every solution is unsatisfiable.

Exit code 0 when the log passes, 1 when a check fails, 2 on bad usage or an unsupported log.
"""
import argparse
import json
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import clingo  # noqa: E402
from cegarcheck import parse_script, join, consts_args, select_instance, recipe_facts, CheckError  # noqa: E402


class Reject(Exception):
    def __init__(self, check, msg):
        super().__init__(msg)
        self.check, self.msg = check, msg


class Unsupported(Exception):
    pass


def fnv(text):
    """hashText of js/stats.js: FNV-1a over UTF-16 code units, 8 hex digits."""
    h = 2166136261
    data = text.encode("utf-16-le")
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 16777619) & 0xFFFFFFFF
    return "%08x" % h


def bits(hexs, n):
    """hexBits of js/recording.js: atom j (1-based) is bit (j-1) % 4 of hex digit (j-1) // 4,
    digits most significant first."""
    out = [False] * (n + 1)
    L = len(hexs or "")
    for j in range(1, n + 1):
        k = L - 1 - ((j - 1) >> 2)
        if k < 0:
            break
        out[j] = bool((int(hexs[k], 16) >> ((j - 1) & 3)) & 1)
    return out


class Store:
    """The ground rules a control produces: (choice, heads, body, weights or None, lower)."""

    def __init__(self):
        self.rules = []
        self.maxatom = 0

    def rule(self, choice, head, body):
        self.rules.append((choice, list(head), list(body), None, None))
        self.maxatom = max([self.maxatom] + list(head) + [abs(l) for l in body])

    def weight_rule(self, choice, head, lower_bound, body):
        self.rules.append((choice, list(head), [l for l, _ in body], [w for _, w in body], lower_bound))
        self.maxatom = max([self.maxatom] + list(head) + [abs(l) for l, _ in body])


class Programs:
    """Abstraction A and check C with the link's semantics: the glue's atoms that are facts of A
    are facts of C, the others free choices of C (and relevant(T) atoms), as the page does."""

    def __init__(self, project, info, consts):
        frags = {f["name"]: f["text"] for f in project["fragments"]}
        L, A, C = info["link"], info["A"], info["C"]
        cargs = consts_args(consts)
        g = clingo.Control(cargs + ["1"], logger=lambda c, m: None)
        g.add("base", [], join(frags, L["frags"], "link " + L["name"]))
        g.ground([("base", [])])
        iface = set()
        with g.solve(yield_=True) as h:
            for m in h:
                for a in m.symbols(shown=True):
                    if a.type == clingo.SymbolType.Function and a.name == "glue" and len(a.arguments) == 1:
                        iface.add(str(a.arguments[0]))
                    elif L["legacy"]:
                        iface.add(str(a))
                break
        self.astore, self.cstore = Store(), Store()
        self.a = clingo.Control(cargs + ["--opt-mode=ignore"], logger=lambda c, m: None)
        self.a.register_observer(self.astore)
        self.a.add("base", [], join(frags, A["frags"], "solver " + A["name"]))
        self.a.ground([("base", [])])
        self.a.configuration.solve.models = "0"          # level 4 walks every candidate
        self.c = clingo.Control(cargs + ["--opt-mode=ignore"], logger=lambda c, m: None)
        self.c.register_observer(self.cstore)
        self.src, self.dst, self.index = [], [], {}
        with self.c.backend() as b:
            for atom in self.a.symbolic_atoms:
                key = str(atom.symbol)
                if key not in iface:
                    continue
                d = b.add_atom(atom.symbol)
                if atom.is_fact:
                    b.add_rule([d], [])
                    continue
                b.add_atom(clingo.Function("relevant", [atom.symbol]))
                b.add_rule([d], [], choice=True)
                self.index[key] = len(self.src)
                self.src.append(atom.literal)
                self.dst.append(d)
        self.c.add("base", [], join(frags, C["frags"], "solver " + C["name"]))
        self.c.ground([("base", [])])
        self.isint = {d: k for k, d in enumerate(self.dst)}

    def sat(self, ctl, assumptions):
        with ctl.solve(assumptions=assumptions, yield_=True) as h:
            for m in h:
                return m
        return None

    def model_c(self, assumptions):
        with self.c.solve(assumptions=assumptions, yield_=True) as h:
            for m in h:
                return {a: m.is_true(a) for a in range(1, self.cstore.maxatom + 1)}
        return None


# ---- level 2: three-valued (well-founded) evaluation of the check under X's guesses ----------

def heads(store, tv, isint):
    H = []
    for choice, head, body, w, lower in store.rules:
        if not head:
            H.append(("constraint", []))
        elif not choice and head[0] in isint:
            H.append(("guard", [a for a in head if a in isint]))
        else:
            H.append(("rule", [a for a in head if a not in isint and (not choice or tv.get(a))]))
    return H


def body_holds(rule, pos, negref):
    choice, head, body, w, lower = rule
    if w is not None:
        s = 0
        for l, wt in zip(body, w):
            if (l > 0 and l in pos) or (l < 0 and -l not in negref):
                s += wt
        return s >= lower
    return all((l in pos) if l > 0 else (-l not in negref) for l in body)


def least_model(store, H, base, negref):
    """Least model of the positive program where a negative literal not b holds iff b is not in
    negref (a fixpoint by iteration: simple and independent of the runtime's counters)."""
    M = set(base)
    changed = True
    while changed:
        changed = False
        for r, (kind, hs) in zip(store.rules, H):
            if kind != "rule" or not hs:
                continue
            if all(h in M for h in hs):
                continue
            if body_holds(r, M, negref):
                for h in hs:
                    if h not in M:
                        M.add(h)
                        changed = True
    return M


def level2(P, tv, vals):
    st = P.cstore
    if any(not ch and len(hd) > 1 for ch, hd, _, _, _ in st.rules):
        return False
    if any(w is not None and any(x < 0 for x in w) for _, _, _, w, _ in st.rules):
        return False
    H = heads(st, tv, P.isint)
    inK = {P.dst[k] for k, v in vals.items() if v}
    inPT = inK | {P.dst[k] for k in range(len(P.dst)) if k not in vals}
    K = set(inK)
    PT = least_model(st, H, inPT, K)
    while True:
        K2 = least_model(st, H, inK, PT)
        PT2 = least_model(st, H, inPT, K2)
        done = K2 == K and PT2 == PT
        K, PT = K2, PT2
        if done:
            break
    edges, neg = {}, []
    for r, (kind, hs) in zip(st.rules, H):
        if kind == "constraint":
            if body_holds(r, PT, K):
                return False
        elif kind == "guard":
            if not any(a in K for a in hs) and body_holds(r, PT, K):
                return False
        elif hs and body_holds(r, PT, K):
            for h in hs:
                if h in PT and h not in K:
                    for l in r[2]:
                        b = abs(l)
                        if b in PT and b not in K:
                            edges.setdefault(b, []).append(h)
                            if l < 0:
                                neg.append((b, h))
    for b, h in neg:                      # a negative edge on a cycle among the undecided atoms
        seen, stack = {h}, [h]
        while stack:
            a = stack.pop()
            if a == b:
                return False
            for x in edges.get(a, []):
                if x not in seen:
                    seen.add(x)
                    stack.append(x)
    return True


# ---- level 3: one solver call on a product of abstraction and check --------------------------

def stratified(store, skip):
    edges, neg = {}, []
    for _, head, body, _, _ in store.rules:
        for h in head:
            if h in skip:
                continue
            for l in body:
                edges.setdefault(abs(l), []).append(h)
                if l < 0:
                    neg.append((abs(l), h))
    for b, h in neg:
        seen, stack = {h}, [h]
        while stack:
            a = stack.pop()
            if a == b:
                return False
            for x in edges.get(a, []):
                if x not in seen:
                    seen.add(x)
                    stack.append(x)
    return True


def level3(P, tv, vals):
    sa, sc = P.astore, P.cstore
    if any(not ch and len(hd) > 1 for ch, hd, _, _, _ in sa.rules + sc.rules):
        return False
    if not stratified(sc, set(P.isint)):
        return False
    q = clingo.Control(["--opt-mode=ignore"], logger=lambda c, m: None)
    amap, cmap, sel = {}, {}, {}
    with q.backend() as b:
        def am(a):
            if a not in amap:
                amap[a] = b.add_atom()
            return amap[a]

        def cm(a):
            if a in P.isint:
                return am(P.src[P.isint[a]])
            if a not in cmap:
                cmap[a] = b.add_atom()
            return cmap[a]

        def lits(body, f):
            return [f(l) if l > 0 else -f(-l) for l in body]

        def add(head, body, rule, choice):
            _, _, _, w, lower = rule
            if w is not None:
                b.add_weight_rule(head, lower, list(zip(body, w)), choice)
            else:
                b.add_rule(head, body, choice)

        for r in sa.rules:
            add([am(h) for h in r[1]], lits(r[2], am), r, r[0])
        violated = b.add_atom()
        for r in sc.rules:
            choice, head, body = r[0], r[1], lits(r[2], cm)
            if not head:
                add([violated], body, r, False)
            elif choice:
                for h in head:
                    if h in P.isint:
                        continue
                    if h not in sel:
                        sel[h] = b.add_atom()
                        b.add_rule([sel[h]], [], True)
                    if r[3] is not None:
                        aux = b.add_atom()
                        add([aux], body, r, False)
                        b.add_rule([cm(h)], [aux, sel[h]])
                    else:
                        b.add_rule([cm(h)], body + [sel[h]])
            elif head[0] in P.isint:
                na = -am(P.src[P.isint[head[0]]])
                if r[3] is not None:
                    aux = b.add_atom()
                    add([aux], body, r, False)
                    b.add_rule([violated], [aux, na])
                else:
                    b.add_rule([violated], body + [na])
            else:
                add([cm(h) for h in head], body, r, False)
    q.ground([("base", [])])
    assume = [violated]
    for k, v in vals.items():
        a = amap.get(P.src[k])
        if a is None:
            if v:
                return False
            continue
        assume.append(a if v else -a)
    for h, s in sel.items():
        assume.append(s if tv.get(h) else -s)
    with q.solve(assumptions=assume, yield_=True) as hd:
        for _ in hd:
            return False
    return True


def level4(P, vals):
    """No candidate of A that agrees with vals lacks a counterexample (exhaustive)."""
    lits = []
    for k, v in vals.items():
        lits.append(P.src[k] if v else -P.src[k])
    seen = set()
    with P.a.solve(assumptions=lits, yield_=True) as h:
        cands = []
        for m in h:
            v = tuple(m.is_true(s) for s in P.src)
            if v not in seen:
                seen.add(v)
                cands.append(v)
    for v in cands:
        if P.model_c([d if x else -d for d, x in zip(P.dst, v)]) is None:
            return False
    return True


# ---- the checks --------------------------------------------------------------------------

def read_log(path):
    header, events = None, []
    import gzip
    with open(path, "rb") as fb:
        gz = fb.read(2) == b"\x1f\x8b"
    with (gzip.open(path, "rt", encoding="utf8") if gz else open(path, encoding="utf8")) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if header is None and not line.startswith("@@"):
                header = json.loads(line)
                continue
            if line.startswith("@@") and line[3] == " ":
                events.append((line[2], json.loads(line[4:])))
    return header or {}, events


def check(project, log_path):
    header, events = read_log(log_path)
    loop = project.get("loop") or {}
    if loop.get("language") == "lua":
        raise Unsupported("raw Lua loops are not checked")
    info = parse_script(loop.get("text", ""))
    if info["witness"]:
        raise Unsupported("witness checks (a solution has a model of the check) are not checked")
    settings = project.get("settings") or {}
    consts = dict(settings.get("constants") or {})
    inst = select_instance(project, header.get("instance") if header.get("instance") else ("" if project.get("instances") else None))
    frag_list = list(project["fragments"])
    if inst is not None:
        facts = inst.get("facts")
        if facts is None and inst.get("recipe"):
            facts = recipe_facts(project, inst["recipe"])
        frag_list = [{"name": "instance", "text": facts or ""}] + [f for f in frag_list if f["name"] != "instance"]
        consts.update({k: str(v) for k, v in (inst.get("constants") or {}).items()})
        project = dict(project, fragments=frag_list)
    want = header.get("fragmentsHash")
    if want:
        got = fnv(json.dumps([[[f["name"], f.get("text", "")] for f in frag_list], consts], separators=(",", ":"), ensure_ascii=False))
        if got != want:
            raise Reject(0, f"the log is not of this project (fragments hash {want}, project {got})")
    I = next((d for k, d in events if k == "I"), None)
    if not I:
        raise Reject(0, "the log has no I event (record with settings.record)")
    if not (I.get("record") or {}).get("proof"):
        raise Reject(0, "the log was not written with settings.record.proof")
    L = I["links"][0]
    n = len(L["atoms"])
    Qs = {d["solver"]: d["atoms"] for k, d in events if k == "Q"}
    P = Programs(project, info, consts)
    jmap = []
    for a in L["atoms"]:
        if a not in P.index:
            raise Reject(0, f"interface atom {a} of the log is not an interface atom of the project")
        jmap.append(P.index[a])
    qatoms = Qs.get(info["C"]["name"])
    if qatoms is None:
        raise Reject(0, f"the log has no Q event for the check {info['C']['name']}")
    qlit = []
    for t in qatoms:
        sym = clingo.parse_term(t)
        sa = P.c.symbolic_atoms[sym]
        qlit.append(sa.literal if sa is not None else None)
    steps = [d for k, d in events if k == "R"]
    if any(s["k"] == "e" for s in steps):
        raise Unsupported("expansions are not checked")

    def cand_assume(c):
        b = bits(c, n)
        return [P.dst[jmap[j - 1]] if b[j] else -P.dst[jmap[j - 1]] for j in range(1, n + 1)], b

    stats = {"counterexamples": 0, "certificates": {}, "solutions": 0, "refinements": 0}
    clauses, solutions = [], []
    reported = {x.get("c") for x in steps if x["k"] == "s"}
    # a copy of A that gets the refinements in order: a solution must be a candidate that the
    # refinements before it left (else a fake solution would raise the count)
    frags = {f["name"]: f["text"] for f in project["fragments"]}
    a2 = clingo.Control(consts_args(consts) + ["--opt-mode=ignore"], logger=lambda c, m: None)
    a2.add("base", [], join(frags, info["A"]["frags"], "solver " + info["A"]["name"]))
    a2.ground([("base", [])])
    a2lit = {}
    for atom in a2.symbolic_atoms:
        a2lit[str(atom.symbol)] = atom.literal
    def a2_assume(c):
        b = bits(c, n)
        return [a2lit[t] if b[j] else -a2lit[t] for j, t in enumerate(L["atoms"], 1)]
    def a2_add(q):
        with a2.backend() as bk:
            bk.add_rule([], [-(a2lit[L["atoms"][abs(x) - 1]] if x > 0 else -a2lit[L["atoms"][abs(x) - 1]]) for x in q])
    for s in steps:
        if s["k"] == "s":
            if any(t not in a2lit for t in L["atoms"]):
                raise Reject(3, "an interface atom is not an atom of the abstraction")
            if P.sat(a2, a2_assume(s.get("c") or "")) is None:
                raise Reject(3, f"step {s['i']}: the solution is not a candidate left by the refinements before it")
            solutions.append(s.get("c"))
            continue
        if s["k"] not in ("r", "a") or "q" not in s:
            continue
        stats["refinements"] += 1
        q = s["q"]
        clauses.append(q)
        if all(t in a2lit for t in L["atoms"]):
            a2_add(q)
        vals = {jmap[abs(x) - 1]: x < 0 for x in q}       # the values the clause removes
        tv = None
        if s.get("x") is not None:
            if not s.get("c"):
                raise Reject(1, f"step {s['i']}: a counterexample without a candidate")
            ca, _ = cand_assume(s["c"])
            xb = bits(s["x"], len(qatoms))
            qa = []
            for j, lit in enumerate(qlit, 1):
                if lit is None:
                    if xb[j]:
                        raise Reject(1, f"step {s['i']}: the counterexample has {qatoms[j - 1]}, which the check cannot derive")
                    continue
                qa.append(lit if xb[j] else -lit)
            tv = P.model_c(ca + qa)
            if tv is None:
                raise Reject(1, f"step {s['i']}: the counterexample is not an answer set of the check under its candidate")
            stats["counterexamples"] += 1
        level = s.get("v")
        if level is None:
            raise Reject(2, f"step {s['i']}: the refinement has no certificate")
        stats["certificates"][str(level)] = stats["certificates"].get(str(level), 0) + 1
        if level == 0:
            cb = bits(s.get("c") or "", n)
            if len({abs(x) for x in q}) != n or len(q) != n or not all((x > 0) != cb[abs(x)] for x in q):
                raise Reject(2, f"step {s['i']}: a level-0 certificate needs a full block of the candidate")
            # the block removes only its candidate: an accepted (reported) solution, or a
            # candidate that has a counterexample
            if s.get("c") not in reported:
                ca, _ = cand_assume(s.get("c") or "")
                if P.model_c(ca) is None:
                    raise Reject(2, f"step {s['i']}: a level-0 block removes a candidate that is neither a reported solution nor refuted")
        elif level == 1:
            if P.model_c([P.dst[k] if v else -P.dst[k] for k, v in vals.items()]) is not None:
                raise Reject(2, f"step {s['i']}: level 1: the check has a model under the kept values")
        elif level in (2, 3):
            if tv is None:
                raise Reject(2, f"step {s['i']}: a level-{level} certificate needs the counterexample")
            if not (level2(P, tv, vals) if level == 2 else level3(P, tv, vals)):
                raise Reject(2, f"step {s['i']}: the level-{level} certificate does not verify")
        elif level == 4:
            if not level4(P, vals):
                raise Reject(2, f"step {s['i']}: level 4: a removed candidate has no counterexample")
        else:
            raise Reject(2, f"step {s['i']}: unknown certificate level {level}")
    # 3. no solution has a counterexample
    for c in solutions:
        ca, _ = cand_assume(c)
        if P.model_c(ca) is not None:
            raise Reject(3, f"the solution {c} has a counterexample")
    stats["solutions"] = len(solutions)
    if len(set(solutions)) != len(solutions):
        raise Reject(3, "a solution is reported twice")
    M = [d for k, d in events if k == "M"]
    if len(M) != len(solutions):
        raise Reject(3, f"{len(M)} solutions printed, {len(solutions)} solution steps")
    # 4. the abstraction with every refinement and every solution blocked is unsatisfiable
    with P.a.backend() as b:
        for q in clauses:
            b.add_rule([], [-(P.src[jmap[abs(x) - 1]] if x > 0 else -P.src[jmap[abs(x) - 1]]) for x in q])
        for c in solutions:
            cb = bits(c, n)
            b.add_rule([], [P.src[jmap[j - 1]] if cb[j] else -P.src[jmap[j - 1]] for j in range(1, n + 1)])
    if P.sat(P.a, []) is not None:
        raise Reject(4, "the abstraction with every refinement and every solution blocked still has a model")
    return stats


def main(argv=None):
    ap = argparse.ArgumentParser(description="Check a CegarPlay proof log.")
    ap.add_argument("project")
    ap.add_argument("log")
    ap.add_argument("--json", action="store_true")
    o = ap.parse_args(argv)
    try:
        with open(o.project, encoding="utf8") as f:
            project = json.load(f)
        stats = check(project, o.log)
        verdict = {"verdict": "certified", **stats}
        verdict["fragmentsHash"] = read_log(o.log)[0].get("fragmentsHash")
        code = 0
    except Reject as e:
        verdict, code = {"verdict": "rejected", "check": e.check, "reason": e.msg, "fragmentsHash": read_log(o.log)[0].get("fragmentsHash")}, 1
    except (Unsupported, CheckError) as e:
        verdict, code = {"verdict": "unsupported", "reason": str(e)}, 2
    if o.json:
        print(json.dumps(verdict))
    elif verdict["verdict"] == "certified":
        print(f"certified: {verdict['solutions']} solutions; {verdict['refinements']} refinements "
              f"(levels {verdict['certificates']}), {verdict['counterexamples']} counterexamples checked")
    else:
        print(f"{verdict['verdict']}" + (f" at check {verdict['check']}" if 'check' in verdict else "") + f": {verdict['reason']}")
    return code


if __name__ == "__main__":
    sys.exit(main())
