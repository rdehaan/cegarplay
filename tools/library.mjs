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
  { id: 'problems', title: 'Problems', description: 'Larger problems from declarative-cegar.' },
  { id: 'exists-forall', title: 'Contributed: exists-forall problems', description: 'One abstraction and one check solver each, in the loop language.' },
  { id: 'several-solvers', title: 'Contributed: several solvers or raw Lua', description: 'More than one check, a solver that computes the refinement, staged searches, or raw Lua.' },
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

// Problems group: the three examples built from declarative-cegar.
export const PROBLEMS = [
  { id: 'graph-coloring', summary: 'Graphs with a leaf colouring that no 3-colouring extends (n = 6, all 10,698 solutions).', shape: 'shape1', tags: [], expected: 10698 },
  { id: 'nash', summary: 'Weighted graphs whose colouring game has a Nash equilibrium (four size instances).', shape: 'shape1', tags: [], expected: null },
  { id: 'voting-justification', summary: 'Explaining a voting outcome by axioms: 17 questions as instances, from one axiom to five, one with no justification.', shape: 'shape1', tags: [], expected: null },
];

// ---------------------------------------------------------------------------
// Starter generators (docs/spec-instances.md section 4), attached to the examples they fit by
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

// example id -> its generators
export const GENERATORS = {
  'clique-colouring': [gnp(true), gnm(true)],
  arrowing: [gnp(), gnm()],
  choosability: [gnp(), gnm()],
  'af-preferred': [afGnp(true)],
  'af-semi-stable': [afGnp(false)],
  qbf: [QBF_DNF],
  'kemeny-control': [BALLOTS_IC, BALLOTS_MALLOWS],
};
// recipe instances added to the library (their facts are generated on demand)
export const RECIPES = {
  qbf: [{ id: 'dnf-1', recipe: { generator: 'qbf-dnf', params: { nx: 5, ny: 4, t: 10 }, seed: 1 }, tags: ['generated'] }],
};

// suites and variants added to library examples (docs/spec-instances.md section 5)
export const SUITES = {
  'tutorial-weak-relevant': {
    variants: [{ name: 'reference', loop: { language: 'loop', text: 'REFERENCE' } }],
    suites: [{ name: 'scaling', instances: { constants: { n: [4, 5, 6, 7, 8] } }, variants: ['default', 'reference'], limits: { seconds: 30 } }],
  },
  qbf: {
    suites: [{ name: 'random', instances: { generator: 'qbf-dnf', grid: { t: [6, 8, 10, 12] }, seeds: 5 }, limits: { seconds: 30 } }],
  },
};

// ---------------------------------------------------------------------------
// Domain views (docs/spec-views.md), attached as a fragment `view` and a views entry.
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
