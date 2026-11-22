import json, subprocess
def proj(loop, two_links=True):
    return {"format":"cegarplay","version":1,"title":"block probe","description":"",
     "fragments":[{"name":"shared","text":"i(1..2).\n"},
                  {"name":"abstraction","text":"{ p(I) : i(I) }.\n{ q(I) : i(I) }.\n#show p/1.\n#show q/1.\n"},
                  {"name":"gluep","text":"glue(p(I)) :- i(I).\n"},
                  {"name":"glueq","text":"glue(q(I)) :- i(I).\n"},
                  {"name":"gluepq","text":"glue(p(I)) :- i(I).\nglue(q(I)) :- i(I).\n"},
                  {"name":"never","text":"% never finds a counterexample\n:- not impossible.\n"}],
     "loop":{"language":"loop","text":loop},
     "settings":{"constants":{},"solutions":0,"seconds":30,"candidates":0,"trace":0,"seed":0}}
TWO = """solver A = shared + abstraction
solver C1 = shared + never
solver C2 = shared + never
link G1 = A -> C1 via shared + gluep
link G2 = A -> C2 via shared + glueq
"""
ONE = """solver A = shared + abstraction
solver C1 = shared + never
link G1 = A -> C1 via shared + gluepq
"""
BODY = """
n = []
repeat:
    search A:
        on candidate M:
            n.push(1)
            if n.size >= 3:
                n.clear()
                restart
until A.exhausted
"""
PLAIN = """
search A:
    on candidate M:
        n = 1
"""
for name, loop in [("two links, restarting searches", TWO+BODY), ("one link over the same atoms, restarting searches", ONE+BODY), ("two links, one search", TWO+PLAIN)]:
    json.dump(proj(loop), open("pb.json","w"))
    r = subprocess.run(["node","../../cegarplay/tools/run.mjs","pb.json","--solutions","all","--quiet"],capture_output=True,text=True)
    print(name, "->", " | ".join((r.stdout+r.stderr).strip().splitlines()[-2:]))
