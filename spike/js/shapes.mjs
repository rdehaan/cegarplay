export const DECL = (aopts, compat) => `
    local A = rt.solver("A", {"shared", "abstraction"}, {${aopts}})
    local C = rt.solver("C", {"shared", "check"}, {"--heuristic=Domain"})
    local G = rt.link("G", A, C, {"shared", "glue"}, ${compat})
`;
export const LAZY = (compat = false) => DECL('"0"', compat) + `
    rt.prepare()
    A:search{ on_candidate = function(M)
      local X = C:solve{ assume = G:of(M) }
      if X then M:reject(G:clause(M, X)) end
    end }
`;
export const EAGER_CLAUSE = DECL('', false) + `
    rt.prepare()
    while true do
      local M = A:solve()
      if not M then break end
      local X = C:solve{ assume = G:of(M) }
      if X then A:add_clause(G:clause(M, X))
      else rt.accept(M); A:add_clause(G:block(M)) end
    end
`;
export const EAGER_EXPAND = DECL('', false) + `
    rt.capture("color", 2)
    rt.prepare()
    while true do
      local M = A:solve()
      if not M then break end
      local X = C:solve{ assume = G:of(M) }
      if X then A:expand("refine", { cex = X:atoms("color", 2) })
      else rt.accept(M); A:add_clause(G:block(M)) end
    end
`;
export const REFINE_PART = `
#program refine(k).
% The k-th counterexample is a colouring cex(k,color(N,C)).  It stops being a
% counterexample once an edge joins two nodes it colours alike, or a leaf is coloured differently.
broken(k) :- edge(N,M), N < M, cex(k,color(N,C)), cex(k,color(M,C)).
broken(k) :- leaf(N), leaf_color(N,C), not cex(k,color(N,C)).
broken(k) :- leaf(N), cex(k,color(N,C)), not leaf_color(N,C).
:- not broken(k).
`;
// Hybrid: search lazily, collect counterexamples, and every BATCH of them stop the search,
// ground the refinement rules for all of them, and search again.
export const HYBRID_EXPAND = (batch) => DECL('"0"', false) + `
    rt.capture("color", 2)
    rt.prepare()
    A.block_accepted = true
    local queue = {}
    repeat
      local exhausted = A:search{ on_candidate = function(M)
        local X = C:solve{ assume = G:of(M) }
        if X then
          queue[#queue + 1] = X
          M:reject(G:block(M))
          if #queue >= ${batch} then A:restart() end
        end
      end }
      for _, X in ipairs(queue) do A:expand("refine", { cex = X:atoms("color", 2) }) end
      local done = exhausted and #queue == 0
      queue = {}
    until done
`;
