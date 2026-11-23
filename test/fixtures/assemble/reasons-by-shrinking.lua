#script (lua)
FRAGMENTS = {}
FRAGMENTS["shared"] = [==[
% The instance (its facts) is in the Instances tab.
% feature(F), unit(U), weight(U,F,W), threshold(U,T), vote(U,V), and the input is(F,B).
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
    local A = rt.solver("A", {"shared", "abstraction"}, {})
    local C = rt.solver("C", {"shared", "check"}, {"--heuristic=Domain"})
    local G = rt.link("G", A, C, {"shared", "glue"}, {})
    rt.prepare(); local M, X, E, shrunk
    while true do rt.tick()
      M = A:solve{}
      if not M then
        rt.stop()
      end
      X = C:solve{ assume = G:of(M) }
      if X then
        A:add(G:clause(M, X))
      else
        E = G:of(M)
        shrunk = false
        for _, a in rt.each(E) do rt.tick()
          if rt.atrue(a) and (not C:solve{ assume = rt.flip(E, a) }) then
            E = rt.flip(E, a)
            shrunk = true
          end
        end
        if shrunk then
          rt.accept(A:solve{ assume = E })
        else
          rt.accept(M)
        end
        A:add(G:above(E))
      end
    end
  end)
end
LOOP_LINES = { 44, 72 }
#end.
