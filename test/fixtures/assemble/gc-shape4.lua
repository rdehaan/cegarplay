#script (lua)
FRAGMENTS = {}
FRAGMENTS["shared"] = [==[
#const n=10.
node(1..n).
]==]
FRAGMENTS["abstraction"] = [==[
% Guess an undirected graph with n nodes
{ edge(X,Y) : node(X), node(Y), X < Y }.
edge(X,Y) :- edge(Y,X).

% Ensure that it is connected
reachable(1).
reachable(N) :- reachable(M), edge(N,M).
:- node(N), not reachable(N).

% Define a coloring on the leaves
leaf(N) :- node(N), edge(N,M1),
    not edge(N,M2) : node(M2), M1 != M2.
color(1..3).
1 { leaf_color(N,C) : color(C) } 1 :- leaf(N).

% No node may have two or more leaves with the same color as neighbors
:- node(N), edge(N,M1), edge(N,M2), M1 < M2,
    leaf_color(M1,C), leaf_color(M2,C).
% No node may have three or more leaves as neighbors
:- node(N), #count { M : edge(N,M), leaf(M) } >= 3.

% Show the edges (without duplicates)
#show.
#show edge(X,Y) : edge(X,Y), X < Y.
% Show the leaves and the coloring
#show leaf/1.
#show leaf_color/2.

#program refine(k).
% cex(k,color(N,C)): the k-th counterexample colours node N with C. It stops
% being a counterexample once an edge joins two nodes it colours alike, or a
% leaf gets a different colour.
broken(k) :- edge(N,M), N < M, cex(k,color(N,C)), cex(k,color(M,C)).
broken(k) :- leaf(N), leaf_color(N,C), not cex(k,color(N,C)).
broken(k) :- leaf(N), cex(k,color(N,C)), not leaf_color(N,C).
:- not broken(k).
]==]
FRAGMENTS["glue"] = [==[
% Guess and check interact on nodes and edges
glue(edge(X,Y)) :- node(X), node(Y), X != Y.

% And on leaves and their coloring
glue(leaf(1..n)).
glue(color(1..3)).
glue(leaf_color(N,C)) :- node(N), glue(color(C)).
]==]
FRAGMENTS["check"] = [==[
% Check that there is no proper 3-coloring of the entire graph
% that agrees with the leaf coloring
1 { color(N,C) : color(C) } 1 :- node(N).
:- edge(N,M), color(N,C), color(M,C).
:- leaf_color(N,C), not color(N,C), leaf(N).
:- color(N,C), not leaf_color(N,C), leaf(N).

% Any counterexample found depends only on these Stm for which relevant(Stm)
relevant(edge(N,M)) :- node(N), node(M), N < M, not edge(N,M).
relevant(leaf_color(N,C)) :- leaf_color(N,C), leaf(N).

% A node that is not a leaf now may become one. Giving it a leaf colour other
% than its colour in the counterexample also breaks the counterexample.
relevant(leaf_color(N,C)) :- node(N), not leaf(N), color(C), not color(N,C).
]==]
CONSTS = { "n=5" }
SETTINGS = { solutions = 0, seconds = 60, candidates = 0, trace = 200, seed = 0, poll = false, plain = false }
local rt = {}
-- runtime stub
function main(prg)
  rt.run(function()
    local A = rt.solver("A", {"shared", "abstraction"}, {})
    local C = rt.solver("C", {"shared", "check"}, {"--heuristic=Domain"})
    local G = rt.link("G", A, C, {"shared", "glue"}, {})
    rt.capture("color", 2); rt.prepare(); local pending, grounded
    pending = {}
    repeat rt.tick()
      A:search{ on_candidate = function(M)
        local X
        X = C:solve{ assume = G:of(M) }
        if X then
          rt.push(pending, X)
          M:reject(G:block(M))
          if rt.size(pending) >= 20 then
            rt.restart()
          end
        end
      end }
      grounded = rt.size(pending)
      for _, X in ipairs(pending) do rt.tick()
        A:expand("refine", { cex = X:atoms("color", 2) })
      end
      rt.clear(pending)
    until A.exhausted and grounded == 0
  end)
end
LOOP_LINES = { 76, 98 }
#end.
