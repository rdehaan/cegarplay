import json, subprocess
from qbf3 import *
def tryloop(name, loop, nx=2, ny=2, nz=2, clauses=None, frag_edit=None):
    clauses = clauses or [[('x',1,1),('y',1,1),('z',1,1)],[('x',2,0),('y',2,0),('z',2,1)],[('x',1,0),('y',1,0),('z',1,0)]]
    p = project(nx, ny, nz, clauses, loop)
    if frag_edit: frag_edit(p)
    json.dump(p, open("probe.json","w"))
    r = subprocess.run(["node","../../cegarplay/tools/run.mjs","probe.json","--solutions","all"],capture_output=True,text=True)
    out = (r.stdout + r.stderr).strip().splitlines()
    print(f"--- {name}: exit {r.returncode}")
    for l in out[-4:]: print("   ", l[:230])

# G1: nested search
tryloop("nested search", DECL + """
search A:
    on candidate M:
        search B:
            on candidate Y:
                W = C.solve(assume GXY(Y))
""")
# G2: search with assumptions
tryloop("search with assumptions", DECL + """
search A:
    on candidate M:
        Y = B.solve(assume GX(M))
search B assume GX(M):
    on candidate Y:
        W = C.solve(assume GXY(Y))
""")
# G3: a clause of one link added to another solver
tryloop("clause to a solver that is not the link's source", DECL + """
M = A.solve()
Y = B.solve(assume GX(M))
W = C.solve(assume GXY(Y))
if not W:
    B.add(GXC.core(C))
else:
    B.add(GXC.block(M))
""")
# G4: clause algebra / joining two clauses
tryloop("joining two clauses", DECL + """
M = A.solve()
Y = B.solve(assume GX(M))
c = GX.block(M) + GXC.block(M)
A.add(c)
""")
# G5: a user-defined procedure
tryloop("procedure definition", DECL + """
def check(M):
    Y = B.solve(assume GX(M))
""")
# G6: solver declared after statements (dynamic solver)
tryloop("solver declared inside the loop", DECL + """
M = A.solve()
solver B2 = shared + middle
""")
# G7: reading an atom argument / number out of a model
tryloop("number out of a model", DECL + """
M = A.solve()
n = M.atoms(x/1).size
log n
v = M.atoms(x/1).first
""")
# G8: assumption on a named atom
tryloop("assume a named atom", DECL + """
M = A.solve(assume x(1))
""")
