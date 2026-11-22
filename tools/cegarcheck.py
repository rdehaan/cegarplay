#!/usr/bin/env python3
"""cegarcheck: check a CegarPlay project with Python clingo (pip install clingo).

    python3 cegarcheck.py project.json [--mode auto|block|clause|clauses|core|expand]
                          [--cex NAME=pred/arity] [--part refine] [--optimal]
                          [-c name=value] [--solutions N|all] [--max-candidates N]
                          [--seconds N] [--show]

A stand-in for the page's engine where the page cannot run (for example in a chat
sandbox). It copies the semantics of CegarPlay's Lua runtime for one abstraction
solver A, one check solver C and one link G = A -> C:

- glue: the link's glue fragments are grounded and solved once; every shown glue(T)
  (with 'legacy': every shown atom) makes T an interface atom.
- an interface atom that is a fact in A is a fact in C; the others are free atoms of C
  fixed by assumptions, each with an atom relevant(T) that only C's rules can derive
  (with 'compat': a free choice).
- each fragment is added after its own '#program base.' line.

The loop: solve A, check the candidate with C, refine A, solve A again.

  block    reject a bad candidate by blocking its interface values (the reference run)
  clause   one clause over the relevant/1 atoms of the counterexample (G.clause)
  clauses  the clauses given by clause(Id, T, true|false) atoms (G.clauses)
  core     C looks for a witness; no witness -> clause from the unsat core (G.core)
           (a script with 'if not C.solve(...)' makes C a witness check in every mode)
  expand   ground '#program refine(k).' with facts NAME(k, T) for the counterexample's
           pred/arity atoms (A.expand(refine, NAME = X.atoms(pred/arity)))

'auto' (the default) reads the mode, the fact names and 'optimal' from the loop script.

Accepted candidates are blocked: in a 'search' script on all atoms of A (as clasp's
enumeration does), in a 'loop' script on the interface atoms (as G.block(M) does). With
'--project' among A's options, also a 'search' script blocks on the interface atoms: that is
clasp's projective enumeration when A shows its interface atoms (as sudoku-hard does).

Only the solution count of an exhausted run can be compared with the page; candidate
counts and statistics differ from Shapes 1 and 4. Raw Lua projects and scripts with more
than two solvers or one link are refused: check those with tools/run.mjs.

Exit code: 0 when the run ends without an error, 1 on an error, 2 on bad usage.
"""
import argparse
import json
import re
import sys
import time

try:
    import clingo
except ImportError:  # pragma: no cover
    sys.exit("cegarcheck: Python clingo is missing (pip install clingo)")


class CheckError(Exception):
    pass


# ---- the loop script --------------------------------------------------------------------

def strip_comments(text):
    out = []
    for line in text.split("\n"):
        res, quoted = "", False
        for ch in line:
            if ch == '"':
                quoted = not quoted
            elif ch == "#" and not quoted:
                break
            res += ch
        out.append(res)
    return "\n".join(out)


SOLVER_RE = re.compile(r'^solver\s+([A-Za-z_]\w*)\s*=\s*([\w\s+]+?)\s*(?:options\s+"([^"]*)")?\s*$')
LINK_RE = re.compile(r'^link\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*->\s*([A-Za-z_]\w*)\s+via\s+([\w\s+]+?)\s*$')


def parse_script(text):
    code = strip_comments(text)
    solvers, links = {}, []
    for line in code.split("\n"):
        s = line.strip()
        if s.startswith("solver "):
            m = SOLVER_RE.match(s)
            if not m:
                raise CheckError(f"cannot read the declaration: {s}")
            solvers[m.group(1)] = {
                "name": m.group(1),
                "frags": [f.strip() for f in m.group(2).split("+")],
                "options": (m.group(3) or "").split(),
            }
        elif s.startswith("link "):
            m = LINK_RE.match(s)
            if not m:
                raise CheckError(f"cannot read the declaration: {s}")
            words = m.group(4).split()
            flags = set()
            while words and words[-1] in ("legacy", "compat", "lift"):
                flags.add(words.pop())
            frags = [f.strip() for f in " ".join(words).split("+")]
            links.append({"name": m.group(1), "from": m.group(2), "to": m.group(3),
                          "frags": frags, "legacy": "legacy" in flags, "compat": "compat" in flags})
    if len(links) != 1 or len(solvers) != 2:
        raise CheckError("cegarcheck handles one link between two solvers; "
                         "check this one with tools/run.mjs")
    L = links[0]
    for end in (L["from"], L["to"]):
        if end not in solvers:
            raise CheckError(f"link {L['name']}: unknown solver {end}")
    info = {"link": L, "A": solvers[L["from"]], "C": solvers[L["to"]], "code": code,
            "search": re.search(r"^\s*search\s", code, re.M) is not None,
            "optimal": re.search(r"\.solve\([^)]*\boptimal\b", code) is not None}
    g = re.escape(L["name"])
    # a witness check: the candidate is bad when C has no model ('if not C.solve(...)')
    info["witness"] = re.search(r"\bnot\s+" + re.escape(L["to"]) + r"\.solve\(", code) is not None
    m = re.search(r"\.expand\(\s*(\w+)\s*((?:,\s*\w+\s*=\s*\w+\.atoms\(\s*\w+\s*/\s*\d+\s*\)\s*)+)\)", code)
    if m:
        info["mode"] = "expand"
        info["part"] = m.group(1)
        info["cex"] = [(a, p, int(n)) for a, p, n in
                       re.findall(r"(\w+)\s*=\s*\w+\.atoms\(\s*(\w+)\s*/\s*(\d+)\s*\)", m.group(2))]
    elif re.search(g + r"\.clauses\(", code):
        info["mode"] = "clauses"
    elif re.search(g + r"\.core\(", code):
        info["mode"] = "core"
    elif re.search(g + r"\.clause\(", code):
        info["mode"] = "clause"
    else:
        info["mode"] = "block"
    return info


# ---- solvers --------------------------------------------------------------------------

def join(fragments, names, what):
    parts = []
    # an instance (format version 2) reaches every solver and glue control first, as in the runtime
    if "instance" in fragments and "instance" not in names:
        names = ["instance"] + list(names)
    for n in names:
        if n not in fragments:
            raise CheckError(f"{what}: unknown fragment '{n}'")
        parts.append("#program base.\n" + fragments[n])
    return "\n".join(parts)


def consts_args(consts):
    out = []
    for k, v in consts.items():
        out += ["-c", f"{k}={v}"]
    return out


def on_message(code, msg):
    msg = msg.strip()
    if msg:
        print(msg, file=sys.stderr)


class Checker:
    def __init__(self, project, info, consts, opts):
        self.info, self.opts = info, opts
        frags = {f["name"]: f["text"] for f in project["fragments"]}
        L, A, C = info["link"], info["A"], info["C"]
        self.L = L
        cargs = consts_args(consts)

        # glue
        g = clingo.Control(cargs + ["1"], logger=on_message)
        g.add("base", [], join(frags, L["frags"], f"link {L['name']}"))
        g.ground([("base", [])])
        iface = set()
        with g.solve(yield_=True) as h:
            for m in h:
                for a in m.symbols(shown=True):
                    if a.type == clingo.SymbolType.Function and a.name == "glue" and len(a.arguments) == 1 and a.positive:
                        iface.add(str(a.arguments[0]))
                    elif L["legacy"]:
                        iface.add(str(a))
                break
        if not iface:
            raise CheckError(f"link {L['name']}: the glue fragments derive no "
                             + ("shown atom" if L["legacy"] else "glue/1 atom"))

        # abstraction
        self.a = clingo.Control(cargs + A["options"], logger=on_message)
        self.a.add("base", [], join(frags, A["frags"], f"solver {A['name']}"))
        self.a.ground([("base", [])])

        # check: interface atoms first, then the check's own rules
        self.c = clingo.Control(cargs + C["options"], logger=on_message)
        self.src, self.dst, self.rel, self.sym = [], [], [], []
        self.jstr = {}
        with self.c.backend() as b:
            for atom in self.a.symbolic_atoms:
                key = str(atom.symbol)
                if key not in iface:
                    continue
                d = b.add_atom(atom.symbol)
                if atom.is_fact:
                    b.add_rule([d], [])
                    continue
                r = b.add_atom(clingo.Function("relevant", [atom.symbol]))
                b.add_rule([d], [], choice=True)
                if L["compat"]:
                    b.add_rule([r], [], choice=True)
                self.jstr[key] = len(self.src)
                self.src.append(atom.literal)
                self.dst.append(d)
                self.rel.append(r)
                self.sym.append(atom.symbol)
        self.c.add("base", [], join(frags, C["frags"], f"solver {C['name']}"))
        self.c.ground([("base", [])])
        if opts.optimal:
            self.c.configuration.solve.opt_mode = "opt"
        self.k = 0

    # a clause (list of A literals, one must hold) becomes an integrity constraint
    def add_clause(self, lits):
        with self.a.backend() as b:
            b.add_rule([], [-l for l in lits])

    def solve_a(self):
        with self.a.solve(yield_=True) as h:
            for m in h:
                return {
                    "v": [m.is_true(l) for l in self.src],
                    "shown": sorted(str(s) for s in m.symbols(shown=True)),
                    "all": [a.literal for a in self.a.symbolic_atoms if not a.is_fact and m.is_true(a.literal)],
                }
        return None

    def solve_c(self, M):
        assume = [d if v else -d for d, v in zip(self.dst, M["v"])]
        core = []
        X = None
        with self.c.solve(yield_=True, assumptions=assume) as h:
            for m in h:
                X = {"rel": [m.is_true(r) for r in self.rel],
                     "atoms": [a for a in m.symbols(atoms=True)],
                     "shown": sorted(str(s) for s in m.symbols(shown=True))}
                if not self.opts.optimal:
                    break
            if X is None and self.opts.witness:
                core = list(h.core())
        return X, core

    def block_interface(self, M):
        return [-l if v else l for l, v in zip(self.src, M["v"])]

    def block_all(self, M):
        lits = set(M["all"])
        return [-l if l in lits else l for l in self.all_literals()]

    def all_literals(self):
        return sorted({a.literal for a in self.a.symbolic_atoms if not a.is_fact})

    def refinement(self, M, X, core):
        mode, Ln = self.opts.mode, self.L["name"]
        if mode == "block":
            return [self.block_interface(M)]
        if mode == "clause":
            c = [(-l if v else l) for l, v, r in zip(self.src, M["v"], X["rel"]) if r]
            if not c:
                raise CheckError(f"relevant/1 derived nothing for link {Ln}")
            return [c]
        if mode == "clauses":
            byid = {}
            for a in X["atoms"]:
                if a.name != "clause" or len(a.arguments) != 3:
                    continue
                i, t, val = (str(x) for x in a.arguments)
                if t not in self.jstr:
                    raise CheckError(f"{Ln}.clauses: {t} is not an interface atom of link {Ln}")
                if val not in ("true", "false"):
                    raise CheckError(f"{Ln}.clauses: the third argument of clause/3 must be true or false, got {val}")
                l = self.src[self.jstr[t]]
                byid.setdefault(i, []).append(l if val == "true" else -l)
            if not byid:
                raise CheckError(f"{Ln}.clauses: solver {self.info['C']['name']} derives no clause/3 atoms")
            return list(byid.values())
        if mode == "core":
            jof = {d: j for j, d in enumerate(self.dst)}
            c, seen = [], set()
            for l in core:
                j = jof.get(abs(l))
                if j is not None and j not in seen:
                    seen.add(j)
                    c.append(-self.src[j] if l > 0 else self.src[j])
            if not c:
                raise CheckError(f"{Ln}.core: the unsat core contains no atom of link {Ln}")
            return [c]
        raise CheckError(f"unknown mode {mode}")

    def expand(self, X):
        self.k += 1
        k = clingo.Number(self.k)
        with self.a.backend() as b:
            for name, pred, arity in self.opts.cex:
                for a in X["atoms"]:
                    if a.type == clingo.SymbolType.Function and a.name == pred and len(a.arguments) == arity:
                        b.add_rule([b.add_atom(clingo.Function(name, [k, a]))], [])
        self.a.ground([(self.opts.part, [k])])

    def run(self, limit, max_candidates, seconds, show):
        t0 = time.time()
        sols = cands = cexs = clauses = 0
        exhausted, last = False, None
        witness = self.opts.witness
        while True:
            if limit and sols >= limit:
                break
            if max_candidates and cands >= max_candidates:
                print(f"stopped: {max_candidates} candidates", file=sys.stderr)
                break
            if seconds and time.time() - t0 > seconds:
                print(f"stopped: {seconds} s", file=sys.stderr)
                break
            M = self.solve_a()
            if M is None:
                exhausted = True
                break
            cands += 1
            X, core = self.solve_c(M)
            bad = (X is None) if witness else (X is not None)
            if bad:
                cexs += 1
                if self.opts.mode == "expand":
                    key = tuple(M["v"])
                    if key == last:
                        raise CheckError("no progress: the refinement did not remove the candidate "
                                         "(do all heads of the refine part contain k?)")
                    last = key
                    self.expand(X)
                    clauses += 1
                else:
                    for c in self.refinement(M, X, core):
                        self.add_clause(c)
                        clauses += 1
            else:
                sols += 1
                last = None
                if show:
                    print(f"Solution {sols}: {' '.join(M['shown'])}")
                projective = any(o.startswith("--project") for o in self.info["A"]["options"])
                self.add_clause(self.block_all(M) if self.info["search"] and not projective
                                else self.block_interface(M))
        return {"solutions": sols, "candidates": cands, "counterexamples": cexs,
                "refinements": clauses, "exhausted": exhausted, "time": time.time() - t0}


def apply_variant(project, name):
    """A variant applied (js/project.js applyVariant): swapped fragment texts, its own loop,
    its constants and settings. name None, "" or "default": the project as it is; without a
    name given, settings.variant when it names a variant."""
    variants = project.get("variants") or []
    if name is None:
        picked = (project.get("settings") or {}).get("variant")
        name = picked if picked and any(v.get("name") == picked for v in variants) else None
    if not name or name == "default":
        return project
    v = next((x for x in variants if x.get("name") == name), None)
    if v is None:
        raise CheckError(f"no variant named '{name}'")
    p = dict(project)
    text = {f["name"]: f.get("text", "") for f in project["fragments"]}
    swap = v.get("swap") or {}
    p["fragments"] = [dict(f, text=text[swap[f["name"]]]) if f["name"] in swap else f for f in project["fragments"]]
    loop = v.get("loop")
    if isinstance(loop, str):
        p["loop"] = {"language": "loop", "text": loop}
    elif isinstance(loop, dict):
        p["loop"] = dict(project.get("loop") or {}, **loop)
    settings = dict(project.get("settings") or {}, **(v.get("settings") or {}))
    settings["constants"] = dict((project.get("settings") or {}).get("constants") or {}, **(v.get("constants") or {}))
    p["settings"] = settings
    return p


def select_instance(project, want):
    """The instance a run uses (js/project.js selectedInstance): the id given, else
    settings.instance, else the first; "" means the project as written."""
    lst = project.get("instances") or []
    if not lst:
        if want:
            raise CheckError(f"no instance named '{want}' (the project has no instances)")
        return None
    if want is None:
        want = (project.get("settings") or {}).get("instance")
    if want == "":
        return None
    if want is None:
        return lst[0]
    for x in lst:
        if x.get("id") == want:
            return x
    raise CheckError(f"no instance named '{want}'")


def recipe_facts(project, recipe):
    """The facts of a recipe, generated with tools/draw.py (the twin of lua/draw.lua)."""
    import os, sys as _sys
    _sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from draw import generate
    gens = {g.get("name"): g for g in project.get("generators") or []}
    g = gens.get(recipe.get("generator"))
    if g is None:
        raise CheckError(f"no generator named '{recipe.get('generator')}'")
    # as js/generate.js paramList: the declared parameters only, a recipe value over the default
    types = g.get("params") or {}
    given, defaults = recipe.get("params") or {}, g.get("defaults") or {}
    params = {}
    for k, t in types.items():
        v = given.get(k)
        if v is None or v == "":
            v = defaults.get(k)
        if v is None or v == "":
            raise CheckError(f"generator {g['name']}: parameter {k} has no value")
        try:
            x = int(v)
        except (TypeError, ValueError):
            raise CheckError(f"generator {g['name']}: parameter {k} must be a whole number, got {v}")
        if t == "permille" and not 0 <= x <= 1000:
            raise CheckError(f"generator {g['name']}: parameter {k} is a permille value (0..1000), got {v}")
        params[k] = x
    unknown = [k for k in given if k not in types]
    if unknown:
        raise CheckError(f"generator {g['name']}: unknown parameter {unknown[0]}")
    return generate(g["text"], params, int(recipe.get("seed") or 0), int(recipe.get("attempts") or 100))["facts"]


def main(argv=None):
    ap = argparse.ArgumentParser(description="Check a CegarPlay project with Python clingo.")
    ap.add_argument("project")
    ap.add_argument("--mode", default="auto", choices=["auto", "block", "clause", "clauses", "core", "expand"])
    ap.add_argument("--cex", action="append", default=[], help="NAME=pred/arity for --mode expand")
    ap.add_argument("--part", default=None, help="the program part for --mode expand (default refine)")
    ap.add_argument("--optimal", action="store_true", default=None)
    ap.add_argument("-c", dest="consts", action="append", default=[], help="name=value")
    ap.add_argument("--solutions", default=None, help="N or all (default: the project's setting)")
    ap.add_argument("--instance", default=None, help="the instance to check (format version 2)")
    ap.add_argument("--variant", default=None, help="the variant to check (default: settings.variant, else the project as it is)")
    ap.add_argument("--max-candidates", type=int, default=1000000)
    ap.add_argument("--seconds", type=float, default=300)
    ap.add_argument("--show", action="store_true", help="print the solutions")
    o = ap.parse_args(argv)
    try:
        with open(o.project, encoding="utf8") as f:
            project = json.load(f)
        if project.get("format") != "cegarplay":
            raise CheckError("not a CegarPlay project (format must be \"cegarplay\")")
        project = apply_variant(project, o.variant)
        loop = project.get("loop") or {}
        if loop.get("language") == "lua":
            raise CheckError("raw Lua projects are not supported; check this one with tools/run.mjs")
        info = parse_script(loop.get("text", ""))
        if o.mode == "auto":
            o.mode = info["mode"]
            if o.optimal is None:
                o.optimal = info["optimal"]
        o.optimal = bool(o.optimal)
        o.witness = info["witness"] or o.mode == "core"
        if o.mode == "expand":
            if o.cex:
                o.cex = [(c.split("=")[0], c.split("=")[1].split("/")[0], int(c.split("/")[1])) for c in o.cex]
            elif info.get("cex"):
                o.cex = info["cex"]
            else:
                raise CheckError("--mode expand needs --cex NAME=pred/arity")
            o.part = o.part or info.get("part", "refine")
        settings = project.get("settings") or {}
        consts = dict((settings.get("constants") or {}))
        inst = select_instance(project, o.instance)
        if inst is not None and inst.get("facts") is None and inst.get("recipe"):
            inst = dict(inst)
            inst["facts"] = recipe_facts(project, inst["recipe"])
        if inst is not None:
            project = dict(project)
            project["fragments"] = [{"name": "instance", "text": inst.get("facts") or ""}] + \
                [f for f in project["fragments"] if f["name"] != "instance"]
            consts.update({k: str(v) for k, v in (inst.get("constants") or {}).items()})
        for c in o.consts:
            if "=" not in c:
                raise CheckError(f"-c {c}: expected name=value")
            k, v = c.split("=", 1)
            consts[k] = v
        if o.solutions is None:
            limit = int(settings.get("solutions") or 0)
        else:
            limit = 0 if o.solutions == "all" else int(o.solutions)
        print(f"Mode: {o.mode}{' (optimal)' if o.optimal else ''}; "
              f"C looks for {'a witness' if o.witness else 'a counterexample'}; "
              f"accepted candidates blocked on {'all atoms' if info['search'] else 'interface atoms'}; "
              f"constants: {' '.join(f'{k}={v}' for k, v in consts.items()) or 'none'}")
        ch = Checker(project, info, consts, o)
        r = ch.run(limit, o.max_candidates, o.seconds, o.show)
    except CheckError as e:
        print(f"error: {e}")
        return 1
    except RuntimeError as e:
        print(f"error: clingo: {e}")
        return 1
    print(f"Outcome: finished; exhausted: {'yes' if r['exhausted'] else 'no'}")
    print(f"Solutions: {r['solutions']}; candidates: {r['candidates']}; "
          f"counterexamples: {r['counterexamples']}; refinements: {r['refinements']}; time: {r['time']:.2f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
