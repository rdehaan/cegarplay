#script (lua)
FRAGMENTS = {}
FRAGMENTS["shared"] = [==[
% exists x1..x4  forall y1..y3  exists z1..z3 :  C1 & ... & C10  (clauses of three literals)
% xlit(C,I,S): clause C contains x_I (S = 1) or its negation (S = 0); ylit/3, zlit/3 likewise.
xvar(1..4).  yvar(1..3).  zvar(1..3).  clause(1..10).
xlit(1,4,0). zlit(1,3,0). ylit(1,1,1).      % ~x4 v ~z3 v y1
zlit(2,2,1). ylit(2,1,0). xlit(2,1,1).      % z2 v ~y1 v x1
xlit(3,4,0). zlit(3,1,1). ylit(3,2,0).      % ~x4 v z1 v ~y2
ylit(4,2,0). zlit(4,3,1). xlit(4,4,1).      % ~y2 v z3 v x4
ylit(5,1,0). zlit(5,2,0). xlit(5,4,1).      % ~y1 v ~z2 v x4
ylit(6,1,1). zlit(6,3,0). xlit(6,3,1).      % y1 v ~z3 v x3
zlit(7,2,1). ylit(7,2,0). xlit(7,1,1).      % z2 v ~y2 v x1
ylit(8,2,1). zlit(8,3,1). xlit(8,3,1).      % y2 v z3 v x3
zlit(9,1,1). ylit(9,2,1). xlit(9,2,0).      % z1 v y2 v ~x2
ylit(10,3,0). zlit(10,3,1). xlit(10,2,1).   % ~y3 v z3 v x2
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
      local Y, W
      while true do rt.tick()
        Y = B:solve{ assume = GX:of(M) }
        if not Y then
          break
        end
        W = C:solve{ assume = GXY:of(Y) }
        if W then
          B:add(GXY:clause(Y, W))
        else
          M:reject(GXC:core(C))
          break
        end
      end
    end }
  end)
end
LOOP_LINES = { 67, 89 }
#end.
