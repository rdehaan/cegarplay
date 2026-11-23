#!/usr/bin/env python3
"""multicheck: a brute-force reference for loops with several checks (Python clingo).

    python3 multicheck.py project.json [--instance ID] [--variant NAME] [-c name=value]
                          [--limit N] [--json]

The second checker next to cegarcheck.py, for the "several solvers" family (FUTURE-DIRECTIONS,
Checking tools): one abstraction A and any number of checks C1, C2, ..., each with a link from A
(nash, boolean-game, abduction-two-checks, minimal-reasons, lang-two-stage, ...). It knows
nothing of the loop's refinements: it enumerates every candidate of A (projected on the
interface atoms of all links) and asks every check:

- a check whose script line reads `if not C.solve(...)` is a witness check: the candidate is
  good only if C has a model under it;
- any other check looks for a counterexample: the candidate is good only if C has none.

A candidate that every check lets through is a solution. The count compares with the solution
count of an exhausted run of the page (tools/run.mjs --solutions all). Interface atoms, glue and
relevant/1 follow cegarcheck.py (whose Checker builds each check). Chains (a check that passes
models on), searches inside checks and optimisation are refused. Exit code 0, 1 on an error,
2 on bad usage.
"""
import argparse
import importlib.util
import json
import os
import re
import sys

import clingo

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("cegarcheck", os.path.join(HERE, "cegarcheck.py"))
cc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cc)


def declarations(code):
    solvers, links = {}, []
    for line in code.split("\n"):
        s = line.strip()
        if s.startswith("solver "):
            m = cc.SOLVER_RE.match(s)
            if not m:
                raise cc.CheckError(f"cannot read the declaration: {s}")
            if "[" in m.group(1):
                raise cc.CheckError("solver families are not modelled")
            solvers[m.group(1)] = {"name": m.group(1), "frags": [f.strip() for f in m.group(2).split("+")],
                                   "options": (m.group(3) or "").split()}
        elif s.startswith("link "):
            m = cc.LINK_RE.match(s)
            if not m:
                raise cc.CheckError(f"cannot read the declaration: {s}")
            words = m.group(4).split()
            flags = set()
            while words and words[-1] in ("legacy", "compat", "lift"):
                flags.add(words.pop())
            links.append({"name": m.group(1), "from": m.group(2), "to": m.group(3),
                          "frags": [f.strip() for f in " ".join(words).split("+")],
                          "legacy": "legacy" in flags, "compat": "compat" in flags})
    return solvers, links


def plan(code):
    solvers, links = declarations(code)
    if not links:
        raise cc.CheckError("the script declares no link")
    tops = {L["from"] for L in links} - {L["to"] for L in links}
    if len(tops) != 1:
        raise cc.CheckError("several solvers without an incoming link (or a cycle): not modelled")
    top = tops.pop()
    for L in links:
        if L["from"] != top:
            raise cc.CheckError(f"link {L['name']} starts at {L['from']}, not at the abstraction {top} (a chain): not modelled")
        if any(K["from"] == L["to"] for K in links):
            raise cc.CheckError(f"solver {L['to']} passes models on (a chain): not modelled")
    body = "\n".join(l.split("#", 1)[0] for l in code.split("\n"))
    for L in links:
        if re.search(r"^\s*search\s+" + re.escape(L["to"]) + r"\b", body, re.M):
            raise cc.CheckError(f"a search of the check {L['to']} is not modelled")
    if re.search(r"\boptimal\b|\.cost\b|\btrack\b", body):
        raise cc.CheckError("optimisation is not modelled")
    checks = []
    for L in links:
        witness = re.search(r"\bnot\s+" + re.escape(L["to"]) + r"\.solve\(", body) is not None
        checks.append({"link": L, "A": solvers[top], "C": solvers[L["to"]], "witness": witness})
    return solvers[top], checks


class Opts:
    optimal = False


def count(project, consts, limit):
    loop = project.get("loop") or {}
    if loop.get("language") == "lua":
        raise cc.CheckError("raw Lua loops are not modelled")
    A, checks = plan(cc.strip_comments(loop.get("text", "")))
    built = [(c, cc.Checker(project, {"link": c["link"], "A": c["A"], "C": c["C"]}, consts, Opts())) for c in checks]
    frags = {f["name"]: f["text"] for f in project["fragments"]}
    a = clingo.Control(cc.consts_args(consts) + A["options"] + ["0", "--opt-mode=ignore"], logger=cc.on_message)
    a.add("base", [], cc.join(frags, A["frags"], f"solver {A['name']}"))
    a.ground([("base", [])])
    # the union of the interface atoms, as literals of this control
    syms = {}
    for _, ch in built:
        for s in ch.sym:
            sa = a.symbolic_atoms[s]
            if sa is not None:
                syms[str(s)] = sa.literal
    keys = sorted(syms)
    seen, sols, cands = set(), 0, 0
    with a.solve(yield_=True) as h:
        for m in h:
            vec = tuple(m.is_true(syms[k]) for k in keys)
            if vec in seen:
                continue
            seen.add(vec)
            cands += 1
            if cands > limit:
                raise cc.CheckError(f"more than {limit} candidates")
            val = dict(zip(keys, vec))
            good = True
            for c, ch in built:
                assume = [d if val[str(s)] else -d for s, d in zip(ch.sym, ch.dst)]
                sat = False
                with ch.c.solve(assumptions=assume, yield_=True) as hc:
                    for _ in hc:
                        sat = True
                        break
                if sat != c["witness"]:
                    good = False
                    break
            if good:
                sols += 1
    return {"solutions": sols, "candidates": cands, "checks": [{"solver": c["C"]["name"], "link": c["link"]["name"],
                                                                 "witness": c["witness"]} for c in checks]}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("project")
    ap.add_argument("--instance", default=None)
    ap.add_argument("--variant", default=None)
    ap.add_argument("-c", dest="consts", action="append", default=[])
    ap.add_argument("--limit", type=int, default=200000)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        with open(a.project, encoding="utf-8") as f:
            project = json.load(f)
        settings = project.get("settings") or {}
        project = cc.apply_variant(project, a.variant if a.variant is not None else (settings.get("variant") or "default"))
        consts = {k: str(v) for k, v in (settings.get("constants") or {}).items()}
        inst = cc.select_instance(project, a.instance)
        if inst is not None:
            facts = inst.get("facts")
            if facts is None and inst.get("recipe"):
                facts = cc.recipe_facts(project, inst["recipe"])
            project = dict(project, fragments=[{"name": "instance", "text": facts or ""}] +
                           [f for f in project["fragments"] if f["name"] != "instance"])
            consts.update({k: str(v) for k, v in (inst.get("constants") or {}).items()})
        for kv in a.consts:
            k, _, v = kv.partition("=")
            consts[k] = v
        r = count(project, consts, a.limit)
    except cc.CheckError as e:
        print(json.dumps({"error": str(e)}) if a.json else f"error: {e}")
        return 1
    if a.json:
        print(json.dumps(r))
    else:
        print(f"Checks: {', '.join(('witness ' if c['witness'] else '') + c['solver'] + ' via ' + c['link'] for c in r['checks'])}")
        print(f"Solutions: {r['solutions']}; candidates: {r['candidates']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
