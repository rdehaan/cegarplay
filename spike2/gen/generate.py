"""Generate one instance: run a generator with the vendored engine, retry rejected draws."""
import json, subprocess, sys, re
LIB = open("../gen/draws.lua").read()
def generate(text, params, seed, max_attempts=200):
    for attempt in range(max_attempts):
        prog = f"#script (lua)\nSEED = {seed}\nATTEMPT = {attempt}\n{LIB}\n#end.\n{text}\n"
        open("/tmp/gen.lp", "w").write(prog)
        opts = ["--outf=2", "1"] + [x for k, v in params.items() for x in ("-c", f"{k}={v}")]
        r = subprocess.run(["node", "../gen/engine.mjs", "/tmp/gen.lp", *opts], capture_output=True, text=True)
        try: res = json.loads(r.stdout)
        except Exception: raise RuntimeError("generator failed: " + (r.stdout + r.stderr)[-400:])
        if res["Result"].startswith("SAT"):
            atoms = sorted(res["Call"][0]["Witnesses"][0]["Value"])
            return {"facts": " ".join(a + "." for a in atoms), "attempt": attempt, "recipe": {"params": params, "seed": seed}}
    raise RuntimeError("no accepted draw in %d attempts" % max_attempts)
