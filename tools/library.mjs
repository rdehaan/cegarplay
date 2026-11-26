// The example library: the examples written by hand (tutorial, loop language) and the
// manifest examples/library.json. Used by tools/make-examples.mjs.
import { newProject, starterProject, template } from '../js/project.js';

// ---- the tutorial toy: sum-free sets ---------------------------------------------------
// A set S of numbers in 1..n is sum-free if no X, Y in S (X = Y allowed) have X + Y in S.
const SUMFREE = {
  shared: `% Rules every solver needs. The constant n is set in the Loop tab.
num(1..n).
`,
  abstraction: `% Solver A proposes candidates: here, any set of numbers.
{ pick(X) : num(X) }.
#show pick/1.
`,
  glue: `% The atoms solver A and solver C share. glue(T) makes T an interface atom:
% its value in a candidate is fixed when the check runs.
glue(pick(X)) :- num(X).
`,
  check: `% Solver C looks for a counterexample: a sum X + Y = Z inside the candidate.
1 { sum(X,Y) : num(X), num(Y), X <= Y, X + Y <= n } 1.
:- sum(X,Y), not pick(X).
:- sum(X,Y), not pick(Y).
:- sum(X,Y), not pick(X+Y).
#show sum/2.

% relevant(T): the interface atoms the counterexample depends on.
% The refinement says: at least one of them must change.
relevant(pick(X)) :- sum(X,Y).
relevant(pick(Y)) :- sum(X,Y).
relevant(pick(X+Y)) :- sum(X,Y).
`,
};
const SUMFREE_DESC = {
  shared: 'Added to every solver.',
  abstraction: 'Proposes candidates (solver A).',
  glue: 'The interface atoms: every glue(T) makes T an interface atom.',
  check: 'Looks for a counterexample to a candidate (solver C) and marks the atoms it depends on with relevant/1.',
};

export function project(title, description, fragments, loop, settings = {}, descriptions = SUMFREE_DESC) {
  const p = newProject(title);
  p.description = description;
  p.fragments = Object.entries(fragments).map(([name, text]) => ({ name, text, ...(descriptions[name] ? { description: descriptions[name] } : {}) }));
  p.loop = typeof loop === 'string' ? { language: 'loop', text: loop } : loop;
  p.settings = { ...p.settings, solutions: 0, ...settings, constants: { ...(settings.constants || {}) } };
  return p;
}
const sumfree = (title, description, loop, edit = (f) => f, settings = {}) =>
  project(title, description, edit({ ...SUMFREE }), loop, { constants: { n: '8' }, ...settings });

const DECL = `solver A = shared + abstraction
solver C = shared + check
link   G = A -> C via shared + glue
`;

// ---- loop scripts that show the language ----------------------------------------------
const BASICS = `# Declarations come first.
# A solver is built from fragments; options are passed to clingo.
solver A = shared + abstraction
solver C = shared + check          options "--configuration=trendy"
# A link says which atoms two solvers share (here: the glue/1 atoms).
link   G = A -> C via shared + glue

# Statements follow. Variables need no declaration; # starts a comment.
found = 0
sizes = []                         # an empty list

loop:                              # loop forever (until stop or break)
    M = A.solve()                  # the next candidate, or none
    if not M:
        log "no candidates left;", found, "solutions"
        break                      # leave the loop
    X = C.solve(assume G(M))       # look for a counterexample to M
    if X:
        count refinements          # a counter, shown in the Statistics tab
        A.add(G.clause(M, X))      # one relevant atom must change
    elif found >= 1000:
        stop "enough solutions"    # ends the whole run, with a message
    else:
        accept M                   # M is a solution
        found = found + 1
        sizes.push(M.atoms(pick/1).size)
        A.add(G.block(M))          # never propose M again

biggest = 0
for s in sizes:
    if s > biggest: biggest = s
log "largest sum-free set:", biggest
count largest by biggest
`;

const SEVERAL = DECL + `
# C.models returns a list of up to 'limit' counterexamples. Every one of them
# refines the abstraction; the candidate is rejected once.
search A:
    on candidate M:
        for X in C.models(assume G(M), limit 3):
            reject M with G.clause(M, X)
`;

const OPTIMAL = DECL + `
# With 'optimal', C.solve returns an optimal counterexample: here one that marks
# as few relevant atoms as possible (see the #minimize in the check fragment),
# which gives shorter refinement clauses.
search A:
    on candidate M:
        X = C.solve(assume G(M), optimal)
        if X:
            reject M with G.clause(M, X)
`;

const TWO_STAGE = `solver A  = shared + abstraction
solver C1 = shared + sums
solver C2 = shared + neighbours
link   G1 = A -> C1 via shared + glue
link   G2 = A -> C2 via shared + glue

# Two checks: C2 runs only when C1 finds nothing. Whichever finds a
# counterexample, its own link turns it into the refinement.
search A:
    on candidate M:
        X = C1.solve(assume G1(M))
        if X:
            reject M with G1.clause(M, X)
        else:
            Y = C2.solve(assume G2(M))
            if Y: reject M with G2.clause(M, Y)
`;

const CLAUSES = DECL + `
# G.clauses(X) reads the refinement from the counterexample itself: the check
# fragment derives clause(Id, Atom, Value) atoms, one clause per Id.
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X: reject M with G.clauses(X)
`;

const LEGACY = `solver A = shared + abstraction
solver C = shared + check
# 'legacy': the glue fragment lists the interface atoms themselves (pick(X)), as
# files written for cegar.py do, instead of glue(pick(X)).
link   G = A -> C via shared + glue legacy

search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X: reject M with G.clause(M, X)
`;

const RAW_LUA = `-- A raw Lua loop: the text runs inside rt.run(function() ... end).
-- It is the Shape 1 script, compiled by hand. See the manual for the rt API.
local A = rt.solver("A", {"shared", "abstraction"}, {})
local C = rt.solver("C", {"shared", "check"}, {})
local G = rt.link("G", A, C, {"shared", "glue"}, {})
rt.prepare()                      -- grounds the solvers; call once, after the declarations

local found = 0
A:search{ on_candidate = function(M)
  local X = C:solve{ assume = G:of(M) }
  if X then
    M:reject(G:clause(M, X))
  else
    found = found + 1             -- not rejected: M is a solution
  end
end }
rt.log("solutions:", found)
`;

// The dual problem: a candidate graph is a solution when the check is satisfiable.
export const DUAL = {
  shared: `% Graphs on n nodes.
node(1..n).
`,
  abstraction: `% A candidate: any graph.
{ edge(X,Y) : node(X), node(Y), X < Y }.
#show edge/2.
`,
  glue: `glue(edge(X,Y)) :- node(X), node(Y), X < Y.
`,
  check: `% A witness, not a counterexample: a proper 3-colouring of the candidate.
% If there is none, the candidate is wrong, and the unsat core says which
% edges are to blame.
1 { col(N,1..3) } 1 :- node(N).
:- edge(X,Y), col(X,C), col(Y,C).
`,
};
const CORE = DECL + `
# Here the check looks for a witness. A candidate without one is rejected;
# G.core(C) is the refinement built from the unsatisfiable core of the last
# C.solve: the edges that together make 3-colouring impossible.
search A:
    on candidate M:
        if not C.solve(assume G(M)):
            reject M with G.core(C)
`;

// ---- graph colouring variants ---------------------------------------------------------
// gc: the graph-coloring example (built by make-examples.mjs), copied and changed here.
function gcVariant(gc, title, description, loop, edit = () => {}, n = '5') {
  const p = structuredClone(gc);
  delete p.instances;
  delete p.settings.instance;
  p.version = 1;
  p.title = title;
  p.description = description;
  p.loop = typeof loop === 'string' ? { language: 'loop', text: loop } : loop;
  p.settings = { ...p.settings, constants: { n }, solutions: 0 };
  p.runs = [];
  edit(p);
  return p;
}

const SECOND_SOLVER = `solver A = shared + abstraction
solver C = shared + check          options "--heuristic=Domain"
solver R = shared + refine
link G  = A -> C via shared + glue
link GA = A -> R via shared + glue
link GC = C -> R via shared + rglue

# C finds a counterexample X; a third solver R computes the refinement from the
# candidate and the counterexample together (two assumption lists).
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            Y = R.solve(assume GA(M), GC(X))
            reject M with GA.clause(M, Y)
`;

// ---- the manifest ----------------------------------------------------------------------
export const GROUPS = [
  { id: 'tutorial', title: 'Tutorial', description: 'Small examples used step by step in the Tutorial tab.' },
  { id: 'guide', title: 'Guide', description: 'The examples of the design guide, in reading order.' },
  { id: 'language', title: 'The loop language', description: 'One feature of the loop language each, with comments in the loop script.' },
  { id: 'shapes', title: 'Loop shapes', description: 'Graph colouring at n = 5 with each of the five templates; all give the same solutions.' },
  { id: 'logic', title: 'Logic and QBF', description: 'Quantified Boolean formulas (also with more quantifier blocks), minimal formulas and unsatisfiable cores, stable models.' },
  { id: 'reasoning', title: 'Knowledge representation and explanation', description: 'Abduction, defaults, belief update, diagnosis, causality, argumentation, reasons for a classifier.' },
  { id: 'graphs', title: 'Graphs', description: 'Colourings, list colourings, cliques and Ramsey-type arrowing.' },
  { id: 'games', title: 'Games and other social choice', description: 'Equilibria, stable coalitions, fair division, games on graphs and numbers.' },
  { id: 'voting', title: 'Voting', description: 'The Kemeny and Slater rankings and the Dodgson and Young winners (with Formula 1 seasons from PrefLib), control of a Kemeny election, and justifications of voting outcomes by axioms.' },
  { id: 'judgment', title: 'Judgment aggregation', description: 'Outcomes of six judgment aggregation rules (Kemeny, Slater, Leximax, MSA, Young, Dodgson) on agendas with an integrity constraint, complete for Theta-2, Delta-2 (Leximax) and Sigma-2 (MSA), each with a different loop: implicit hitting sets, OLL, level by level, MARCO, row generation and binary search.' },
  { id: 'planning', title: 'Planning and optimisation', description: 'Conformant planning, bilevel and trilevel knapsack problems.' },
  { id: 'puzzles', title: 'Puzzles', description: 'Generating puzzles with a unique solution: Sudoku, Binairo, Futoshiki, Akari, Slitherlink.' },
  { id: 'other', title: 'Other problems', description: 'Contributed problems without a category.' },
  { id: 'exercises', title: 'Exercises', description: 'Starter projects that check themselves: Check exercise (Instances tab) runs the instances, the audit and the budgets.' },
];

// Self-checking exercises (FUTURE-DIRECTIONS F1), built from two existing examples by
// tools/make-examples.mjs: (id, base, title, description, edit(project)).
export const EXERCISES = [
  { id: 'exercise-sum-free', base: 'tutorial-weak-relevant', title: 'Exercise: a sound refinement for sum-free sets',
    summary: 'Fix relevant/1 so that every count matches, the audit is sound, and n = 8 needs at most 107 candidates.',
    description: 'Sets of numbers in 1..n in which no two members add up to a third. The check marks too little as relevant, ' +
      'and the loop loses solutions. Change relevant/1 in the check, then press Check exercise in the Instances tab.',
    text: 'Fix relevant/1 in the fragment check. Every instance must give its expected count with all solutions, the audit ' +
      'must find no unsound refinement on n = 4, 5 and 6, and n = 8 must need at most 107 candidates.',
    instances: [[4, 9], [5, 16], [6, 24], [7, 42], [8, 61]].map(([n, c]) => ({ id: `n${n}`, facts: '', constants: { n: String(n) }, expected: { solutions: c }, tags: [] })),
    exercise: { instances: 'all', audit: ['n4', 'n5', 'n6'], budgets: [{ instance: 'n8', candidates: 107 }] } },
  { id: 'exercise-triangles', base: 'guide-02-block', title: 'Exercise: learn from a triangle',
    summary: 'Replace blocking by a clause from relevant/1 so that k = 3 needs at most 13 candidates.',
    description: 'Delete at most k nodes of the small graph of the guide so that no triangle is left. The loop blocks every ' +
      'refuted candidate on its own. Write relevant/1 in the check and use G.clause(M, X) in the loop (guide, chapter 3), ' +
      'then press Check exercise in the Instances tab.',
    text: 'Make the loop learn from each surviving triangle: write relevant/1 in the check and reject with G.clause(M, X). ' +
      'The counts must stay the same, the audit must be sound on k = 2 and 3, and k = 3 must need at most 13 candidates ' +
      '(k = 4 at most 65).',
    instances: [[2, 0], [3, 3], [4, 45]].map(([k, c]) => ({ id: `k${k}`, facts: '', constants: { k: String(k) }, expected: { solutions: c }, tags: [] })),
    exercise: { instances: 'all', audit: ['k2', 'k3'], budgets: [{ instance: 'k3', candidates: 13 }, { instance: 'k4', candidates: 65 }] } },
];

// Every entry: id, group, summary, shape (template or 'custom'), tags, expected solutions.
export function buildLibrary(gc) {
  const E = [];
  const add = (id, group, summary, shape, tags, expected, p) => E.push({ id, group, summary, shape, tags, expected, project: p });

  add('starter', 'tutorial', 'The New project starter: four commented fragments to replace by your own problem.',
    'shape1', ['fast'], 4, starterProject());
  add('tutorial-first-run', 'tutorial', 'Sum-free sets of numbers: the smallest complete CEGAR loop.', 'shape1', ['fast'], 61,
    sumfree('Sum-free sets', 'Sets of numbers in 1..n in which no two members (possibly the same one twice) add up to a ' +
      'third. Solver A guesses a set, solver C looks for a sum inside it, and the refinement says that one of the three ' +
      'numbers involved must leave the set.', template('shape1').replace(/\nsolver C.*\n/, '\nsolver C = shared + check\n')));
  add('tutorial-weak-relevant', 'tutorial', 'The same problem with a relevant/1 rule that marks too little: solutions get lost.',
    'shape2', ['fast'], 11,
    sumfree('Sum-free sets (too weak relevant/1)', 'The check marks only the sum X + Y as relevant, not X and Y. A ' +
      'refinement then forbids the sum for every candidate, also for sets that do not contain X or Y, so the loop ' +
      'finds 11 solutions instead of 61. Switch the loop to the Reference run template to see the true count.',
    template('shape2').replace(/\nsolver C.*\n/, '\nsolver C = shared + check\n'),
    (f) => ({ ...f, check: f.check.replace(/relevant\(pick\(X\)\) :- sum\(X,Y\)\.\nrelevant\(pick\(Y\)\) :- sum\(X,Y\)\.\n/,
      '% Too weak: X and Y are not marked.\n') })));

  add('lang-basics', 'language', 'Declarations, options, variables, loop, if/elif/else, lists, for, count, log, stop, accept.',
    'custom', ['fast'], 61, sumfree('Loop language: the basics', 'Shape 2 on sum-free sets, written out with most ' +
      'statements of the loop language. Read the comments in the Loop tab; after a run, the log lines are in the ' +
      'Output tab and the counters in the Statistics tab.', BASICS));
  add('lang-several-cex', 'language', 'for X in C.models(assume G(M), limit 3): several counterexamples per candidate.',
    'custom', ['fast'], 61, sumfree('Loop language: several counterexamples', 'Each rejected candidate is refined with up ' +
      'to three counterexamples at once, so fewer candidates are needed.', SEVERAL));
  add('lang-optimal', 'language', 'C.solve(assume G(M), optimal): the smallest refinement, with #minimize in the check.',
    'custom', ['fast'], 61, sumfree('Loop language: optimal counterexamples', 'The check prefers counterexamples with few ' +
      'relevant atoms (X + X = Z marks two numbers, X + Y = Z three).', OPTIMAL,
    (f) => ({ ...f, check: f.check + '\n% Prefer counterexamples that mark few atoms.\n#minimize { 1,T : relevant(T) }.\n' })));
  add('lang-two-stage', 'language', 'Two check solvers with their own fragments and links; the second runs only if the first finds nothing.',
    'custom', ['fast'], 38, project('Loop language: two checks', 'Sum-free sets without two consecutive numbers. One check ' +
      'solver looks for sums, a second one for neighbours.', {
      shared: SUMFREE.shared, abstraction: SUMFREE.abstraction, glue: SUMFREE.glue,
      sums: SUMFREE.check,
      neighbours: `% The second check: two consecutive numbers in the set.
1 { next(X) : num(X), num(X+1) } 1.
:- next(X), not pick(X).
:- next(X), not pick(X+1).
relevant(pick(X)) :- next(X).
relevant(pick(X+1)) :- next(X).
`,
    }, TWO_STAGE, { constants: { n: '8' } }, { ...SUMFREE_DESC, sums: 'The first check: a sum inside the set.', neighbours: 'The second check: two consecutive numbers.' }));
  add('lang-clauses', 'language', 'reject M with G.clauses(X): the refinement written as clause/3 atoms in ASP.',
    'custom', ['fast'], 61, sumfree('Loop language: clauses from ASP', 'The check derives the refinement itself: ' +
      'clause(Id, Atom, Value) means "Atom must have Value"; the atoms with one Id form one clause (one of them must hold).',
    CLAUSES, (f) => ({ ...f, check: f.check.replace(/% relevant\(T\)[\s\S]*$/, `% One clause: one of the three numbers must leave the set.
clause(1, pick(X), false) :- sum(X,Y).
clause(1, pick(Y), false) :- sum(X,Y).
clause(1, pick(X+Y), false) :- sum(X,Y).
`) })));
  add('lang-core', 'language', 'reject M with G.core(C): refine from an unsatisfiable core when the check looks for a witness.',
    'custom', ['fast'], 958, project('Loop language: unsat cores', 'Graphs on n nodes that can be 3-coloured. Here a ' +
      'candidate is good when the check is satisfiable; a bad candidate is refined with the core of the failed check. ' +
      'Compare with the Reference run in the comment at the end of the loop script.', DUAL,
    CORE + '\n# For comparison, the reference run blocks each bad candidate:\n#         if not C.solve(assume G(M)):\n#             reject M with G.block(M)\n',
    { constants: { n: '5' } }, {}));
  add('lang-second-solver', 'language', 'A third solver R computes the refinement: R.solve(assume GA(M), GC(X)).',
    'custom', ['fast'], 101, gcVariant(gc, 'Loop language: a refinement solver', 'Graph colouring at n = 5. The check ' +
      'fragment has no relevant/1 rules; solver R, built from the refine fragment, derives them from the candidate (link GA) ' +
      'and the counterexample (link GC, interface atoms color/2 from the rglue fragment).', SECOND_SOLVER, (p) => {
      const check = p.fragments.find((f) => f.name === 'check');
      const rules = check.text.match(/^relevant\(.*$/gm).join('\n');
      check.text = check.text.replace(/\n% Any counterexample found[\s\S]*$/, '\n');
      check.description = 'Looks for a counterexample to a candidate (solver C); no relevant/1 rules here.';
      p.fragments.push({ name: 'rglue', description: 'The interface atoms of link GC: the colouring found by C.', text: 'glue(color(N,C)) :- node(N), C = 1..3.\n' });
      p.fragments.push({ name: 'refine', description: 'Solver R: the relevant/1 rules, given the candidate and the counterexample.', text: '% Given the candidate (from A) and the colouring X (from C): which atoms must change?\n' + rules + '\n' });
    }));
  add('lang-legacy', 'language', 'link ... legacy: glue fragments that list the interface atoms themselves (cegar.py files).',
    'shape1', ['fast'], 61, sumfree('Loop language: legacy glue', 'The glue fragment says pick(X) instead of glue(pick(X)), as ' +
      'in files written for cegar.py; the link needs the keyword legacy.', LEGACY,
    (f) => ({ ...f, glue: '% Legacy glue: the interface atoms themselves.\npick(X) :- num(X).\n' })));
  add('lang-raw-lua', 'language', 'A loop written directly in Lua against the runtime API (rt.solver, rt.link, A:search, ...).',
    'custom', ['fast'], 61, sumfree('Loop language: raw Lua', 'The Shape 1 loop written in Lua. Use this when the loop ' +
      'language lacks something; "Edit as Lua" in the Loop tab turns any loop script into Lua like this.',
    { language: 'lua', text: RAW_LUA }));

  const shapes = {
    shape1: 'Shape 1: check inside the search. One solve call of A for the whole run; refinements are added as clauses during the search.',
    shape2: 'Shape 2: solve, check, refine, solve again. A is solved once per candidate.',
    shape3: 'Shape 3: ground the #program refine(k) part once per counterexample (rules instead of clauses).',
    shape4: 'Shape 4: search, collect counterexamples, ground the refine part for 20 at a time.',
    reference: 'Reference run: block each refuted candidate. Always sound; slow, but its count is the truth.',
  };
  for (const [k, text] of Object.entries(shapes)) {
    const id = k === 'reference' ? 'gc-reference' : `gc-${k}`;
    add(id, 'shapes', text, k, ['fast'], 101,
      gcVariant(gc, `Graph colouring, ${TEMPLATE_TITLE[k]}`, `Graph colouring at n = 5 with the ${TEMPLATE_TITLE[k]} template. ${text}`, template(k)));
  }
  return E;
}
const TEMPLATE_TITLE = { shape1: 'Shape 1', shape2: 'Shape 2', shape3: 'Shape 3', shape4: 'Shape 4', reference: 'Reference run' };

// The three larger problems built from the declarative-cegar files, with their categories.
export const PROBLEMS = [
  { id: 'graph-coloring', group: 'graphs', summary: 'Graphs with a leaf colouring that no 3-colouring extends (n = 6, all 10,698 solutions).', shape: 'shape1', tags: [], expected: 10698 },
  { id: 'nash', group: 'games', summary: 'Weighted graphs whose colouring game has a Nash equilibrium (four size instances).', shape: 'shape1', tags: [], expected: null },
  { id: 'voting-justification', group: 'voting', summary: 'Explaining a voting outcome by axioms: 30 questions as instances (17 from Nardi, Boixel and Endriss, 7 generated), three refinement strategies and the loops built on them as variants, suites that compare them.', shape: 'shape1', tags: [], expected: null },
  { id: 'voting-justification-ihs', group: 'voting', summary: 'The smallest justifications of a voting outcome by implicit hitting sets: the same 30 questions without a fixed number of axiom instances; variants with minimum correction sets, several counterexamples, ascending sizes.', shape: 'custom', tags: ['ihs'], expected: null },
];

// ---------------------------------------------------------------------------
// Starter generators, attached to the examples they fit by
// tools/make-examples.mjs. Each is ASP with seeded draws; its shown atoms are an instance.
// ---------------------------------------------------------------------------
const SYM = '% the example\'s check reads edges in both directions\nedge(Y,X) :- edge(X,Y).\n';
const gnp = (sym = false) => ({
  name: 'gnp',
  description: 'A connected random graph G(n,p): each edge with probability p/1000; a disconnected draw is redrawn.',
  params: { n: 'int', p: 'permille' }, defaults: { n: 7, p: 300 },
  text: `% gnp: a connected random graph with n nodes; each edge is present with probability p/1000
node(1..n).
edge(X,Y) :- node(X), node(Y), X < Y, @flip(p, X, Y) = 1.

reach(1).
reach(Y) :- reach(X), edge(X,Y).
reach(X) :- reach(Y), edge(X,Y).
:- node(X), not reach(X).            % a disconnected draw is rejected and redrawn
${sym ? SYM : ''}
#show node/1.  #show edge/2.
`,
});
const gnm = (sym = false) => ({
  name: 'gnm',
  description: 'A random graph G(n,m): exactly m of the n(n-1)/2 possible edges, chosen uniformly.',
  params: { n: 'int', m: 'int' }, defaults: { n: 7, m: 10 },
  text: `% gnm: m edges chosen uniformly among the pairs of n nodes (pair I is the I-th pair X < Y)
node(1..n).
pair(X,Y,(X-1)*n - (X-1)*X/2 + Y - X) :- node(X), node(Y), X < Y.
edge(X,Y) :- pair(X,Y,I), @subset(m, n*(n-1)/2, I, edges) = 1.
${sym ? SYM : ''}
#show node/1.  #show edge/2.
`,
});
const afGnp = (query) => ({
  name: 'af-gnp',
  description: `A random argumentation framework: n arguments, each attack X -> Y with probability p/1000${query ? ', and a random query argument' : ''}.`,
  params: { n: 'int', p: 'permille' }, defaults: { n: 7, p: 250 },
  text: `% af-gnp: arguments 1..n; each ordered pair (also X = Y) attacks with probability p/1000
arg(1..n).
att(X,Y) :- arg(X), arg(Y), @flip(p, X, Y) = 1.
${query ? 'query(@int(1, n, query)).\n' : ''}
#show arg/1.  #show att/2.${query ? '  #show query/1.' : ''}
`,
});
// voting-justification: generated questions with small bounds; counts measured with
// tools/run.mjs --solutions all and the same for every variant. random-1 and random-2 have
// thousands of candidates: too large for the audit's memory. random-4..7 were picked from a
// search over seeds 1..30 for questions with a justification and 30 to 80 candidates.
const voteRecipe = (id, v, a, s, profiles, k, solutions) => ({ id, recipe: { generator: 'vote-question', params: { v, a }, seed: s },
  expected: { solutions }, tags: ['generated'], constants: { num_candidates: '3', num_voters: String(v), num_profiles: String(profiles), num_axiom_instances: String(k) } });
const VOTE_RECIPES = [
    { id: 'random-1', recipe: { generator: 'vote-question', params: { v: 3, a: 3 }, seed: 1 }, expected: { solutions: 6 }, tags: ['generated'], audit: false,
      constants: { num_candidates: '3', num_voters: '3', num_profiles: '3', num_axiom_instances: '3' } },
    { id: 'random-2', recipe: { generator: 'vote-question', params: { v: 2, a: 2 }, seed: 3 }, expected: { solutions: 0 }, tags: ['generated', 'no-solution'], audit: false,
      constants: { num_candidates: '3', num_voters: '2', num_profiles: '3', num_axiom_instances: '3' } },
    { id: 'random-3', recipe: { generator: 'vote-question', params: { v: 3, a: 2 }, seed: 3 }, expected: { solutions: 0 }, tags: ['generated', 'no-solution'],
      constants: { num_candidates: '3', num_voters: '3', num_profiles: '2', num_axiom_instances: '2' } },
    voteRecipe('random-4', 2, 3, 29, 2, 2, 17),
    voteRecipe('random-5', 3, 4, 8, 2, 2, 27),
    voteRecipe('random-6', 2, 4, 25, 2, 3, 4),
    voteRecipe('random-7', 3, 4, 18, 3, 2, 10),
  ];

// voting-justification: random questions (FUTURE-DIRECTIONS E2)
const VOTE_QUESTION = {
  name: 'vote-question',
  description: 'A random question: a of the eight axioms, a target profile of v voters over three candidates (uniform rankings, sorted), one target outcome.',
  params: { v: 'int', a: 'int' }, defaults: { v: 2, a: 2 },
  text: `% vote-question: a random question for voting-justification. a axioms out of eight, a target
% profile of v voters over three candidates (each voter a uniform ranking; the voters sorted
% lexicographically, as the abstraction expects), and one target outcome.
ax(1,pareto). ax(2,faithfulness). ax(3,unanimity). ax(4,cancellation).
ax(5,reinforcement). ax(6,condorcet). ax(7,neutrality2). ax(8,pos_responsiveness).
use_axiom(A) :- ax(I,A), @subset(a, 8, I, axioms) = 1.
% the six rankings of 1..3 in lexicographic order: rk(K, Position, Candidate)
rk(1,1,1). rk(1,2,2). rk(1,3,3).   rk(2,1,1). rk(2,2,3). rk(2,3,2).
rk(3,1,2). rk(3,2,1). rk(3,3,3).   rk(4,1,2). rk(4,2,3). rk(4,3,1).
rk(5,1,3). rk(5,2,1). rk(5,3,2).   rk(6,1,3). rk(6,2,2). rk(6,3,1).
voter(1..v).
pick(V,@int(1, 6, V, ranking)) :- voter(V).
% voter V's place in the sorted profile: voters with a smaller ranking, then ties by index
place(V,1 + N1 + N2) :- pick(V,K), N1 = #count { W : pick(W,L), L < K }, N2 = #count { W : pick(W,K), W < V }.
target_profile(P,C,Pos) :- place(V,P), pick(V,K), rk(K,Pos,C).
target_outcome(@int(1, 3, outcome)).
requires_polarity_axiom.
#show use_axiom/1. #show target_profile/3. #show target_outcome/1. #show requires_polarity_axiom/0.
`,
};

const QBF_DNF = {
  name: 'qbf-dnf',
  description: 'A random exists-forall QBF with a DNF matrix: t terms of three literals over nx + ny variables.',
  params: { nx: 'int', ny: 'int', t: 'int' }, defaults: { nx: 5, ny: 4, t: 10 },
  text: `% qbf-dnf: exists x1..x_nx forall y1..y_ny : T1 v ... v Tt, three literals per term.
% Each literal picks one of the nx + ny variables uniformly and a sign with probability 1/2.
xvar(1..nx).  yvar(1..ny).
term(1..t).  slot(1..3).
var(T,J,@int(1, nx+ny, T, J)) :- term(T), slot(J).
sign(T,J,@flip(500, T, J, sign)) :- term(T), slot(J).
xlit(T,I,S) :- var(T,J,I), sign(T,J,S), I <= nx.
ylit(T,I-nx,S) :- var(T,J,I), sign(T,J,S), I > nx.

#show xvar/1.  #show yvar/1.  #show xlit/3.  #show ylit/3.
`,
};
const BALLOTS_IC = {
  name: 'ballots-ic',
  description: 'An election under impartial culture: v voters, each ranks the four candidates a, b, c, d by a uniform permutation.',
  params: { v: 'int' }, defaults: { v: 7 },
  text: `% ballots-ic: v voters; voter V ranks the candidates by a uniform permutation named V
cand(a;b;c;d).
c(1,a). c(2,b). c(3,c). c(4,d).
voter(1..v).
ballot(V,(A,B,C,D)) :- voter(V), c(@perm(4,1,V),A), c(@perm(4,2,V),B), c(@perm(4,3,V),C), c(@perm(4,4,V),D).
favourite(b).

#show cand/1.  #show ballot/2.  #show favourite/1.
`,
};
const BALLOTS_MALLOWS = {
  name: 'ballots-mallows',
  description: 'An election under the Mallows model: rankings near a, b, c, d with dispersion phi/1000 (1000 = impartial culture).',
  params: { v: 'int', phi: 'permille' }, defaults: { v: 7, phi: 500 },
  text: `% ballots-mallows: voter V places candidate I at position @mallows(4, phi, I, V)
cand(a;b;c;d).
c(1,a). c(2,b). c(3,c). c(4,d).
voter(1..v).
at(V,@mallows(4, phi, I, V),X) :- voter(V), c(I,X).
ballot(V,(A,B,C,D)) :- at(V,1,A), at(V,2,B), at(V,3,C), at(V,4,D).
favourite(b).

#show cand/1.  #show ballot/2.  #show favourite/1.
`,
};

// example id -> its generators (contrib examples carry their generators in their own file)
export const GENERATORS = {};
// voting-justification's generator, recipe instances and view are attached by buildExamples in
// tools/make-examples.mjs (its file must equal buildExamples' output).
export const VOTE_KIT = { generators: [VOTE_QUESTION], recipes: VOTE_RECIPES };
// recipe instances added to the library (their facts are generated on demand)
export const RECIPES = {};

// suites and variants added to library examples
export const SUITES = {
  'tutorial-weak-relevant': {
    variants: [{ name: 'reference', loop: { language: 'loop', text: 'REFERENCE' } }],
    suites: [{ name: 'scaling', instances: { constants: { n: [4, 5, 6, 7, 8] } }, variants: ['default', 'reference'], limits: { seconds: 30 } }],
  },
};

// ---------------------------------------------------------------------------
// Domain views, attached as a fragment `view` and a views entry.
// ---------------------------------------------------------------------------
const CLIQUE_VIEW = `% The graph; deleted nodes filled, the surviving triangle drawn as a clique.
#program scene.
draw(layout(graph)).
draw(node(V))   :- node(V).
draw(edge(U,V)) :- edge(U,V).

#program frame.
draw(attr(node(V), fill, deleted))        :- cand(del(V)).
draw(attr(node(V), fill, clique))         :- cex(q(V)).
draw(attr(edge(U,V), stroke, clique))     :- edge(U,V), cex(q(U)), cex(q(V)).
draw(emph(node(V)))                       :- lit(del(V), _).
draw(note("A triangle survives. One of its ringed nodes must be deleted.")) :- kind(reject).
draw(note("No triangle survives: a solution.")) :- kind(solution).
#show draw/1.
`;
const SUMFREE_VIEW = `% The numbers 1..n; picked numbers filled; the sum X + Y = Z of a counterexample ringed.
#program scene.
draw(layout(circle)).
draw(node(X)) :- num(X).

#program frame.
draw(attr(node(X), fill, picked)) :- cand(pick(X)).
draw(attr(node(X), stroke, sum)) :- cex(sum(X,_)).
draw(attr(node(Y), stroke, sum)) :- cex(sum(_,Y)).
draw(attr(node(X+Y), stroke, sum)) :- cex(sum(X,Y)).
draw(emph(node(X))) :- lit(pick(X), _).
draw(note("Picked numbers X, Y and X + Y: the ringed ones cannot all stay.")) :- kind(reject).
draw(note("No sum inside the picked set: a solution.")) :- kind(solution).
#show draw/1.
`;
export const VIEWS = {
  'guide-03-hit-clique': CLIQUE_VIEW,
  'guide-03-relevant-all': CLIQUE_VIEW,
  'guide-04-one-node': CLIQUE_VIEW.replace('triangle', 'clique').replace('No triangle', 'No clique').replace('A triangle', 'A clique'),
  'tutorial-first-run': SUMFREE_VIEW,
  'tutorial-weak-relevant': SUMFREE_VIEW,
  'clique-colouring': `% The graph; red nodes filled red, the others blue; a one-coloured maximal clique ringed.
#program scene.
draw(layout(circle)).
draw(node(V)) :- node(V).
draw(edge(U,V)) :- edge(U,V), U < V.

#program frame.
draw(attr(node(V), fill, red)) :- cand(red(V)).
draw(attr(node(V), fill, blue)) :- node(V), not cand(red(V)), kind(_).
draw(attr(edge(U,V), stroke, clique)) :- edge(U,V), U < V, cex(q(U)), cex(q(V)).
draw(emph(node(V))) :- lit(red(V), _).
draw(note("A maximal clique has one colour: recolour one of its ringed nodes.")) :- kind(reject).
#show draw/1.
`,
  'af-preferred': `% The argumentation framework; the candidate extension filled, a larger admissible set ringed.
#program scene.
draw(layout(graph)).
draw(node(A)) :- arg(A).
draw(edge(A,B)) :- att(A,B), A != B.
draw(attr(node(A), stroke, query)) :- query(A).

#program frame.
draw(attr(node(A), fill, in)) :- cand(in(A)).
draw(emph(node(A))) :- lit(in(A), _).
draw(note("A larger admissible set exists: the candidate is not preferred.")) :- kind(reject).
#show draw/1.
`,
  arrowing: `% K_n; red edges red, blue edges blue; the pattern of a counterexample thick.
#program scene.
draw(layout(circle)).
draw(node(V)) :- node(V).
draw(edge(U,V)) :- edge(U,V).

#program frame.
draw(attr(edge(U,V), stroke, red)) :- cand(red(U,V)).
draw(attr(edge(U,V), stroke, blue)) :- edge(U,V), not cand(red(U,V)), kind(_).
draw(attr(edge(U,V), weight, 12)) :- cex(used(U,V)).
draw(note("A one-coloured copy of a pattern (thick): one of its edges must change colour.")) :- kind(reject).
#show draw/1.
`,
  choosability: `% One row per node, one column per colour: the lists of the candidate; a colouring ringed.
#program scene.
draw(layout(grid)).
draw(cell(V,C)) :- node(V), colour(C).

#program frame.
draw(attr(cell(V,C), fill, list)) :- cand(list(V,C)).
draw(attr(cell(V,C), label, "x")) :- cex(col(V,C)).
draw(emph(cell(V,C))) :- lit(list(V,C), _).
draw(note("A proper colouring from the lists (x): one of its ringed colours must leave a list.")) :- kind(reject).
#show draw/1.
`,
  'voting-justification': `% Each profile is a block of columns: one column per voter, the ballot from top (1st) to bottom.
% Under the ballots: the target outcome (profile 1 only) and, at a step with a counterexample, the
% outcome of every profile in it (a filled letter wins) and the number of axiom instances its
% clause names. Under those: one row per axiom instance of the candidate, with its part in each
% profile it reads: Pareto "¬c" (c loses), faithfulness and unanimity "top", cancellation "all",
% Condorcet "c", neutrality "a↔b" in both profiles, positive responsiveness "a" and "a↑" (the
% profile where a moved up), reinforcement "+" for the two parts and "=" for their union.
#program scene.
draw(layout(grid)).
letter(1,"a"). letter(2,"b"). letter(3,"c"). letter(4,"d"). letter(5,"e"). letter(6,"f").
place(1,"1st"). place(2,"2nd"). place(3,"3rd"). place(4,"4th"). place(5,"5th"). place(6,"6th").
pname(1,"P1"). pname(2,"P2"). pname(3,"P3"). pname(4,"P4"). pname(5,"P5"). pname(6,"P6").
pname(7,"P7"). pname(8,"P8").
notl(1,"¬a"). notl(2,"¬b"). notl(3,"¬c"). notl(4,"¬d"). notl(5,"¬e"). notl(6,"¬f").
upl(1,"a↑"). upl(2,"b↑"). upl(3,"c↑"). upl(4,"d↑"). upl(5,"e↑"). upl(6,"f↑").
swapl(1,2,"a↔b"). swapl(1,3,"a↔c"). swapl(1,4,"a↔d"). swapl(2,3,"b↔c"). swapl(2,4,"b↔d"). swapl(3,4,"c↔d").
swapl(1,5,"a↔e"). swapl(2,5,"b↔e"). swapl(3,5,"c↔e"). swapl(4,5,"d↔e").
width(W) :- W = #max { num_voters; num_candidates }.
start(P,4+(P-1)*(W+1)) :- profile_num(P), width(W).
% rows: 1 profile names, 2.. the ballots, then the target, the outcomes, the clause, the instances
ballot_row(Pos,1+Pos) :- position(Pos).
target_row(num_candidates+3).
outcome_row(num_candidates+4).
clause_row(num_candidates+5).
first_inst_row(num_candidates+7).
inst_row(I,R+I-1) :- first_inst_row(R), I = 1..num_axiom_instances+2.
mid(P,S+(W-1)/2) :- start(P,S), width(W).

% the cells
cellpos(1,M) :- mid(_,M).
cellpos(R,S+V-1) :- ballot_row(_,R), start(_,S), voter(V).
cellpos(R,S+C-1) :- target_row(R), start(1,S), candidate(C).
cellpos(R,S+C-1) :- outcome_row(R), start(_,S), candidate(C).
cellpos(R,2) :- ballot_row(_,R).
cellpos(R,2) :- target_row(R).
cellpos(R,2) :- outcome_row(R).
cellpos(R,2) :- inst_row(_,R).
cellpos(R,2) :- clause_row(R).
cellpos(R,M) :- inst_row(_,R), mid(_,M).
cellpos(R,M) :- clause_row(R), mid(1,M).
draw(cell(R,C)) :- cellpos(R,C).

% fixed labels
draw(attr(cell(1,M), label, N)) :- mid(P,M), pname(P,N).
draw(attr(cell(R,2), label, L)) :- ballot_row(Pos,R), place(Pos,L).
draw(attr(cell(R,2), label, "target")) :- target_row(R).
draw(attr(cell(R,S+C-1), label, L)) :- target_row(R), start(1,S), letter(C,L), candidate(C).
draw(attr(cell(R,S+C-1), fill, target)) :- target_row(R), start(1,S), target_outcome(C).

#program frame.
% the profiles of the candidate
active(P) :- cand(profile(P,_,_,_)).
draw(attr(cell(R,S+V-1), label, L)) :- cand(profile(P,V,C,Pos)), ballot_row(Pos,R), start(P,S), letter(C,L).
draw(emph(cell(R,S+V-1))) :- lit(profile(P,V,C,Pos),_), ballot_row(Pos,R), start(P,S).
boxed(R,S+V-1) :- cand(profile(P,V,_,Pos)), ballot_row(Pos,R), start(P,S).
boxed(R,C) :- target_row(R), cellpos(R,C), C > 2.
draw(ghost(cell(1,M))) :- mid(P,M), not active(P).

% the outcomes of the counterexample
cex_step :- cex(outcome(_,_)).
boxed(R,S+C-1) :- cex_step, outcome_row(R), start(_,S), candidate(C).
draw(attr(cell(R,S+C-1), label, L)) :- cex_step, outcome_row(R), start(_,S), letter(C,L), candidate(C).
draw(attr(cell(R,S+C-1), fill, wins)) :- cex(outcome(P,C)), outcome_row(R), start(P,S).
draw(attr(cell(R,2), label, "outcome")) :- outcome_row(R), cex_step.

% the axiom instances of the candidate, one row each
inst((Pr,A)) :- cand(use_axiom_instance(Pr,A)).
order((Pr,A),N+1) :- inst((Pr,A)), N = #count { X : inst(X), X < (Pr,A) }.
name(pareto(C),"Pareto") :- candidate(C). name(faithfulness,"faithful"). name(unanimity,"unanimity").
name(cancellation,"cancel"). name(reinforcement,"reinforce"). name(condorcet(C),"Condorcet") :- candidate(C).
name(neutrality2(C1,C2),"neutrality") :- candidate(C1), candidate(C2).
name(pos_responsiveness(V,C,P),"pos. resp.") :- voter(V), candidate(C), position(P).
draw(attr(cell(R,2), label, L)) :- order((_,A),N), inst_row(N,R), name(A,L).
% its part in each profile it reads
part(single(P),pareto(C),P,L) :- inst((single(P),pareto(C))), notl(C,L).
part(single(P),faithfulness,P,"top") :- inst((single(P),faithfulness)).
part(single(P),unanimity,P,"top") :- inst((single(P),unanimity)).
part(single(P),cancellation,P,"all") :- inst((single(P),cancellation)).
part(single(P),condorcet(C),P,L) :- inst((single(P),condorcet(C))), letter(C,L).
part(double(P,Q),neutrality2(C1,C2),X,L) :- inst((double(P,Q),neutrality2(C1,C2))),
    X = (P;Q), swapl(C1,C2,L).
part(double(P,Q),pos_responsiveness(V,C,K),P,L) :- inst((double(P,Q),pos_responsiveness(V,C,K))), letter(C,L).
part(double(P,Q),pos_responsiveness(V,C,K),Q,L) :- inst((double(P,Q),pos_responsiveness(V,C,K))), upl(C,L).
part(triple(P,Q,T),reinforcement,X,"+") :- inst((triple(P,Q,T),reinforcement)), X = (P;Q), P != Q.
part(triple(P,P,T),reinforcement,P,"2x") :- inst((triple(P,P,T),reinforcement)).
part(triple(P,Q,T),reinforcement,T,"=") :- inst((triple(P,Q,T),reinforcement)).
draw(attr(cell(R,M), label, L)) :- part(Pr,A,P,L), order((Pr,A),N), inst_row(N,R), mid(P,M).
boxed(R,M) :- part(Pr,A,P,_), order((Pr,A),N), inst_row(N,R), mid(P,M).
draw(emph(cell(R,M))) :- part(Pr,A,P,_), lit(use_axiom_instance(Pr,A),_), order((Pr,A),N), inst_row(N,R), mid(P,M).

% the clause: how many axiom-instance atoms it names
clause_size(N) :- N = #count { Pr,A : lit(use_axiom_instance(Pr,A),_) }, cex_step.
draw(attr(cell(R,2), label, "clause")) :- clause_row(R), cex_step.
draw(attr(cell(R,M), label, N)) :- clause_size(N), clause_row(R), mid(1,M).

% only boxed cells have an outline
draw(attr(cell(R,C), weight, 0)) :- cellpos(R,C), not boxed(R,C).

draw(note("A justification: the profiles (P1 is the target) and the axiom instances that force the target outcome.")) :- kind(solution).
draw(note("Counterexample: outcomes (filled letters win) that satisfy every instance listed but differ from the target in P1.")) :- cex_step.
draw(note("Clause: the number of axiom instances the refinement names; outlined thick: the profile and instance atoms it names.")) :- cex_step.
#show draw/1.
`,
  qbf: `% The x-variables; true ones filled; the variables a clause names ringed.
#program scene.
draw(layout(list)).
draw(node(x(I))) :- xvar(I).

#program frame.
draw(attr(node(x(I)), fill, true)) :- cand(x(I)).
draw(emph(node(x(I)))) :- lit(x(I), _).
draw(note("A y-assignment falsifies every term: flip one of the ringed x-variables.")) :- kind(reject).
#show draw/1.
`,
};

// ---------------------------------------------------------------------------
// Project cards (FUTURE-DIRECTIONS E3): a short readme with a research question and baseline
// numbers for examples that make good student projects. The full kit is voting-justification
// (tools/make-examples.mjs, VOTE_README). Each gets the library tag "project".
// Baselines: node tools/run.mjs <id> --seconds 60 (one machine, Nov 2026).
// ---------------------------------------------------------------------------
const card = (title, question, baseline, ideas, measure) => `# Project: ${title}

## Research question

${question}

## Baseline

${baseline}

## Things to try

${ideas.map((x) => `- ${x}`).join('\n')}

## How to measure

${measure}
`;
const CAMPAIGN = 'Add the variants, write a suite over the instances (Campaign tab, Advanced mode), and read the instance × variant matrix; headless: `node tools/bench.mjs <id> --suite NAME --out rows.jsonl` and `node tools/report.mjs rows.jsonl`. Check every variant against the `reference` loop (or the audit) on small instances before trusting its numbers.';
export const PROJECT_CARDS = {
  'sudoku-unavoidable': card('minimal Sudoku puzzles by unavoidable sets',
    'How much do stronger refinements (unavoidable sets, several per check) and symmetry cut the candidates of a "fewest clues" search on 9 × 9 Sudoku?',
    'The default instance with k = 22 finds its first puzzle after 1,684 candidates and 2,325 clauses (17 s). `sudoku-unique` is the weaker baseline: one clause per counterexample.',
    ['Ask the check for several unavoidable sets per candidate and compare the clause counts (Statistics tab, Lifting coach).',
      'Lift a clause over the symmetries of the grid (digit permutations, row and column swaps within a band); compare with `sudoku-symmetry`.',
      'Grow k downwards: at which k does the time explode, and why?'],
    CAMPAIGN),
  'fewest-clues': card('fewest clues on 4 × 4 Sudoku',
    'The fewest clues problem is Σ2P-complete. How does the number of candidates grow with the number of clues to add (k) and with the number of printed clues?',
    '64 solutions (exhausted) after 353 candidates and 289 clauses, 0.5 s, at k = 2 on the example instance.',
    ['A suite over k (a constants grid) and over the instances; fit the growth factor per step of k.',
      'A refinement that names the whole unavoidable set (as in `sudoku-unavoidable`) instead of one clue.',
      'Write a generator of partly filled grids and look for the hardest ones (Fuzz, mining).'],
    CAMPAIGN),
  'conformant-planning': card('conformant planning: expansion against clauses',
    'When does expansion (a copy of the robot per counterexample, Shape 3) beat clause refinement, and how many counterexamples does a plan need?',
    '3 plans (exhausted) after 11 candidates and 8 counterexamples (0.2 s) at t = 8. The reference run would remove up to 65,536 plans one by one. `conformant-growing` finds the horizon by itself: 27 candidates.',
    ['A variant with a clause refinement (blocking the plan prefix that fails) and a campaign against the expansion loop.',
      'Larger grids (a generator of mazes) and longer horizons: how does the number of copies grow?',
      'Compare with `conformant-growing`: is growing the horizon cheaper than guessing it?'],
    CAMPAIGN),
  'conformant-growing': card('growing the horizon',
    'Is it cheaper to grow the horizon one step at a time (and keep what was learned) than to solve each horizon from scratch?',
    '3 shortest plans (exhausted) after 27 candidates and 24 counterexamples (0.4 s).',
    ['A variant that restarts at each horizon (no learned clauses kept) and a campaign over the instances.',
      'Grow the horizon by two steps, or by doubling, and compare candidates and time.',
      'Bigger mazes: where does the time go (Observatory, cost per line)?'],
    CAMPAIGN),
  'af-preferred': card('argumentation: preferred extensions',
    'How does a CEGAR loop for sceptical acceptance under preferred semantics compare with dedicated solvers (for example the ICCMA competitors), and which refinement scales best on random frameworks?',
    '3 solutions (exhausted) after 13 candidates and 13 clauses (0.06 s) on the example framework; the generator `af-gnp` draws more.',
    ['A suite over the generator grid (n, p) with seeds; fit the growth with n.',
      'Refine with one clause per larger admissible set against `G.clause` over relevant/1; compare clause lengths.',
      'Export frameworks (Export for clingo) and time a dedicated solver on the same instances.'],
    CAMPAIGN),
  'af-semi-stable': card('argumentation: semi-stable extensions',
    'Semi-stable extensions maximise the range. Does an interface of derived atoms (`range/1`) give stronger refinements than one of guessed atoms (`in/1`), and by how much?',
    '2 solutions (exhausted) after 7 candidates and 5 clauses (0.06 s) on the example.',
    ['A variant whose interface is `in/1` and a campaign on generated frameworks (copy the `af-gnp` generator from `af-preferred`).',
      'Stage extensions: change the check and compare the loops.',
      'Count the candidates per instance size and fit the growth.'],
    CAMPAIGN),
  'strategic-companies': card('strategic companies',
    'Strategic companies is a classic Σ2P benchmark of ASP competitions. How does the CEGAR loop scale against the disjunctive encoding solved by clingo alone?',
    '2 solutions (exhausted) after 10 candidates and 8 clauses (0.06 s) on the example.',
    ['Write a generator of random company structures (goods, producers, control) and a suite over its size.',
      'Write the disjunctive encoding as the `reference` variant (or run it with Export for clingo) and compare the times.',
      'Try one clause per smaller closed set against a clause over all companies.'],
    CAMPAIGN),
  nash: card('Nash equilibria of colouring games',
    'How does the number of candidates depend on the number of players and edge weights, and does a refinement over the deviating player only pay?',
    'All solutions on the instances: n2-w1 12, n2-w2 24, n2 36, n3-w1 576 (n3-w1: 1,780 candidates, 1,204 clauses). The project as written (n = 5, w = 3, instance "as written") stops at its first candidate, which is already a solution.',
    ['A suite over the four instances and the variants reference, shape2 and wide; read the matrix by candidates.',
      'A refinement that names only the deviating player\'s colour and its neighbours (the opposite of the variant wide).',
      'Compare with `strong-nash`, which checks coalitions instead of single players.'],
    CAMPAIGN),
  'strong-nash': card('strong Nash equilibria',
    'Deciding whether a strong Nash equilibrium exists is Σ2P-complete. Which refinement (the coalition, its members\' actions, the neighbourhood) cuts the most candidates?',
    '1 solution (exhausted) after 70 candidates and 69 clauses (0.1 s) on the example.',
    ['Variants with the three refinements and a campaign over the instances.',
      'A generator of random graphical games and a scaling plot.',
      'A loop with two checks: Nash first (cheap), then coalitions (see `lang-two-stage`).'],
    CAMPAIGN),
  'benders-tardiness': card('logic-based Benders decomposition',
    'How much do stronger optimality cuts (and feasibility cuts) shrink the number of master iterations, and when do the bounds meet?',
    'The optimum after 26 master solutions and 26 cuts (1.1 s) on the example; the bounds are tracked in the Statistics tab.',
    ['A variant with a weaker cut (only the machine\'s exact assignment) and a campaign over the instances.',
      'Stop as soon as the lower bound reaches the upper bound (an `if` on the tracked numbers).',
      'Larger instances from a generator of jobs and machines; plot the bounds against the iterations.'],
    CAMPAIGN),
};

// ---------------------------------------------------------------------------
// Levels and a learning path (FUTURE-DIRECTIONS F2). level: 1 first steps (read with guide
// chapters 1-4), 2 the basics of design (5-8), 3 the larger language and harder problems (9-12),
// 4 loops from the literature and research projects (Part II). after: the guide chapter to read
// first (null: none). Guide examples take both from their chapter; a contrib file may set
// library.level and library.after itself.
// ---------------------------------------------------------------------------
export const LEVELS = {
  starter: [1, null], 'tutorial-first-run': [1, null], 'tutorial-weak-relevant': [1, 4],
  'lang-basics': [1, 2], 'lang-legacy': [2, 2], 'lang-clauses': [2, 6], 'lang-several-cex': [2, 6], 'lang-optimal': [2, 6],
  'lang-second-solver': [3, 6], 'lang-two-stage': [3, 10], 'lang-core': [3, 10], 'lang-raw-lua': [4, 12],
  'gc-shape1': [2, 8], 'gc-shape2': [2, 8], 'gc-shape3': [2, 8], 'gc-shape4': [2, 8], 'gc-reference': [2, 8],
  'exercise-sum-free': [1, 4], 'exercise-triangles': [1, 3],
  qbf: [2, 3], 'stable-models': [2, 3], 'strategic-companies': [2, 3], 'qbf-blame-solver': [3, 6], 'qbf-optimal': [3, 11],
  'cegis-circuit': [3, 9], 'integer-expressions': [3, 9], 'min-dnf': [3, 9],
  'qbf-expansion': [4, 13], 'qbf-deep': [4, 13], 'qbf-three-blocks': [4, 13],
  'maxsat-ihs': [4, 14], 'maxsat-oll': [4, 14], 'smallest-mus': [4, 14], marco: [4, 15],
  abduction: [2, 3], diagnosis: [2, 3], 'af-preferred': [2, 3], 'af-semi-stable': [2, 7], 'sufficient-reason': [2, 6],
  'actual-cause': [3, 7], 'belief-update': [3, 7], 'default-extensions': [3, 7], 'abduction-two-checks': [3, 10],
  'minimal-reasons': [3, 10], 'reasons-by-size': [3, 11], 'reasons-by-shrinking': [4, 15],
  'graph-coloring': [2, 5], 'clique-interdiction': [2, 5], arrowing: [2, 3], choosability: [2, 3], 'clique-colouring': [2, 3],
  'colourable-partial': [4, 10], 'triangle-free-lazy': [4, 10],
  nash: [2, 3], 'strong-nash': [2, 3], 'subset-sum-game': [2, 3], 'fair-division': [2, 9], 'boolean-game': [3, 6],
  'agenda-safety': [3, 7], 'hedonic-core': [3, 7], 'kemeny-control': [3, 7], 'voting-justification': [3, 12], 'voting-justification-ihs': [4, 14],
  'conformant-planning': [3, 9], 'conformant-growing': [3, 9], 'knapsack-interdiction': [3, 11], 'knapsack-optimum': [3, 11],
  'benders-tardiness': [4, 11], 'knapsack-bounds': [4, 11], 'knapsack-fortification': [4, 13],
  'sudoku-unique': [3, 3], 'sudoku-unavoidable': [3, 6], 'fewest-clues': [3, 7], 'sudoku-symmetry': [3, 7], 'sudoku-graded': [3, 7],
  'sudoku-hard': [3, 7], akari: [3, 7], binairo: [3, 7], futoshiki: [3, 7], slitherlink: [3, 7], 'queens-omission': [4, 12],
};
export const LEVEL_NAMES = { 1: 'first steps', 2: 'basics', 3: 'advanced', 4: 'literature and research' };
export function levelOf(e) {
  const m = /^guide-(\d\d)-/.exec(e.id);
  if (m) { const n = Number(m[1]); return { level: n <= 4 ? 1 : n <= 8 ? 2 : n <= 12 ? 3 : 4, after: n }; }
  const own = { level: e.level ?? null, after: e.after ?? null };
  const t = LEVELS[e.id];
  return { level: own.level ?? (t ? t[0] : 3), after: own.after !== null ? own.after : t ? t[1] : 12 };
}

// ---------------------------------------------------------------------------
// Instances and variants of the built-in examples (language, shapes, graph-coloring, nash).
// Their input is a size constant, so the instances are constants-only and there is no
// generator. Every variant gives each instance's expected count (checked by
// test/instances.test.mjs); `reference` is the blocking loop of the same solvers.
// ---------------------------------------------------------------------------
const sizes = (name, list) => list.map(([v, solutions, more = {}]) => ({ id: `${name}${v}`, facts: '', constants: { [name]: String(v) }, expected: { solutions }, tags: [], ...more }));
const loopVariant = (name, text) => ({ name, swap: {}, constants: {}, loop: { language: 'loop', text } });
const toBlock = (text) => text.replace(/G(\d?)\.clause\(M, [XY]\)/g, 'G$1.block(M)');
const SUMFREE_SIZES = sizes('n', [[8, 61], [6, 24], [10, 151], [12, 369]]);
const GC_SIZES = sizes('n', [[5, 101], [3, 0], [4, 1]]);
const GC_SHAPES = ['shape1', 'shape2', 'shape3', 'shape4', 'reference'];
const plain = (t) => t.replace(/ +options "--heuristic=Domain"/, '');

// id -> (project, built projects by id) => { instances, variants, fragments, settings }
export const EXTRAS = {
  'lang-basics': (p) => ({ instances: SUMFREE_SIZES, variants: [loopVariant('reference', plain(template('reference'))), loopVariant('shape1', plain(template('shape1')))] }),
  'lang-several-cex': (p) => ({ instances: SUMFREE_SIZES, variants: [loopVariant('reference', plain(template('reference'))),
    loopVariant('limit-1', p.loop.text.replace('limit 3', 'limit 1')), loopVariant('limit-10', p.loop.text.replace('limit 3', 'limit 10'))] }),
  'lang-optimal': (p) => ({ instances: SUMFREE_SIZES, variants: [loopVariant('reference', plain(template('reference'))),
    loopVariant('any-counterexample', p.loop.text.replace('C.solve(assume G(M), optimal)', 'C.solve(assume G(M))'))] }),
  'lang-two-stage': (p) => ({ instances: sizes('n', [[8, 38], [6, 17], [10, 86], [12, 195]]), variants: [loopVariant('reference', toBlock(p.loop.text)),
    loopVariant('neighbours-first', `solver A  = shared + abstraction
solver C1 = shared + sums
solver C2 = shared + neighbours
link   G1 = A -> C1 via shared + glue
link   G2 = A -> C2 via shared + glue

# The same two checks in the other order: neighbours first, then sums.
search A:
    on candidate M:
        Y = C2.solve(assume G2(M))
        if Y:
            reject M with G2.clause(M, Y)
        else:
            X = C1.solve(assume G1(M))
            if X: reject M with G1.clause(M, X)
`)] }),
  'lang-clauses': (p) => ({ instances: SUMFREE_SIZES, variants: [loopVariant('reference', plain(template('reference'))),
    loopVariant('shape2', `solver A = shared + abstraction
solver C = shared + check
link   G = A -> C via shared + glue

# The same refinement in a Shape 2 loop: A is solved again after each clause.
loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clauses(X))
    else:
        accept M
        A.add(G.block(M))
`)] }),
  'lang-core': (p) => ({ instances: sizes('n', [[5, 958], [4, 63], [6, 27554]]), variants: [
    loopVariant('reference', p.loop.text.replace(/\n# For comparison[\s\S]*$/, '\n').replace('reject M with G.core(C)', 'reject M with G.block(M)')),
    loopVariant('minimal-core', p.loop.text.replace(/\n# For comparison[\s\S]*$/, '\n').replace('reject M with G.core(C)', 'reject M with C.core.minimal.on(G)'))] }),
  // n5: the audit (one solve of R per pair) needs over a minute
  'lang-second-solver': (p, built) => ({ instances: GC_SIZES.map((x) => x.id === 'n5' ? { ...x, audit: false } : x),
    fragments: [{ name: 'check_relevant', description: 'The check with its relevant/1 rules (as in graph-coloring), for the one-solver variants.', text: built['graph-coloring'].fragments.find((f) => f.name === 'check').text }],
    variants: [{ ...loopVariant('reference', template('reference')), swap: { check: 'check_relevant' } }, { ...loopVariant('shape1', template('shape1')), swap: { check: 'check_relevant' } }] }),
  'lang-legacy': (p) => ({ instances: SUMFREE_SIZES, variants: [loopVariant('reference', toBlock(p.loop.text)),
    loopVariant('shape2', `solver A = shared + abstraction
solver C = shared + check
link   G = A -> C via shared + glue legacy

loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        A.add(G.block(M))
`)] }),
  'lang-raw-lua': (p) => ({ instances: SUMFREE_SIZES, variants: [loopVariant('reference', plain(template('reference'))), loopVariant('loop-language', plain(template('shape1')))] }),
  ...Object.fromEntries(['gc-shape1', 'gc-shape2', 'gc-shape3', 'gc-shape4', 'gc-reference'].map((id) => [id, () => ({ instances: GC_SIZES,
    variants: GC_SHAPES.filter((s) => `gc-${s}` !== id).map((s) => loopVariant(s, template(s))) })])),
  // The exercises are deliberately unfinished encodings, so a finished variant would give the
  // answer away; the sum-free exercise gets the blocking loop (its default loop is broken on
  // purpose), the triangle exercise already is the blocking loop.
  'exercise-sum-free': (p) => ({ variants: [loopVariant('reference', toBlock(p.loop.text))] }),
  'graph-coloring': (p) => ({ instances: [...sizes('n', [[3, 0]]), ...p.instances.map((x) => x.id === 'n6' ? { ...x, audit: false } : x)],  // n6: the audit needs over 90 s
    variants: ['reference', 'shape2', 'shape4'].map((s) => loopVariant(s, template(s))) }),
};

// ---------------------------------------------------------------------------
// Spaces (PLAN3 phase S7): every instance up to a bound, for
// the bounded verification of an example's refinement strategy. Shared texts are written once.
// Each space's `expected` is the verdict and k measured with `node tools/audit.mjs <id> --space
// NAME --bound K` (the largest K whose last step finishes within 60 s, capped for the tests).
// ---------------------------------------------------------------------------
export const SPACE_TEXTS = {
  // graphs on the nodes 1..size, edges in both directions
  graphs: '% every graph on the nodes 1..size (edges listed in both directions)\nnode(1..size).\n{ edge(U,V) : node(U), node(V), U < V }.\nedge(V,U) :- edge(U,V), U < V.\n',
  // argumentation frameworks with arguments 1..size
  af: '% every argumentation framework with the arguments 1..size (self-attacks included)\narg(1..size).\n{ att(X,Y) : arg(X), arg(Y) }.\n',
  // exists-forall formulas in DNF: size x-variables, size y-variables, size terms
  qbf: '% every DNF matrix with size terms over size x-variables and size y-variables\nxvar(1..size).  yvar(1..size).  tid(1..size).\n{ xlit(T,I,S) : tid(T), xvar(I), S = 0..1 }.\n{ ylit(T,J,S) : tid(T), yvar(J), S = 0..1 }.\n',
  // CNF formulas with clauses 1..size over the variables 1..size, no clause empty
  cnf: '% every CNF with the clauses 1..size over the variables 1..size; no clause is empty\ncid(1..size).  vid(1..size).\n{ pos(C,V) : cid(C), vid(V) }.\n{ neg(C,V) : cid(C), vid(V) }.\n:- cid(C), not pos(C,_), not neg(C,_).\n',
};
// networks of two units (weights -1..1, thresholds 0..2, votes 2) over the features 1..size,
// and every input
const REASON_SPACE = '% every network of two units over the features 1..size, and every input\nfeature(1..size).  unit(1..2).\n' +
  '1 { weight(U,F,W) : W = -1..1 } 1 :- unit(U), feature(F).\n1 { threshold(U,T) : T = 0..2 } 1 :- unit(U).\nvote(U,2) :- unit(U).\n1 { is(F,0..1) } 1 :- feature(F).\n';
const space = (name, text, description, expected, extra = {}) => ({ name, description, text, params: { size: 'int' }, ...extra, expected });
const constantsSpace = (param, k, description, defaults) => ({ name: param, description, text: '',
  params: { [param]: 'int', ...Object.fromEntries(Object.keys(defaults || {}).map((x) => [x, 'int'])) }, bound: param,
  ...(defaults ? { defaults } : {}), expected: { verdict: 'sound', k } });

// example id -> its spaces
export const SPACES = {
  'tutorial-first-run': [constantsSpace('n', 10, 'The numbers 1..n for n = 1, 2, ...: the constants family of the example.')],
  'tutorial-weak-relevant': [{ ...constantsSpace('n', 2, 'The numbers 1..n for n = 1, 2, ...: the too-weak relevant/1 first loses a solution at n = 2.'), expected: { verdict: 'unsound', k: 2 } }],
  'lang-basics': [constantsSpace('n', 12, 'The numbers 1..n for n = 1, 2, ...')],
  'lang-several-cex': [constantsSpace('n', 12, 'The numbers 1..n for n = 1, 2, ...')],
  'lang-optimal': [constantsSpace('n', 12, 'The numbers 1..n for n = 1, 2, ...')],
  'lang-clauses': [constantsSpace('n', 12, 'The numbers 1..n for n = 1, 2, ...')],
  'lang-legacy': [constantsSpace('n', 12, 'The numbers 1..n for n = 1, 2, ...')],
  'graph-coloring': [constantsSpace('n', 12, 'The example\'s graph family for n = 1, 2, ...')],
  'gc-shape1': [constantsSpace('n', 12, 'The example\'s graph family for n = 1, 2, ...')],
  'gc-shape2': [constantsSpace('n', 12, 'The example\'s graph family for n = 1, 2, ...')],
  'lang-second-solver': [constantsSpace('n', 12, 'The example\'s graph family for n = 1, 2, ... (the refinement computed by the second solver)')],
  'qbf-blame-solver': [space('formulas', SPACE_TEXTS.qbf, 'Every exists-forall DNF with size terms over size x- and size y-variables.', { verdict: 'sound', k: 12 })],
  'akari': [constantsSpace('n', 8, 'Grids of n x n cells for n = 1, 2, ..., with 2 black cells and 2 numbers.', { blacks: 2, k: 2 })],
  'slitherlink': [constantsSpace('n', 5, 'Grids of n x n cells for n = 1, 2, ..., loops of length 8, 3 clues.', { k: 3, len: 8 })],
  'sudoku-unique': [constantsSpace('k', 8, 'Puzzles with k = 1, 2, ... clues on a 9 x 9 grid.')],
  'min-dnf': [constantsSpace('n', 8, 'Boolean functions on n = 1, 2, ... variables, at most k terms.', { k: 3 })],
  'triangle-free-lazy': [{ ...constantsSpace('n', 12, 'Graphs on n = 2, 3, ... nodes with at least m edges (n = 1 has no node pair, so no interface).', { m: 6 }), from: 2 }],
  'clique-interdiction': [constantsSpace('n', 12, 'The circulant graphs on n = 1, 2, ... nodes; k deletions, cliques of c nodes.', { k: 4, c: 3 })],
  'nash': [constantsSpace('n', 3, 'Games with n = 1, 2, ... players, weights up to w.', { w: 1 })],
  'af-preferred': [space('frameworks', SPACE_TEXTS.af + '1 { query(X) : arg(X) } 1.\n', 'Every argumentation framework with size arguments and one query argument.', { verdict: 'sound', k: 12 })],
  'af-semi-stable': [space('frameworks', SPACE_TEXTS.af, 'Every argumentation framework with size arguments.', { verdict: 'sound', k: 12 })],
  'clique-colouring': [space('graphs', SPACE_TEXTS.graphs, 'Every graph on size nodes.', { verdict: 'sound', k: 12 })],
  'choosability': [space('graphs', SPACE_TEXTS.graphs, 'Every graph on size nodes, lists of 2 out of p colours.', { verdict: 'sound', k: 12 }, { params: { size: 'int', p: 'int' }, bound: 'size', defaults: { p: 3 } })],
  'qbf': [space('formulas', SPACE_TEXTS.qbf, 'Every exists-forall DNF with size terms over size x- and size y-variables.', { verdict: 'sound', k: 12 })],
  'qbf-optimal': [space('formulas', SPACE_TEXTS.qbf, 'Every exists-forall DNF with size terms over size x- and size y-variables.', { verdict: 'sound', k: 12 })],
  'smallest-mus': [space('formulas', SPACE_TEXTS.cnf, 'Every CNF with size non-empty clauses over size variables; MUSes of at most k clauses.', { verdict: 'sound', k: 12 }, { params: { size: 'int', k: 'int' }, bound: 'size', defaults: { k: 2 } })],
  'stable-models': [space('programs', '% every normal or disjunctive program with the rules 1..size over the atoms 1..size\nrl(1..size).  at(1..size).\n{ head(R,A) : rl(R), at(A) }.\n{ pos(R,A) : rl(R), at(A) }.\n{ neg(R,A) : rl(R), at(A) }.\n:- at(A), not head(_,A), not pos(_,A), not neg(_,A).\n', 'Every program with size rules over size atoms (each atom occurs).', { verdict: 'sound', k: 12 })],
  'belief-update': [space('theories', '% every old theory (clause 1), new theory (clause 2) and query (clause 3) over the atoms 1..size\natom(1..size).  old(1).  new(2).  query(3).\n{ pos(C,A) : C = 1..3, atom(A) }.\n{ neg(C,A) : C = 1..3, atom(A) }.\n', 'One old clause, one new clause and a query clause over size atoms.', { verdict: 'sound', k: 12 })],
  'default-extensions': [space('theories', '% every default theory: one hard clause, the defaults d(1..size), clauses over the atoms 1..size\nhard(h).  default(d(1..size)).  at(1..size).\ncl(h).  cl(D) :- default(D).\n{ pos(C,A) : cl(C), at(A) }.\n{ neg(C,A) : cl(C), at(A) }.\n{ query(A) : at(A) } 1.\n', 'A hard clause and size defaults over size atoms, with at most one query atom.', { verdict: 'sound', k: 12 })],
  'abduction': [space('theories', '% every theory: clauses 1..size over the hypotheses h(1..size) and manifestations e(1..size)\nhypothesis(h(1..size)).  manifestation(e(1..size)).\nat(A) :- hypothesis(A).  at(A) :- manifestation(A).\ncid(1..size).\n{ pos(C,A) : cid(C), at(A) }.\n{ neg(C,A) : cid(C), at(A) }.\n', 'Theories with size clauses over size hypotheses and size manifestations.', { verdict: 'sound', k: 12 })],
  'strategic-companies': [space('holdings', '% every holding: companies and goods 1..size, who makes what, one controlling group per company\ncompany(1..size).  good(1..size).\n{ makes(C,G) : company(C), good(G) }.\n:- good(G), not makes(_,G).\n{ owner(T,1,O) : company(T), company(O), T != O }.\n{ query(C) : company(C) } 1.\n', 'Every holding with size companies and size goods.', { verdict: 'sound', k: 12 })],
  'boolean-game': [space('games', '% every two-player game over the variables 1..size: who controls what, one goal clause each\nplayer(1..2).  var(1..size).\n1 { controls(P,V) : player(P) } 1 :- var(V).\ngoal(P,P) :- player(P).\n{ pos(C,V) : player(C), var(V) }.\n{ neg(C,V) : player(C), var(V) }.\n', 'Two players, size variables, one goal clause per player.', { verdict: 'sound', k: 12 })],
  'agenda-safety': [space('agendas', '% every agenda of size formulas (one clause each) over the variables 1 and 2\nfid(1..size).  cl(F,F) :- fid(F).  var(1..2).\n{ pos(C,V) : fid(C), var(V) }.\n{ neg(C,V) : fid(C), var(V) }.\n', 'Agendas of size one-clause formulas over two variables.', { verdict: 'sound', k: 12 })],
  'hedonic-core': [space('games', '% every additive hedonic game with the agents 1..size and values -1..1\nagent(1..size).\n1 { value(I,J,V) : V = -1..1 } 1 :- agent(I), agent(J), I != J.\n', 'Additive hedonic games with size agents and values -1, 0, 1 (from 2 agents: one agent has no pair).', { verdict: 'sound', k: 5 }, { from: 2 })],
  'strong-nash': [space('games', '% every coordination game: players 1..size, two actions, weights 0 or 1, bonuses 0 or 1\nplayer(1..size).  action(1..2).\n{ w(P,Q,1) : player(P), player(Q), P != Q }.\n1 { bonus(P,A,B) : B = 0..1 } 1 :- player(P), action(A).\n', 'Coordination games with size players and two actions.', { verdict: 'sound', k: 5 })],
  'knapsack-interdiction': [space('items', '% every item list: items 1..size with cost 1..2, weight 1..3 and profit 1..3\niid(1..size).\n1 { item(I,C,W,P) : C = 1..2, W = 1..3, P = 1..3 } 1 :- iid(I).\n', 'Size items with small costs, weights and profits.', { verdict: 'sound', k: 12 },
    { params: { size: 'int', budget: 'int', capacity: 'int', bound: 'int' }, bound: 'size', defaults: { budget: 2, capacity: 4, bound: 4 } })],
  'robust-facilities': [space('maps', '% every map: sites 1..size with opening cost 1..2, customers 1..size near some sites\nsid(1..size).  uid(1..size).\n1 { site(S,C) : C = 1..2 } 1 :- sid(S).\n{ near(U,S) : uid(U), sid(S) }.\n', 'Size sites and size customers.', { verdict: 'sound', k: 12 })],
  'sufficient-reason': [space('networks', REASON_SPACE, 'Networks of two units over size features, and every input.', { verdict: 'sound', k: 12 })],
  'reasons-by-size': [space('networks', REASON_SPACE, 'Networks of two units over size features, and every input.', { verdict: 'sound', k: 12 })],
  'reasons-by-shrinking': [space('networks', REASON_SPACE, 'Networks of two units over size features, and every input.', { verdict: 'sound', k: 12 })],
};

// The symbolic audit's verdict per library instance where it is not 'sound' (null: no verdict
// within 60 s, the field is left out). Every other instance of a clause-based example is sound.
// Measured with a seed sweep (PROGRESS.md, phase S6; the script is in the git history).
export const SYMBOLIC = {
  'exercise-sum-free': { n4: 'unsound', n5: 'unsound', n6: 'unsound', n7: 'unsound', n8: 'unsound' },   // broken on purpose
  'slitherlink': { example: null },
  'sudoku-graded': { example: null },
  'sudoku-unavoidable': { example: null, 'one-clue-missing': null },
  'voting-justification': { 'cancel-reinf-posresp-k4': null, 'random-1': null, 'paper-ex4-k3-p4': null, 'paper-borda4-k3-p4': null,
    'paper-c4-v2-k3-p3': null, 'paper-c4-v3-k3-p3': null },
};
