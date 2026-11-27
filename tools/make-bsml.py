#!/usr/bin/env python3
"""Writes the two BSML examples from one source, so that their shared fragments agree:

  examples/contrib/bsml-entailment.json   countermodels to an entailment (a CEGAR loop)
  examples/contrib/bsml-proofs.json       natural deduction proofs, after that loop

    python3 tools/make-bsml.py [--check]

--check only compares the files with what this script would write (exit 1 if they differ).
Then run node tools/make-examples.mjs. tools/bsml-check.py checks the encodings by brute force.
BSML: Aloni, Anttila and Yang, State-based modal logics for free choice (2024).
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def inst(id, comment, facts, expected, tags=None):
    """expected: a solution count, or a cost list: the optimum of the one solution of a loop
    that stops at its first (smallest) answer, which is not an exhausted run."""
    exp = {"solutions": None, "optimum": expected} if isinstance(expected, list) else {"solutions": expected}
    return {"id": id, "facts": comment + facts, "constants": {}, "expected": exp, "tags": tags or []}


FC = "prop(p;q).\n"

# ---------------------------------------------------------------------------
# The ASP fragments of the countermodel loop (both examples)
# ---------------------------------------------------------------------------
SHARED = r"""% BSML formulas are terms over the atoms prop/1 (see the Instances tab):
%   bot (weak contradiction), ne (nonemptiness), neg(F), and(F,G), or(F,G) (tensor
%   disjunction), gor(F,G) (global disjunction), dia(F), box(F), empty(F) (emptiness
%   operator), and plus(F): the pragmatic enrichment [F]+ of a classical formula F.
% A model has the worlds 1..n, a valuation val/2 and a relation rel/2; a state is a set of
% worlds. Support (pos) and anti-support (neg) follow Aloni, Anttila and Yang (2024), Def. 2.3.
#const n = 3.
world(1..n).

% The enrichment: [p]+ = p & NE, [neg a]+ = neg [a]+ & NE, [a & b]+ = ([a]+ & [b]+) & NE,
% the same for or, [dia a]+ = dia [a]+ & NE, [box a]+ = box [a]+ & NE.
given(F) :- premise(F).
given(F) :- conclusion(F).
enrich(F) :- given(plus(F)).
enrich(A) :- enrich(neg(A)).
enrich(A) :- enrich(dia(A)).
enrich(A) :- enrich(box(A)).
enrich(A;B) :- enrich(and(A,B)).
enrich(A;B) :- enrich(or(A,B)).
plus(P, and(P,ne)) :- enrich(P), prop(P).
plus(bot, bot) :- enrich(bot).
plus(neg(A), and(neg(E),ne)) :- enrich(neg(A)), plus(A,E).
plus(dia(A), and(dia(E),ne)) :- enrich(dia(A)), plus(A,E).
plus(box(A), and(box(E),ne)) :- enrich(box(A)), plus(A,E).
plus(and(A,B), and(and(E,D),ne)) :- enrich(and(A,B)), plus(A,E), plus(B,D).
plus(or(A,B), and(or(E,D),ne)) :- enrich(or(A,B)), plus(A,E), plus(B,D).
formula(F, F) :- given(F), not enriched(F).
formula(plus(F), E) :- given(plus(F)), plus(F,E).
enriched(plus(F)) :- given(plus(F)).

% The evaluation tree of a formula: node(N, F, P) asks for a state of node N that supports
% (P = pos) or anti-supports (P = neg) F. A modal node gets one child d(N,W) per world W:
% the successor state that W needs. root/1 says which formulas are evaluated.
node(r(F), E, pos) :- root(F), formula(F, E).
flip(pos,neg). flip(neg,pos).
node(c1(N), A, Q) :- node(N, neg(A), P), flip(P,Q).
node(c1(N), A, P) :- node(N, empty(A), P).
node(c1(N), A, P) :- node(N, and(A,B), P).
node(c2(N), B, P) :- node(N, and(A,B), P).
node(c1(N), A, P) :- node(N, or(A,B), P).
node(c2(N), B, P) :- node(N, or(A,B), P).
node(c1(N), A, P) :- node(N, gor(A,B), P).
node(c2(N), B, P) :- node(N, gor(A,B), P).
node(d(N,W), A, P) :- node(N, dia(A), P), world(W).
node(d(N,W), A, P) :- node(N, box(A), P), world(W).

% The kind of each child: the same state as its parent (same), part of a split of the
% parent's state (part), one of two alternatives (alt), a nonempty substate of R[W]
% (some), or all of R[W] (all).
kid(N, c1(N), same) :- node(N, neg(_), _).
kid(N, c1(N), alt)  :- node(N, empty(_), pos).
kid(N, c1(N), same) :- node(N, empty(_), neg).
kid(N, c1(N), same; N, c2(N), same) :- node(N, and(_,_), pos).
kid(N, c1(N), part; N, c2(N), part) :- node(N, and(_,_), neg).
kid(N, c1(N), part; N, c2(N), part) :- node(N, or(_,_), pos).
kid(N, c1(N), same; N, c2(N), same) :- node(N, or(_,_), neg).
kid(N, c1(N), alt;  N, c2(N), alt)  :- node(N, gor(_,_), pos).
kid(N, c1(N), same; N, c2(N), same) :- node(N, gor(_,_), neg).
kid(N, d(N,W), some) :- node(N, dia(_), pos), world(W).
kid(N, d(N,W), all)  :- node(N, dia(_), neg), world(W).
kid(N, d(N,W), all)  :- node(N, box(_), pos), world(W).
kid(N, d(N,W), some) :- node(N, box(_), neg), world(W).
"""

SEMANTICS = r"""
% Which nodes are evaluated (act/1) and their states (st/2): the roots get the state s.
act(r(F)) :- root(F).
st(r(F), W) :- root(F), in(W).
act(K) :- act(N), kid(N, K, same).
act(K) :- act(N), kid(N, K, part).
act(K) :- act(N), kid(N, K, some), st(N, W), K = d(N,W).
act(K) :- act(N), kid(N, K, all), st(N, W), K = d(N,W).
% gor: one disjunct supports the state; empty(F): F does, or the state is empty.
1 { act(K) : kid(N, K, alt) } 1 :- act(N), node(N, gor(_,_), pos).
nonempty(N) :- st(N, _).
act(c1(N)) :- act(N), node(N, empty(_), pos), nonempty(N).
st(K, W) :- act(K), kid(N, K, same), st(N, W).
st(K, W) :- act(K), kid(N, K, alt), st(N, W).
% A split: s = t u u with t and u inside s.
{ st(K, W) } :- act(K), kid(N, K, part), st(N, W).
:- act(N), kid(N, _, part), st(N, W), not st(K, W) : kid(N, K, part).
% A successor state of W: all of R[W], or a nonempty part of it.
st(d(N,W), V) :- act(d(N,W)), kid(N, d(N,W), all), rel(W, V).
{ st(d(N,W), V) } :- act(d(N,W)), kid(N, d(N,W), some), rel(W, V).
:- act(d(N,W)), kid(N, d(N,W), some), not nonempty(d(N,W)).

% The atoms.
:- act(N), node(N, P, pos), prop(P), st(N, W), not val(W, P).
:- act(N), node(N, P, neg), prop(P), st(N, W), val(W, P).
:- act(N), node(N, bot, pos), nonempty(N).
:- act(N), node(N, ne, pos), not nonempty(N).
:- act(N), node(N, ne, neg), nonempty(N).
"""

ABSTRACTION = r"""% A candidate: a model and a state s that supports every premise.
{ val(W, P) } :- world(W), prop(P).
{ rel(W, V) } :- world(W), world(V).
{ in(W) } :- world(W).
root(F) :- premise(F).

% The extra conditions on a model that an instance may ask for.
% indisputable: every world of s sees the same worlds.
:- condition(indisputable), in(W), in(U), rel(W, V), not rel(U, V).
% state-based: every world of s sees exactly s.
:- condition(state_based), in(W), rel(W, V), not in(V).
:- condition(state_based), in(W), in(V), not rel(W, V).

% No junk: a world that s cannot reach plays no role, so it is empty and comes last.
reach(W) :- in(W).
reach(V) :- reach(W), rel(W, V).
:- world(W), not reach(W), val(W, _).
:- world(W), not reach(W), rel(W, _).
:- world(W), W > 1, reach(W), not reach(W-1).
""" + SEMANTICS + r"""
#show val/2.
#show rel/2.
#show in/1.
"""

GLUE = r"""glue(val(W, P)) :- world(W), prop(P).
glue(rel(W, V)) :- world(W), world(V).
glue(in(W)) :- world(W).
"""

CHECK_HEAD = r"""% A counterexample: the candidate's state s supports the conclusion after all. Then the
% candidate is no countermodel. Only the conclusion is evaluated here.
root(F) :- conclusion(F).
""" + SEMANTICS + r"""
#show st(W) : st(r(F), W), root(F).
"""

RELEVANT = r"""
% The support found depends on the state s (every world in or out), on the arrows from a
% world W to the worlds of a successor state chosen for W, on all arrows of W when the
% successor state must be all of R[W], and on the valuation of an atom at the worlds where
% it is evaluated. A candidate that agrees on these atoms supports the conclusion too.
relevant(in(W)) :- world(W).
relevant(rel(W, V)) :- act(d(N,W)), kid(N, d(N,W), some), st(d(N,W), V).
relevant(rel(W, V)) :- act(d(N,W)), kid(N, d(N,W), all), world(V).
relevant(val(W, P)) :- act(N), node(N, P, _), prop(P), st(N, W).
"""

CHECK = CHECK_HEAD + RELEVANT

SMALLEST = r"""% Small candidates first: as few worlds as possible (those that s reaches), then as
% few arrows and true atoms. With 'A.solve(optimal)' the first countermodel is a smallest one.
#minimize { 1@2,W : reach(W) }.
#minimize { 1@1,W,V : rel(W, V) ; 1@1,W,P : val(W, P) }.
"""

# ---------------------------------------------------------------------------
# The views (Observatory, Domain view)
# ---------------------------------------------------------------------------
PRETTY = r"""#script (lua)
-- Formulas as text: neg ¬, dia ◇, box □, empty ⊘, and ∧, or ∨, gor ⩔, ne NE, bot ⊥, plus [F]+.
local U = { neg = "¬", dia = "◇", box = "□", empty = "⊘" }
local B = { ["and"] = "∧", ["or"] = "∨", gor = "⩔" }
local function fmt(f, top)
  if f.type == clingo.SymbolType.Number then return tostring(f.number) end
  if f.type == clingo.SymbolType.String then return f.string end
  local n, a = f.name, f.arguments
  if #a == 0 then
    if n == "ne" then return "NE" elseif n == "bot" then return "⊥" end
    return n
  end
  if #a == 1 and U[n] then return U[n] .. fmt(a[1], false) end
  if #a == 1 and n == "plus" then return "[" .. fmt(a[1], true) .. "]⁺" end
  if #a == 2 and B[n] then
    local t = fmt(a[1], false) .. B[n] .. fmt(a[2], false)
    if top then return t end
    return "(" .. t .. ")"
  end
  local parts = {}
  for i = 1, #a do parts[i] = fmt(a[i], true) end
  return n .. "(" .. table.concat(parts, ",") .. ")"
end
-- a Lua error must not reach clingo: every call is protected
function bsml_text(f)
  local ok, t = pcall(fmt, f, true)
  if ok then return clingo.String(t) end
  return clingo.String("?")
end
-- "P ⊭ C" in one note (notes come out in no fixed order); P = 0: no premise
function bsml_judgement(p, sym, c)
  local ok, t = pcall(function()
    local head = ""
    if p.type ~= clingo.SymbolType.Number then head = fmt(p, true) .. " " end
    return head .. sym.string .. " " .. fmt(c, true)
  end)
  if ok then return clingo.String(t) end
  return clingo.String("?")
end
function bsml_arrow(v)
  local ok, t = pcall(function() return "→" .. tostring(v.number) end)
  if ok then return clingo.String(t) end
  return clingo.String("?")
end
function bsml_refs(...)
  local ok, t = pcall(function(...)
    local parts = {}
    for i, x in ipairs({...}) do parts[i] = tostring(x.number) end
    return table.concat(parts, ",")
  end, ...)
  if ok then return clingo.String(t) end
  return clingo.String("?")
end
#end.
"""

VIEW_MODEL = r"""% The model as a table: one row per world, its true atoms, whether it is in the state s, and
% its arrows (the column of world V: an arrow to V). At a refinement the ringed cells are the
% atoms of its clause: what the support of the conclusion used, one of which must change.
% Worlds that s does not reach are faded.
#program scene.
draw(layout(grid)).
pcol(P, 1+I) :- prop(P), I = #count { Q : prop(Q), Q <= P }.
nprops(K) :- K = #count { P : prop(P) }.
scol(K+2) :- nprops(K).
rcol(V, K+3+V) :- nprops(K), world(V).
draw(cell(1,1)). draw(attr(cell(1,1), label, "world")). draw(attr(cell(1,1), weight, 0)).
draw(cell(1,C)) :- pcol(P,C).
draw(attr(cell(1,C), label, P)) :- pcol(P,C).
draw(attr(cell(1,C), weight, 0)) :- pcol(P,C).
draw(cell(1,C)) :- scol(C).
draw(attr(cell(1,C), label, "in s")) :- scol(C).
draw(attr(cell(1,C), weight, 0)) :- scol(C).
draw(cell(1,C)) :- rcol(V,C).
draw(attr(cell(1,C), label, @bsml_arrow(V))) :- rcol(V,C).
draw(attr(cell(1,C), weight, 0)) :- rcol(V,C).
draw(cell(1+W,1)) :- world(W).
draw(attr(cell(1+W,1), weight, 0)) :- world(W).
draw(cell(1+W,C)) :- world(W), pcol(_,C).
draw(cell(1+W,C)) :- world(W), scol(C).
draw(cell(1+W,C)) :- world(W), rcol(_,C).

#program frame.
draw(attr(cell(1+W,1), label, @bsml_refs(W))) :- world(W).
draw(attr(cell(1+W,C), fill, true)) :- cand(val(W,P)), pcol(P,C).
draw(attr(cell(1+W,C), label, P)) :- cand(val(W,P)), pcol(P,C).
draw(attr(cell(1+W,C), fill, state)) :- cand(in(W)), scol(C).
draw(attr(cell(1+W,C), label, "s")) :- cand(in(W)), scol(C).
draw(attr(cell(1+W,C), fill, arrow)) :- cand(rel(W,V)), rcol(V,C).
draw(attr(cell(1+W,C), label, "→")) :- cand(rel(W,V)), rcol(V,C).
draw(emph(cell(1+W,C))) :- lit(val(W,P),_), pcol(P,C).
draw(emph(cell(1+W,C))) :- lit(in(W),_), scol(C).
draw(emph(cell(1+W,C))) :- lit(rel(W,V),_), rcol(V,C).
reach(W) :- cand(in(W)).
reach(V) :- reach(W), cand(rel(W,V)).
% a frame of the model (a candidate of A, or a countermodel), not a proof of bsml-proofs
proof_frame :- cand(line(_,_,_)).
model :- not proof_frame.
draw(ghost(cell(1+W,C))) :- world(W), not reach(W), draw(cell(1+W,C)), reach(_), model.
% the entailment in one note: one premise, none, or several (then one note per premise)
npremises(K) :- K = #count { F : premise(F) }.
draw(note(@bsml_judgement(F, "⊭", G))) :- npremises(1), premise(F), conclusion(G), model.
draw(note(@bsml_judgement(0, "⊭", G))) :- npremises(0), conclusion(G), model.
draw(note(@bsml_judgement(0, "⊭", G))) :- npremises(K), K > 1, conclusion(G), model.
draw(note(@bsml_judgement(0, "premise:", F))) :- npremises(K), K > 1, premise(F), model.
draw(note("The state s supports the conclusion too; the ringed cells are what that support used.")) :- kind(reject), model.
draw(note("The state s supports the conclusion too; the ringed cells are what that support used.")) :- kind(add), model.
draw(note("A countermodel: s supports the premises but not the conclusion.")) :- kind(solution), model.
#show draw/1.
"""

VIEW_PROOF = r"""
% The proof, under the model table: one row per line with its formula, its rule and the lines it
% uses. Premises are the assumptions the last line depends on; other assumptions are discharged.
#program scene.
prow(I, n+2+I) :- I = 1..10.
draw(cell(R,1)) :- prow(_,R).
draw(attr(cell(R,1), weight, 0)) :- prow(_,R).
draw(cell(R,8)) :- prow(_,R).
draw(attr(cell(R,8), weight, 0)) :- prow(_,R).
draw(cell(R,14)) :- prow(_,R).
draw(attr(cell(R,14), weight, 0)) :- prow(_,R).
draw(cell(R,16)) :- prow(_,R).
draw(attr(cell(R,16), weight, 0)) :- prow(_,R).
rname(and_i,"∧I"). rname(and_e1,"∧E"). rname(and_e2,"∧E"). rname(neg_i,"¬I"). rname(neg_e,"¬E").
rname(dneg_e,"¬¬E"). rname(dneg_i,"¬¬I"). rname(dm_and,"DM∧"). rname(dm_and_r,"DM∧"). rname(dm_or,"DM∨").
rname(dm_or_r,"DM∨"). rname(negne_e,"¬NE E"). rname(negne_i,"¬NE E"). rname(or_i,"∨I"). rname(or_w,"∨W").
rname(or_com,"Com∨"). rname(or_ass,"Ass∨"). rname(or_e,"∨E"). rname(or_mon,"∨Mon"). rname(bot_e,"⊥E").
rname(ctr,"⫫Ctr"). rname(dia_mon,"◇Mon"). rname(box_mon,"□Mon"). rname(box_nec,"□Mon"). rname(inter,"Inter◇□").
rname(inter_r,"Inter◇□"). rname(def_box,"Def□"). rname(def_box_r,"Def□"). rname(dia_sep,"◇Sep").
rname(box_inst,"□Inst"). rname(dia_join,"◇Join"). rname(box_dia_join,"□◇Join"). rname(gor_i1,"⩔I").
rname(gor_i2,"⩔I"). rname(gor_e,"⩔E"). rname(distr,"Distr∨⩔"). rname(dm_gor,"DM⩔"). rname(dm_gor_r,"DM⩔").
rname(nei,"NEI"). rname(conv_dia,"Conv◇"). rname(conv_box,"Conv□").

#program frame.
pline(I) :- cand(line(I,_,_)).
last(I) :- pline(I), not pline(I+1).
premline(H) :- cand(dep(_,H)).
draw(attr(cell(R,1), label, @bsml_refs(I))) :- pline(I), prow(I,R).
draw(attr(cell(R,8), label, @bsml_text(F))) :- cand(line(I,_,F)), prow(I,R).
draw(attr(cell(R,14), label, N)) :- cand(line(I,Ru,_)), rname(Ru,N), prow(I,R).
draw(attr(cell(R,14), label, "premise")) :- cand(line(I,hyp,_)), premline(I), prow(I,R).
draw(attr(cell(R,14), label, "assume")) :- cand(line(I,hyp,_)), not premline(I), prow(I,R).
nrefs(I,N) :- pline(I), N = #count { K : cand(ref(I,K,_)) }.
draw(attr(cell(R,16), label, @bsml_refs(J))) :- nrefs(I,1), cand(ref(I,1,J)), prow(I,R).
draw(attr(cell(R,16), label, @bsml_refs(J,K))) :- nrefs(I,2), cand(ref(I,1,J)), cand(ref(I,2,K)), prow(I,R).
draw(attr(cell(R,16), label, @bsml_refs(J,K,L))) :- nrefs(I,3), cand(ref(I,1,J)), cand(ref(I,2,K)), cand(ref(I,3,L)), prow(I,R).
draw(emph(cell(R,8))) :- last(I), prow(I,R).
draw(note(@bsml_judgement(F, "⊢", G))) :- npremises(1), premise(F), conclusion(G), pline(_).
draw(note(@bsml_judgement(0, "⊢", G))) :- npremises(0), conclusion(G), pline(_).
draw(note(@bsml_judgement(0, "⊢", G))) :- npremises(K), K > 1, conclusion(G), pline(_).
draw(note(@bsml_judgement(0, "premise:", F))) :- npremises(K), K > 1, premise(F), pline(_).
% a proof has no model: the table above fades
draw(ghost(cell(R,C))) :- draw(cell(R,C)), R <= n+1, pline(_).
draw(note("A shortest proof: each line gives its rule and the lines it uses (∨E, ¬I, ◇Mon, □Mon and ∨Mon discharge assumptions of the lines they use).")) :- pline(_).
"""

# ---------------------------------------------------------------------------
# bsml-entailment
# ---------------------------------------------------------------------------
ENT_LOOP = """solver A = shared + abstraction + smallest
solver C = shared + check          options "--heuristic=Domain"
link   G = A -> C via shared + glue

# A candidate (M, s) supports the premises; A proposes the smallest one left. If s also
# supports the conclusion, the check shows how, and the clause rules out every candidate
# that agrees on what that support used. The first candidate that survives is a smallest
# countermodel: the premises do not entail the conclusion, and the loop stops.
# No solution: the entailment holds on models with at most n worlds.
loop:
    M = A.solve(optimal)
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        stop
"""

ENT_LOOP_BLOCK = ENT_LOOP.replace("A.add(G.clause(M, X))", "A.add(G.block(M))").replace(
    "# that agrees on what that support used.", "# with the same interface values (the blocking loop: always sound, but slow:\n# this variant sets n = 2).").replace(
    "the clause rules out every candidate\n", "the block rules out every candidate\n")
assert ENT_LOOP_BLOCK.count("G.block") == 1 and "blocking loop" in ENT_LOOP_BLOCK

ENT_LOOP_LIFT = ENT_LOOP.replace("link   G = A -> C via shared + glue\n", "link   G = A -> C via shared + glue lift\n").replace(
    "# A candidate (M, s) supports the premises;",
    "# With 'lift', G.clause computes the clause from the ground programs of A and C instead of\n# taking relevant/1 as it is: it drops atoms while the smaller clause stays certified.\n# Compare the candidates (dual-prohibition) and the time with the default loop.\n# A candidate (M, s) supports the premises;")
assert "lift" in ENT_LOOP_LIFT and ENT_LOOP_LIFT.count("Compare") == 1

ENT_INSTANCES = [
    inst("example", "% Narrow-scope free choice: [dia(p or q)]+ entails dia p and dia q.\n% No countermodel: the entailment holds (on models with at most n worlds).\n",
         FC + "premise(plus(dia(or(p,q)))).\nconclusion(and(dia(p),dia(q))).\n", 0, ["library"]),
    inst("wide-scope", "% Wide-scope free choice: [dia p or dia q]+ does not entail dia p and dia q.\n",
         FC + "premise(plus(or(dia(p),dia(q)))).\nconclusion(and(dia(p),dia(q))).\n", [2, 4]),
    inst("wide-scope-indisputable", "% Wide-scope free choice holds when R is indisputable in s.\n",
         FC + "premise(plus(or(dia(p),dia(q)))).\nconclusion(and(dia(p),dia(q))).\ncondition(indisputable).\n", 0),
    inst("dual-prohibition", "% Dual prohibition: [neg dia(p or q)]+ entails neg dia p and neg dia q.\n",
         FC + "premise(plus(neg(dia(or(p,q))))).\nconclusion(and(neg(dia(p)),neg(dia(q)))).\n", 0),
    inst("double-negation", "% Double negation: [neg neg dia(p or q)]+ entails dia p and dia q.\n",
         FC + "premise(plus(neg(neg(dia(or(p,q)))))).\nconclusion(and(dia(p),dia(q))).\n", 0),
    inst("modal-disjunction", "% Modal disjunction: [p or q]+ does not entail dia p and dia q ...\n",
         FC + "premise(plus(or(p,q))).\nconclusion(and(dia(p),dia(q))).\n", [1, 2]),
    inst("modal-disjunction-state-based", "% ... but it does when R is state-based in s.\n",
         FC + "premise(plus(or(p,q))).\nconclusion(and(dia(p),dia(q))).\ncondition(state_based).\n", 0),
    inst("detachability", "% Detachability fails: [dia neg(p and q)]+ does not entail dia neg p and dia neg q.\n",
         FC + "premise(plus(dia(neg(and(p,q))))).\nconclusion(and(dia(neg(p)),dia(neg(q)))).\n", [1, 2]),
    inst("excluded-middle", "% Validity (no premise): p or neg p is supported by every state.\n",
         "prop(p).\nconclusion(or(p,neg(p))).\n", 0),
    inst("ne-not-valid", "% Not valid: NE or neg NE. The empty state does not support it (but every nonempty state does).\n",
         "prop(p).\nconclusion(or(ne,neg(ne))).\n", [0, 0]),
    inst("global-disjunction", "% The global disjunction does not distribute over dia: dia(p gor q) entails dia p or dia q\n% (Conv), but not dia p gor dia q.\n",
         FC + "premise(dia(gor(p,q))).\nconclusion(gor(dia(p),dia(q))).\n", [2, 4]),
    inst("emptiness", "% The emptiness operator cancels NE: empty(p and NE) entails p (and the converse holds).\n",
         "prop(p).\npremise(empty(and(p,ne))).\nconclusion(p).\n", 0),
]

def entailment():
    return {
        "format": "cegarplay", "version": 2,
        "title": "BSML entailment",
        "description": "Countermodels to an entailment in bilateral state-based modal logic (BSML, Aloni, Anttila and Yang 2024): a Kripke model with at most n worlds and a state s that supports the premises but not the conclusion. Support of a disjunction or a diamond asks for substates, so 'does s not support the conclusion' is a universal question: the abstraction guesses a model and a state with the substates that support the premises, the check looks for substates that support the conclusion, and the refinement keeps only what that support used. No solution: the entailment holds on models with at most n worlds. After the BSML reasoner of bsml-sat.",
        "fragments": [
            {"name": "shared", "description": "Worlds, the enrichment [F]+ and the evaluation tree of a formula. Added to every solver.", "text": SHARED},
            {"name": "abstraction", "description": "Proposes candidates (solver A): a model and a state that supports the premises.", "text": ABSTRACTION},
            {"name": "glue", "description": "The interface atoms: valuation, relation and the state s.", "text": GLUE},
            {"name": "smallest", "description": "Makes A propose small candidates first: few worlds, then few arrows and true atoms.", "text": SMALLEST},
            {"name": "check", "description": "Looks for support of the conclusion in the candidate's state (solver C); relevant/1 says what the support used.", "text": CHECK},
            {"name": "view", "description": "The domain view: the candidate model as a table, the clause of a refinement ringed.", "text": PRETTY + VIEW_MODEL},
        ],
        "views": [{"name": "view", "fragments": ["shared", "view"]}],
        "loop": {"language": "loop", "text": ENT_LOOP},
        "settings": {"constants": {}, "solutions": 0, "seconds": 60, "candidates": 0, "trace": 200, "seed": 0},
        "instances": ENT_INSTANCES,
        "variants": [
            {"name": "reference", "swap": {}, "constants": {"n": "2"}, "loop": {"language": "loop", "text": ENT_LOOP_BLOCK}},
            {"name": "lift", "swap": {}, "constants": {}, "loop": {"language": "loop", "text": ENT_LOOP_LIFT}},
        ],
        "suites": [{"name": "variants", "instances": {"ids": "all"}, "variants": ["default", "reference", "lift"], "limits": {"seconds": 60}}],
        "library": {
            "id": "bsml-entailment", "group": "logic",
            "summary": "Countermodels to entailments in the state-based modal logic BSML, such as free-choice inferences (narrow-scope free choice: no countermodel with 3 worlds).",
            "shape": "shape2", "tags": ["fast", "stops-at-optimum"], "expected": 0, "level": 3, "after": 6,
        },
    }

# ---------------------------------------------------------------------------
# bsml-proofs
# ---------------------------------------------------------------------------
FORMULAS = SHARED.replace("given(F) :- conclusion(F).\n", "given(F) :- conclusion(F).\ngiven(F) :- lemma(F).\n")
assert FORMULAS != SHARED

PROOF = r"""% A proof is a list of lines; line I holds a formula f(I,F) and is justified by a rule
% of the natural deduction system for BSML with global disjunction (Aloni, Anttila and
% Yang 2024, Definition 4.1) applied to earlier lines ref(I,K,J). Each line records the
% assumptions it depends on (dep/2), as in a sequent: an assumption depends on itself, a
% rule collects the assumptions of the lines it uses and discharges the ones it closes.
% The formulas come from a finite universe: the subformulas of the premises, the
% conclusion and the lemmas (lemma/1 in the instance) give the formulas a proof may need.
uf(E) :- formula(_, E).
uf(A) :- uf(neg(A)).
uf(A) :- uf(dia(A)).
uf(A) :- uf(box(A)).
uf(A) :- uf(empty(A)).
uf(A;B) :- uf(and(A,B)).
uf(A;B) :- uf(or(A,B)).
uf(A;B) :- uf(gor(A,B)).
prem(E) :- premise(F), formula(F, E).
goal_formula(E) :- conclusion(F), formula(F, E).

% Side conditions: formulas with NE, with the global disjunction, and classical formulas
% (the alphas of the paper: no NE, no global disjunction). This system has no rules for
% the emptiness operator, so a formula with empty(F) is not classical either.
sub(F, F) :- uf(F).
sub(F, A) :- sub(F, neg(A)).
sub(F, A) :- sub(F, dia(A)).
sub(F, A) :- sub(F, box(A)).
sub(F, A) :- sub(F, empty(A)).
sub(F, A; F, B) :- sub(F, and(A,B)).
sub(F, A; F, B) :- sub(F, or(A,B)).
sub(F, A; F, B) :- sub(F, gor(A,B)).
has_ne(F) :- sub(F, ne).
has_gor(F) :- sub(F, gor(_,_)).
classical(F) :- uf(F), not has_ne(F), not has_gor(F), not sub(F, empty(_)).

% The rules and the number of earlier lines each one uses.
rule_refs(hyp,0; nei,0).
rule_refs(and_e1,1; and_e2,1; dneg_e,1; dneg_i,1; dm_and,1; dm_and_r,1; dm_or,1; dm_or_r,1;
          negne_e,1; negne_i,1; or_i,1; or_w,1; or_com,1; or_ass,1; bot_e,1; ctr,1;
          inter,1; inter_r,1; def_box,1; def_box_r,1; dia_sep,1; box_inst,1; gor_i1,1; gor_i2,1;
          distr,1; dm_gor,1; dm_gor_r,1; conv_dia,1; conv_box,1; neg_i,1; box_nec,1).
rule_refs(and_i,2; neg_e,2; dia_join,2; box_dia_join,2; or_mon,2; dia_mon,2; box_mon,2).
rule_refs(or_e,3; gor_e,3).

#program line(i).
% Line i: one formula, one rule, and the earlier lines the rule uses.
1 { f(i, F) : uf(F) } 1.
1 { rule(i, R) : rule_refs(R, _) } 1.
1 { ref(i, K, J) : J = 1..i-1 } 1 :- rule(i, R), rule_refs(R, N), K = 1..N.
r(i, K, F) :- ref(i, K, J), f(J, F).
ok(i) :- rule(i, hyp).
dep(i, i) :- rule(i, hyp).

% (a) conjunction
ok(i) :- rule(i, and_i), r(i,1,A), r(i,2,B), f(i, and(A,B)).
ok(i) :- rule(i, and_e1), r(i,1,and(A,B)), f(i, A).
ok(i) :- rule(i, and_e2), r(i,1,and(A,B)), f(i, B).
% (b) negation; neg_i discharges the assumptions alpha of a line with bot
ok(i) :- rule(i, neg_i), r(i,1,bot), f(i, neg(A)), classical(A), not ne_open(i).
ok(i) :- rule(i, neg_e), r(i,1,A), r(i,2,neg(A)), classical(A), f(i, B), classical(B).
ok(i) :- rule(i, dneg_e), r(i,1,neg(neg(A))), f(i, A).
ok(i) :- rule(i, dneg_i), r(i,1,A), f(i, neg(neg(A))).
ok(i) :- rule(i, dm_and), r(i,1,neg(and(A,B))), f(i, or(neg(A),neg(B))).
ok(i) :- rule(i, dm_and_r), r(i,1,or(neg(A),neg(B))), f(i, neg(and(A,B))).
ok(i) :- rule(i, dm_or), r(i,1,neg(or(A,B))), f(i, and(neg(A),neg(B))).
ok(i) :- rule(i, dm_or_r), r(i,1,and(neg(A),neg(B))), f(i, neg(or(A,B))).
ok(i) :- rule(i, negne_e), r(i,1,neg(ne)), f(i, bot).
ok(i) :- rule(i, negne_i), r(i,1,bot), f(i, neg(ne)).
% (c) tensor disjunction; or_e and or_mon discharge the assumptions of their subproofs
ok(i) :- rule(i, or_i), r(i,1,A), f(i, or(A,B)), not has_ne(B).
ok(i) :- rule(i, or_w), r(i,1,A), f(i, or(A,A)).
ok(i) :- rule(i, or_com), r(i,1,or(A,B)), f(i, or(B,A)).
ok(i) :- rule(i, or_ass), r(i,1,or(A,or(B,C))), f(i, or(or(A,B),C)).
ok(i) :- rule(i, or_e), r(i,1,or(A,B)), r(i,2,C), r(i,3,C), f(i, C), not has_gor(C), not ne_open(i).
ok(i) :- rule(i, or_mon), r(i,1,or(A,B)), r(i,2,C), f(i, or(A,C)), not ne_open(i).
% (d) bot and NE
ok(i) :- rule(i, bot_e), r(i,1,or(bot,A)), f(i, A).
ok(i) :- rule(i, ctr), r(i,1,or(and(bot,ne),_)), f(i, _).
% (e) modal rules: the subproof of dia_mon and box_mon uses no assumption but phi
ok(i) :- rule(i, dia_mon), r(i,1,B), r(i,2,dia(A)), f(i, dia(B)), not open_other(i, A).
ok(i) :- rule(i, box_mon), r(i,1,B), r(i,2,box(A)), f(i, box(B)), not open_other(i, A).
ok(i) :- rule(i, box_nec), r(i,1,B), f(i, box(B)), not open(i, 1).
ok(i) :- rule(i, inter), r(i,1,neg(dia(A))), f(i, box(neg(A))).
ok(i) :- rule(i, inter_r), r(i,1,box(neg(A))), f(i, neg(dia(A))).
% box(A) abbreviates neg dia neg A in the paper; here box is a connective, so the
% definition is a rule in both directions.
ok(i) :- rule(i, def_box), r(i,1,box(A)), f(i, neg(dia(neg(A)))).
ok(i) :- rule(i, def_box_r), r(i,1,neg(dia(neg(A)))), f(i, box(A)).
% (f) modalities and connectives
ok(i) :- rule(i, dia_sep), r(i,1,dia(or(_,and(B,ne)))), f(i, dia(B)).
ok(i) :- rule(i, box_inst), r(i,1,box(and(A,ne))), f(i, dia(A)).
ok(i) :- rule(i, dia_join), r(i,1,dia(A)), r(i,2,dia(B)), f(i, dia(or(A,B))).
ok(i) :- rule(i, box_dia_join), r(i,1,box(A)), r(i,2,dia(B)), f(i, box(or(A,B))).
% (g), (h) global disjunction
ok(i) :- rule(i, gor_i1), r(i,1,A), f(i, gor(A,_)).
ok(i) :- rule(i, gor_i2), r(i,1,B), f(i, gor(_,B)).
ok(i) :- rule(i, gor_e), r(i,1,gor(A,B)), r(i,2,C), r(i,3,C), f(i, C).
ok(i) :- rule(i, distr), r(i,1,or(A,gor(B,C))), f(i, gor(or(A,B),or(A,C))).
ok(i) :- rule(i, dm_gor), r(i,1,neg(gor(A,B))), f(i, and(neg(A),neg(B))).
ok(i) :- rule(i, dm_gor_r), r(i,1,and(neg(A),neg(B))), f(i, neg(gor(A,B))).
ok(i) :- rule(i, nei), f(i, gor(bot,ne)).
ok(i) :- rule(i, conv_dia), r(i,1,dia(gor(A,B))), f(i, or(dia(A),dia(B))).
ok(i) :- rule(i, conv_box), r(i,1,box(gor(A,B))), f(i, or(box(A),box(B))).
:- not ok(i).

% Dependencies. disch(i, K, F): the rule discharges the assumptions F of the line it
% uses in place K.
disch(i, 1, A) :- rule(i, neg_i), f(i, neg(A)).
disch(i, 2, A; i, 3, B) :- rule(i, or_e), r(i,1,or(A,B)).
disch(i, 2, A; i, 3, B) :- rule(i, gor_e), r(i,1,gor(A,B)).
disch(i, 2, B) :- rule(i, or_mon), r(i,1,or(A,B)).
dep(i, H) :- ref(i, K, J), dep(J, H), f(H, F), not disch(i, K, F),
             not rule(i, dia_mon), not rule(i, box_mon), not rule(i, box_nec).
dep(i, H) :- rule(i, dia_mon; i, box_mon), ref(i, 2, J), dep(J, H).
% open(i, K): the line used in place K depends on an assumption that rule i does not
% discharge; open_other(i, A): an assumption other than A; ne_open(i): one with NE.
open(i, K) :- ref(i, K, J), dep(J, H), f(H, F), not disch(i, K, F).
open_other(i, A) :- rule(i, dia_mon), r(i,2,dia(A)), ref(i, 1, J), dep(J, H), f(H, F), F != A.
open_other(i, A) :- rule(i, box_mon), r(i,2,box(A)), ref(i, 1, J), dep(J, H), f(H, F), F != A.
ne_open(i) :- rule(i, neg_i; i, or_e; i, or_mon), ref(i, K, J), K > 1, dep(J, H), f(H, F), has_ne(F), not disch(i, K, F).
ne_open(i) :- rule(i, neg_i), ref(i, 1, J), dep(J, H), f(H, F), has_ne(F), not disch(i, 1, F).

% Fewer proofs to look at, none lost: the lines without references (assumptions and the
% axiom nei) come first, in the order of their formulas; every line but the last is used.
zero(i) :- rule(i, R), rule_refs(R, 0).
:- zero(i), i > 1, not zero(i-1).
:- zero(i), zero(i-1), f(i, F), f(i-1, G), F <= G.
used(J, i) :- ref(i, _, J).
% A line that repeats the formula of an earlier line with all of its assumptions (or
% more) is never needed.
:- J = 1..i-1, f(i, F), f(J, F), dep(i, H) : dep(J, H).

% goal(i): the proof ends at line i with the conclusion, depending on premises only.
#external goal(i).
:- goal(i), J = 1..i-1, not used(J, K) : K = J+1..i.
:- goal(i), not f(i, F) : goal_formula(F).
:- goal(i), dep(i, H), f(H, F), not prem(F).

% The cost of a proof: its number of lines.
#minimize { 1,i : rule(i, _) }.

line(i, R, F) :- rule(i, R), f(i, F).
#show line/3.
#show ref/3.
#show dep(i, H) : goal(i), dep(i, H).
"""

DECLS = """solver A = shared + abstraction + smallest
solver C = shared + check          options "--heuristic=Domain"
link   G = A -> C via shared + glue
solver P = shared + proof
"""

COUNTER_PART = """refuted = false
loop:
    M = A.solve(optimal)
    if not M: break
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        log "a countermodel: there is no proof"
        refuted = true
        break
"""

PROOF_PART = """t = 0
proved = false
while not proved and t < 10:
    t = t + 1
    P.ground(line, t)
    if t > 1: P.set(P.atom("goal", t - 1), false)
    # Without the goal: is there any derivation with t lines? If not, there is none longer
    # either (a small universe runs out of new lines), and clingo has dropped goal(t).
    if not P.solve(): break
    P.set(P.atom("goal", t), true)
    Q = P.solve()
    if Q:
        accept Q
        log "a shortest proof:", t, "lines"
        proved = true
"""

PROOFS_LOOP = DECLS + """
# First the countermodel loop of bsml-entailment: a smallest model with at most n worlds
# and a state that supports the premises but not the conclusion. If there is one, no proof
# exists (the system is sound): the countermodel is the answer (its cost: worlds, then
# arrows and true atoms).
""" + COUNTER_PART + """if refuted: stop

# No countermodel: look for a proof. The system is complete, so one exists if the
# entailment holds; the search grows the proof by one line at a time (P.ground grounds
# line t; the external goal(t) asks for the conclusion at line t), so the first proof
# found is a shortest one (with the formulas of the universe). Its cost is its length.
""" + PROOF_PART + """if not proved: log "no proof with at most 10 lines (from these formulas)"
"""

PROOFS_LOOP_REF = PROOFS_LOOP.replace("        A.add(G.clause(M, X))", "        A.add(G.block(M))").replace(
    "# First the countermodel loop of bsml-entailment:", "# First the countermodel loop of bsml-entailment, as the blocking loop (always sound, but\n# slow: this variant sets n = 2):")
assert PROOFS_LOOP_REF.count("G.block") == 1

PROOFS_LOOP_FIRST = DECLS + """
# The proof search first, up to 10 lines, then the countermodel loop. The same answers;
# compare the times: without a proof the search tries every length up to the bound, which
# takes much longer than finding a countermodel (wide-scope).
""" + PROOF_PART + """if proved: stop
""" + COUNTER_PART + """if not refuted: log "no proof with at most 10 lines and no countermodel with at most n worlds"
"""

PROOFS_INSTANCES = [
    inst("example", "% Narrow-scope free choice (Section 1): dia((p and NE) or (q and NE)) proves dia p and dia q.\n% The lemma adds a formula that the proof passes through.\n",
         FC + "premise(dia(or(and(p,ne),and(q,ne)))).\nconclusion(and(dia(p),dia(q))).\nlemma(dia(or(and(q,ne),and(p,ne)))).\n", [7], ["library"]),
    inst("narrow-scope-enriched", "% Narrow-scope free choice with the enrichment: [dia(p or q)]+ proves dia p and dia q.\n",
         FC + "premise(plus(dia(or(p,q)))).\nconclusion(and(dia(p),dia(q))).\nlemma(dia(or(and(p,ne),and(q,ne)))).\nlemma(dia(or(and(q,ne),and(p,ne)))).\n", [10], ["slow"]),
    inst("wide-scope", "% Wide-scope free choice: no proof, since there is a countermodel.\n",
         FC + "premise(plus(or(dia(p),dia(q)))).\nconclusion(and(dia(p),dia(q))).\n", [2, 4]),
    inst("dia-sep", "% One rule: dia((p and NE) or (q and NE)) proves dia q.\n",
         FC + "premise(dia(or(and(p,ne),and(q,ne)))).\nconclusion(dia(q)).\n", [2]),
    inst("conv", "% dia(p gor q) proves dia p or dia q (Conv).\n",
         FC + "premise(dia(gor(p,q))).\nconclusion(or(dia(p),dia(q))).\n", [2]),
    inst("dual-prohibition", "% Dual prohibition: neg dia(p or q) proves neg dia p (DM and Inter).\n",
         FC + "premise(neg(dia(or(p,q)))).\nconclusion(neg(dia(p))).\nlemma(box(neg(or(p,q)))).\nlemma(and(neg(p),neg(q))).\nlemma(box(neg(p))).\n", [7]),
    inst("excluded-middle", "% p or neg p from no premises: neg(p and neg p) by neg-introduction, then De Morgan and\n% double negation inside the disjunction (or-monotonicity).\n",
         "prop(p).\nconclusion(or(p,neg(p))).\nlemma(neg(and(p,neg(p)))).\nlemma(or(neg(p),neg(neg(p)))).\nlemma(or(neg(p),p)).\nlemma(bot).\n", [10]),
    inst("ne-or", "% NE does not follow from p or q: the empty state is a countermodel.\n",
         FC + "premise(or(p,q)).\nconclusion(ne).\n", [0, 0]),
]

def proofs():
    return {
        "format": "cegarplay", "version": 2,
        "title": "BSML proofs",
        "description": "Proofs in the natural deduction system for BSML with global disjunction (Aloni, Anttila and Yang 2024, Definition 4.1), found by ASP, and countermodels when there are none. The loop first runs the countermodel loop of bsml-entailment (a CEGAR loop); if no countermodel with at most n worlds exists, it searches for a shortest proof, one line more per round. The one solution is the answer: a smallest countermodel or a shortest proof (its cost is its number of lines). The proof search needs no refinement: the rules and their side conditions (no NE in the open assumptions, no global disjunction in the conclusion of or-elimination) are checked line by line. The system is sound and complete, so exactly one of the two searches succeeds when the bounds are large enough.",
        "fragments": [
            {"name": "shared", "description": "Worlds, the formulas (with the enrichment [F]+ and the lemmas) and the evaluation tree of a formula. Added to every solver.", "text": FORMULAS},
            {"name": "abstraction", "description": "Proposes candidate countermodels (solver A): a model and a state that supports the premises.", "text": ABSTRACTION},
            {"name": "smallest", "description": "Makes A propose small candidates first.", "text": SMALLEST},
            {"name": "glue", "description": "The interface atoms: valuation, relation and the state s.", "text": GLUE},
            {"name": "check", "description": "Looks for support of the conclusion in the candidate's state (solver C).", "text": CHECK},
            {"name": "proof", "description": "The proof search (solver P): line t of the proof is grounded in round t.", "text": PROOF},
            {"name": "view", "description": "The domain view: the candidate model as a table, and a proof line by line.", "text": PRETTY + VIEW_MODEL.replace("#show draw/1.\n", "") + VIEW_PROOF + "#show draw/1.\n"},
        ],
        "views": [{"name": "view", "fragments": ["shared", "view"]}],
        "loop": {"language": "loop", "text": PROOFS_LOOP},
        "settings": {"constants": {}, "solutions": 0, "seconds": 60, "candidates": 0, "trace": 200, "seed": 0},
        "instances": PROOFS_INSTANCES,
        "variants": [
            {"name": "reference", "swap": {}, "constants": {"n": "2"}, "loop": {"language": "loop", "text": PROOFS_LOOP_REF}},
            {"name": "proof-first", "swap": {}, "constants": {}, "loop": {"language": "loop", "text": PROOFS_LOOP_FIRST}},
        ],
        "library": {
            "id": "bsml-proofs", "group": "logic",
            "summary": "Shortest natural deduction proofs in BSML, after a countermodel loop that rules out non-entailments (narrow-scope free choice: a proof of 7 lines).",
            "shape": "custom", "tags": ["fast", "several-solvers", "externals", "stops-at-optimum"], "expected": None, "optimum": 7, "level": 3, "after": 9,
        },
    }


def text(project):
    return json.dumps(project, indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    check = "--check" in sys.argv[1:]
    bad = 0
    for name, build in (("bsml-entailment", entailment), ("bsml-proofs", proofs)):
        path = os.path.join(ROOT, "examples", "contrib", name + ".json")
        new = text(build())
        if check:
            old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
            if old != new:
                print(f"{path} differs from tools/make-bsml.py"); bad = 1
        else:
            open(path, "w", encoding="utf-8").write(new)
            print("wrote", path)
    sys.exit(bad)
