#script (lua)
FRAGMENTS = {}
FRAGMENTS["shared"] = [==[
% The instance (its facts) is in the Instances tab.
]==]
FRAGMENTS["outer"] = [==[
{ x(I) } :- xvar(I).
#show x/1.
% 'always' is true in every candidate; see the inner fragment.
{ always }.
:- not always.
]==]
FRAGMENTS["glue_x"] = [==[
glue(x(I)) :- xvar(I).
glue(always).
]==]
FRAGMENTS["middle"] = [==[
{ y(J) } :- yvar(J).
#show y/1.
]==]
FRAGMENTS["glue_xy"] = [==[
glue(x(I)) :- xvar(I).
glue(y(J)) :- yvar(J).
glue(always).
]==]
FRAGMENTS["inner"] = [==[
{ z(K) } :- zvar(K).
zsat(C) :- zlit(C,K,1), z(K).
zsat(C) :- zlit(C,K,0), not z(K).
% good(C,T): the interface atom T has the value that satisfies clause C.
good(C,x(I)) :- xlit(C,I,1), x(I).
good(C,x(I)) :- xlit(C,I,0), not x(I).
good(C,y(J)) :- ylit(C,J,1), y(J).
good(C,y(J)) :- ylit(C,J,0), not y(J).
ok(C) :- zsat(C).
ok(C) :- good(C,_).
% Every constraint reads 'always', so every unsat core contains it and is never empty.
:- clause(C), not ok(C), always.
#show z/1.

% z stays a witness while the clauses it does not satisfy itself keep their true
% x- and y-literals.
relevant(T) :- good(C,T), not zsat(C).
% If z satisfies every clause on its own, every candidate is a solution: blame 'always',
% and B has no y-assignment left.
open :- clause(C), not zsat(C).
relevant(always) :- not open.
]==]
CONSTS = {  }
SETTINGS = { solutions = 0, seconds = 60, candidates = 0, trace = 200, seed = 0, poll = false, plain = false }
local rt = {}
-- runtime stub
function main(prg)
  rt.run(function()
    local A = rt.solver("A", {"shared", "outer"}, {})
    local B = rt.solver("B", {"shared", "middle"}, {})
    local C = rt.solver("C", {"shared", "inner"}, {})
    local GX = rt.link("GX", A, B, {"shared", "glue_x"}, {})
    local GXY = rt.link("GXY", B, C, {"shared", "glue_xy"}, {})
    local GXC = rt.link("GXC", A, C, {"shared", "glue_x"}, {})
    rt.prepare()
    A:search{ on_candidate = function(M)
      local Y
      Y = B:search{ assume = GX:of(M), keep = true, on_candidate = function(Y)
        local W
        W = C:solve{ assume = GXY:of(Y) }
        if W then
          Y:reject(GXY:clause(Y, W))
        end
      end }
      if Y then
        M:reject(GXC:core(C))
      end
    end }
  end)
end
LOOP_LINES = { 55, 74 }
#end.
