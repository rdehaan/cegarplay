#script (lua)
FRAGMENTS = {}
FRAGMENTS["shared"] = [==[
% A small network over 8 binary features. A hidden unit fires when the weighted sum of
% its inputs reaches its threshold; the answer is "yes" when the weighted sum of the
% firing units reaches 3.
feature(1..8).
unit(1..3).
% weight(U,F,W): unit U sees feature F with weight W.
weight(1,1,-2). weight(1,3,1). weight(1,4,-1). weight(1,6,-3). weight(1,7,-3). weight(1,8,-1).
weight(2,1,-3). weight(2,3,2). weight(2,4,-2). weight(2,5,-3). weight(2,6,-2). weight(2,7,-1).
weight(2,8,3).
weight(3,1,-2). weight(3,2,3). weight(3,3,2).  weight(3,5,-3). weight(3,7,-1). weight(3,8,3).
threshold(1,2). threshold(2,1). threshold(3,2).
vote(1,1). vote(2,1). vote(3,3).
% The input to be explained: is(F,B) says that feature F has the value B.
is(1,0). is(2,1). is(3,1). is(4,0). is(5,1). is(6,0). is(7,0). is(8,1).
% The network's answer on this input.
fires0(U) :- threshold(U,T), #sum { W,F : weight(U,F,W), is(F,1) } >= T.
yes0 :- #sum { V,U : vote(U,V), fires0(U) } >= 3.
]==]
FRAGMENTS["abstraction"] = [==[
% A candidate: any set of features whose values are kept.
{ keep(F) : feature(F) }.
#show keep/1.
]==]
FRAGMENTS["glue"] = [==[
glue(keep(F)) :- feature(F).
]==]
FRAGMENTS["check"] = [==[
% A counterexample: another input x/1 that agrees with the given one on the kept
% features ...
{ x(F) } :- feature(F).
:- keep(F), is(F,1), not x(F).
:- keep(F), is(F,0), x(F).
% ... but gets the other answer from the network.
fires(U) :- threshold(U,T), #sum { W,F : weight(U,F,W), x(F) } >= T.
yes :- #sum { V,U : vote(U,V), fires(U) } >= 3.
:- yes, yes0.
:- not yes, not yes0.
differs(F) :- is(F,1), not x(F).
differs(F) :- is(F,0), x(F).
#show x/1.
#show differs/1.

% The input refutes every set of kept features on which it agrees with the given
% input. So one of the features on which it differs has to be kept.
relevant(keep(F)) :- differs(F).
]==]
CONSTS = {  }
SETTINGS = { solutions = 0, seconds = 60, candidates = 0, trace = 200, seed = 0, poll = false, plain = false }
local rt = {}
-- runtime stub
function main(prg)
  rt.run(function()
-- Minimal sufficient reasons by shrinking: take any candidate; if the check finds no
-- counterexample, drop kept features one at a time as long as the check still fails,
-- report what is left, and exclude every superset of it.
local A = rt.solver("A", {"shared", "abstraction"}, {})
local C = rt.solver("C", {"shared", "check"}, {"--heuristic=Domain"})
local G = rt.link("G", A, C, {"shared", "glue"}, {})
rt.prepare()

-- G:of(M) lists, for each interface atom j, the literal of the atom in C, positive if
-- the atom is true in M. G:block(M) lists the literal of the same atom in A, negated if
-- it is true in M. Together they give the literals of the interface atoms in A.
local srcA = nil
local function learn_literals(M)
  local a, b = G:of(M), G:block(M)
  srcA = {}
  for j = 1, #a do srcA[j] = a[j] > 0 and -b[j] or b[j] end
end

local function copy(a)
  local b = {}
  for i = 1, #a do b[i] = a[i] end
  return b
end

-- Entry i assumes its feature kept.
local function is_kept(a, i) return a[i] > 0 end

-- A copy of a in which feature i is dropped.
local function dropped(a, i)
  local b = copy(a)
  b[i] = -b[i]
  return b
end

-- The clause for A "not all features that a keeps": removes a and all its supersets.
local function superset_block(a)
  local c = {}
  for j = 1, #a do if a[j] > 0 then c[#c + 1] = -srcA[j] end end
  return c
end

-- A model of A with exactly the features that a keeps, for rt.accept.
local function model_of(a)
  local assume = {}
  for j = 1, #a do assume[j] = a[j] > 0 and srcA[j] or -srcA[j] end
  return A:solve{ assume = assume }
end

while true do
  local M = A:solve{}
  if not M then break end
  if not srcA then learn_literals(M) end
  local X = C:solve{ assume = G:of(M) }
  if X then
    A:add(G:clause(M, X))
  else
    local a, shrunk = copy(G:of(M)), false
    for i = 1, #a do
      if is_kept(a, i) then
        local b = dropped(a, i)
        if not C:solve{ assume = b } then a, shrunk = b, true end   -- still no counterexample: drop it
      end
    end
    -- If nothing was dropped, M itself is the solution (solving A again for the same
    -- values would trip the guard against a refinement that makes no progress).
    rt.accept(shrunk and model_of(a) or M)
    A:add(superset_block(a))
  end
end
  end)
end
LOOP_LINES = { 56, 124 }
#end.
