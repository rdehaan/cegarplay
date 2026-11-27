// Loop exercises: two loops built from scratch, each in two parts (implicit hitting sets and
// counterexample-guided synthesis). Unlike the two refinement exercises in tools/library.mjs, these
// are not edits of an existing example: the starters leave the abstraction, the glue, the check
// and the loop to the reader, and the readme guides them step by step. Part 2 of each loop
// starts from the worked solution of part 1. Used by tools/make-examples.mjs; the worked solutions
// of part 2 are in test/exercise.test.mjs.
import { SEATING, VOTING } from './exercise-data.mjs';

const DECL = `solver A = shared + abstraction
solver C = shared + check
link   G = A -> C via shared + glue
`;
const settings = (instance, seconds, candidates) => ({ constants: {}, solutions: 0, seconds, candidates, trace: 200, seed: 0, instance });
const frag = (name, text, description) => ({ name, text, description });

// ---- implicit hitting sets: seating rivals ------------------------------------------------
const SEAT_SHARED = `% The instance (Instances tab) gives:
%   guest(G,C)   guest G; uninviting G costs C
%   rival(A,B)   A and B must not sit at the same table
% There are two tables, 1 and 2. Rules that every solver needs go here (you may need none).
`;
const SEAT_DESC = {
  shared: 'Added to every solver.',
  abstraction: 'Solver A, the hitting-set solver: which guests to uninvite.',
  glue: 'The interface atoms: every glue(T) makes T an interface atom.',
  check: 'Solver C: seat the guests who are still invited, rivals apart.',
};
const seatInstance = (id) => ({ id, facts: SEATING[id].facts, constants: {}, expected: { solutions: null, optimum: SEATING[id].optimum }, tags: [] });

export const SEATING_SOLUTION = {
  abstraction: `% Solver A, the hitting-set solver: which guests to uninvite. It knows nothing about
% rivalries; it only learns the cores that the loop adds, as clauses "uninvite at least one of
% these guests". An optimal model is a cheapest set that hits every core so far.
{ out(G) : guest(G,_) }.
#minimize { C,G : out(G), guest(G,C) }.
#show out/1.
`,
  glue: `glue(out(G)) :- guest(G,_).
`,
  check: `% Solver C looks for a witness: a table for every guest who is still invited, rivals apart.
1 { at(G,1) ; at(G,2) } 1 :- guest(G,_), not out(G).
:- rival(A,B), at(A,T), at(B,T).
#show at/2.
`,
  loop: `${DECL}
# Implicit hitting sets: the cheapest set of guests that hits every core found so far. If the
# others can be seated, that set is optimal; if not, the unsatisfiable core names guests who
# cannot all stay, and the next hitting set must uninvite one of them.
loop:
    M = A.solve(optimal)
    if not M: stop "no set of guests can be uninvited"
    if C.solve(assume G(M)):
        accept M
        stop
    A.add(G.core(C))
`,
};

const SEAT_README_1 = `# Implicit hitting sets from scratch (part 1)

## The problem

Two tables, a list of guests, and some pairs of rivals who must not sit at the same table. Not
every guest list can be seated: three guests who are rivals of each other cannot, nor can any ring
of rivals of odd length. You may uninvite guests; uninviting guest \`G\` costs \`C\` (the instance's
\`guest(G,C)\`). Find a set of guests of least total cost whose removal lets everyone else be
seated. (In graph terms: a minimum-weight odd cycle transversal.)

A single ASP program can solve this. The point of the exercise is to build the loop of MaxHS
(Davies and Bacchus) and see why it works: *implicit hitting sets* (IHS), [guide chapter 14](guide/14-hitting-sets.html).

## The idea

The check is easy: given the uninvited guests, seat the others. When that fails, clingo can say
*why*: an **unsatisfiable core**, a set of guests who cannot all stay (it contains an odd ring of
rivals). Every solution uninvites at least one of them. So solver A collects these sets and
computes a **cheapest hitting set**, a set that contains a guest of every core found so far. Its
cost is a lower bound on the optimum. When C can seat the rest, the hitting set is a solution, and
since its cost is a lower bound, it is optimal.

## Step 1: the abstraction (solver A)

A chooses \`out(G)\` for any set of guests, minimises the total cost, and shows \`out/1\`. Nothing
else: A must not know about rivals or tables. All it ever learns comes from the cores.

## Step 2: the glue

C must see which guests are out. Which atoms are the interface? (One \`glue/1\` rule.)

## Step 3: the check (solver C), a witness

Earlier exercises had a check that searches for a **counterexample** (something wrong with the
candidate). This check is different: it searches for a **witness**, a seating of the guests who are
not out. Each such guest sits at table 1 or 2, and no two rivals sit at the same table. Guests who
are out need no seat.

So a satisfiable check means *the candidate is good*, and an unsatisfiable one means *it is bad*.
There is no model to read \`relevant/1\` from, so \`G.clause(M, X)\` is of no use. The refinement
is \`G.core(C)\`: the core of C's last solve, as a clause for A ("one of the assumed values in the core
must change").

## Step 4: the loop

The loop has a different shape from \`search\` with \`on candidate\`:

1. \`M = A.solve(optimal)\`: the cheapest hitting set (stop if there is none).
2. \`C.solve(assume G(M))\`: try to seat the rest.
3. If that works: \`accept M\` and \`stop\`. This is the optimum; do not look further.
4. Otherwise \`A.add(...)\` the refinement and go round again.

Why not \`search A\`? A search goes through the models of A's program one by one. Here every
candidate must be optimal for the cores found so far, and the loop ends at the first good one.

## Step 5: check yourself

- Run \`ring5\` and read the trace (Output tab): what is the first candidate, and what is its core?
- **First try blocking**: refine with \`A.add(G.block(M))\` (rule out exactly this candidate). It
  finds the optimum, so the small instances pass, but \`tables19\` and \`dense18\` stop at the candidate
  limit (500, Loop tab) and the audit cannot work with blocking. Why does blocking need so many
  candidates when A's solve is optimal?
- Then refine with the core. Press **Check exercise** (Instances tab): every optimum, a sound audit
  on three small instances, and the budgets on \`tables19\` (at most 20 candidates) and \`dense18\` (at
  most 60).

## Questions

1. What goes wrong with \`A.solve()\` instead of \`A.solve(optimal)\`? Try it: which check fails, and why?
2. The cores here: is each one an odd ring of rivals? Is each one minimal? (The trace in the
   Output tab names the guests of each clause added to A. Then refine with
   \`C.core.minimal.on(G)\` instead of \`G.core(C)\` and compare.)
3. Why may the loop stop at the first candidate that C can seat? Write the argument down with
   "lower bound".
4. The audit on \`petersen\` reports 806 solutions. What are they? (The audit asks whether a
   refinement could cut a candidate that C accepts, not just the optimal one.)
5. What happens on an instance where the rivals can already be seated, like \`calm6\`?

## Hints (read only when stuck)

1. Abstraction: \`{ out(G) : guest(G,_) }.\` and \`#minimize { C,G : out(G), guest(G,C) }.\`
2. Check: \`1 { at(G,1) ; at(G,2) } 1 :- guest(G,_), not out(G).\` plus one constraint for rivals.
3. Loop: \`if C.solve(assume G(M)):\` takes a model or \`none\`; after it, \`A.add(G.core(C))\`.
4. The run says "the glue fragments derive no glue/1 atom": step 2 is missing.
`;

const SEAT_README_2 = `# Implicit hitting sets: several cores per round (part 2)

Do part 1 first: this starter is its worked solution, the basic IHS loop.

## Look first

Run \`tables19\` with the trace. The guests sit in five separate odd rings of rivals (plus a few
rivalries between rings). The loop needs six candidates: each round, A computes an optimal hitting
set, C finds *one* ring that still cannot be seated, and A is asked again. In real IHS solvers,
A's optimal solve is the expensive step (an NP-hard optimisation over all cores so far), while C's
calls are cheap.

## The idea

Within one round, after a core \`K\`, **relax** it: pretend that its guests are taken care of by
dropping their assumptions, and ask C again with what is left. The next core is then disjoint from
\`K\`. Repeat until C succeeds. Add every core of the round to A, then compute the next hitting set.
On \`tables19\` the first round finds all five rings, and the second hitting set is the optimum.

## The shape

The round becomes a loop inside the loop. You need:

- \`E = G(M)\`: the assumptions as a list that you can change.
- \`C.solve(assume E)\`, then \`K = C.core\`: the assumptions in the core (a list).
- \`K.on(G)\`: the core as a clause for A, the same clause that \`G.core(C)\` gives.
- \`for a in K:\` with \`E = E.without(a)\`: drop the core's assumptions.
- \`break\` leaves the inner loop.

Careful: when is \`M\` optimal now? Not whenever some call of C in the round succeeds.

## Check yourself

**Check exercise**: every optimum, a sound audit on \`petersen\`, and at most 3 candidates on each of
\`tables19\`, \`tables23\` and \`tables24\`, at most 25 on \`dense18\`.

## Questions

1. Every core found after a relaxation is a core of a weaker question (fewer guests assumed). Why is
   it still sound to add it to A?
2. Why do the \`dense\` instances profit less than the \`tables\` ones?
3. Does \`C.core.minimal\` (instead of \`C.core\`) change the number of candidates here? The guide's
   MaxSAT example (\`maxsat-ihs\`) gains a lot from it. Why less here?
4. Optional: draw the lower bound with \`track lower = M.cost\` (Statistics tab).

## Hints (read only when stuck)

1. Keep a counter \`cores = 0\` per round, and accept \`M\` only if it is still 0 after the inner loop.
2. Inner loop: \`X = C.solve(assume E)\`, \`if X: break\`, otherwise take the core, add it, relax it.
3. The guide's example \`maxsat-ihs\` has this loop for MaxSAT.
`;

// ---- counterexample-guided synthesis: weighted voting ------------------------------------
const VOTE_SHARED = `% The instance (Instances tab) gives the players, player(P) for P = 1..n, and the rule to
% imitate: wins(S) for every coalition S that wins. A coalition is a number 0..2^n - 1:
% player P is in coalition S when bit P - 1 of S is set. The constants n and wmax (the
% largest weight) come with the instance.
coalition(0..2**n-1).
in(P,S) :- player(P), coalition(S), (S / 2**(P-1)) \\ 2 = 1.
`;
const VOTE_DESC = {
  shared: 'Added to every solver: coalitions and their members.',
  abstraction: 'Solver A: a weight for every player and a quota.',
  glue: 'The interface atoms: every glue(T) makes T an interface atom.',
  check: 'Solver C: a coalition that the weights classify wrongly.',
};
const voteInstance = (x) => ({ id: x.id, facts: x.facts, constants: { ...x.constants }, expected: { solutions: null, optimum: null, ...x.expected }, tags: [] });

export const VOTING_SOLUTION = {
  abstraction: `% Solver A: a weight 0..wmax for every player and a quota; the lightest first.
1 { w(P,0..wmax) } 1 :- player(P).
1 { quota(1..n*wmax) } 1.
#minimize { W,P : w(P,W) }.
#show w/2.
#show quota/1.

% One coalition that an earlier candidate got wrong: from now on, every candidate must get it
% right. A copy of the specification for one input (cex(k, bad(S)) comes from the loop).
#program refine(k).
weight(k,X) :- cex(k,bad(S)), X = #sum { W,P : in(P,S), w(P,W) }.
:- cex(k,bad(S)), wins(S), weight(k,X), quota(Q), X < Q.
:- cex(k,bad(S)), not wins(S), weight(k,X), quota(Q), X >= Q.
`,
  glue: `glue(w(P,W)) :- player(P), W = 0..wmax.
glue(quota(Q)) :- Q = 1..n*wmax.
`,
  check: `% Solver C looks for a counterexample: one coalition that the weights classify wrongly.
1 { bad(S) : coalition(S) } 1.
weight(S,X) :- bad(S), X = #sum { W,P : in(P,S), w(P,W) }.
:- bad(S), wins(S), weight(S,X), quota(Q), X >= Q.
:- bad(S), not wins(S), weight(S,X), quota(Q), X < Q.
#show bad/1.
`,
  loop: `${DECL}
# Counterexample-guided synthesis: the lightest weights that classify every coalition seen so far
# correctly. If no coalition is classified wrongly, they are optimal; otherwise learn that
# coalition (a copy of the specification for it) and ask again.
loop:
    M = A.solve(optimal)
    if not M: stop
    X = C.solve(assume G(M))
    if not X:
        accept M
        stop
    A.expand(refine, cex = X.atoms(bad/1))
`,
};

const VOTE_README_1 = `# Counterexample-guided synthesis from scratch (part 1)

## The problem

A committee of \`n\` players decides by a rule that says which coalitions win (the instance's
\`wins(S)\`). Find a **weighted vote** that gives exactly the same winners: a weight \`0..wmax\` for
every player and a quota \`1..n*wmax\`, such that a coalition wins if and only if the weights of its
members add up to at least the quota. Among all of these, find one with the **least total weight**.
If there is none (instance \`two-pairs\`), the loop must say so: no solution.

This is an exists-forall problem: *there are* weights such that *for every* coalition the vote is
right. The loop is CEGIS (counterexample-guided inductive synthesis, [guide chapter 16](guide/16-cegis.html)): A proposes
weights, C looks for a coalition they get wrong, and A learns from that coalition.

## Step 1: the abstraction (solver A)

A weight \`w(P,W)\` for every player, a quota \`quota(Q)\`, a \`#minimize\` over the weights, \`#show\`
of both. Nothing about \`wins\`: A learns which coalitions matter from the loop.

## Step 2: the glue

Which atoms of A must C see? Name every possible one (all weights and quotas), not only the true ones.

## Step 3: the check (solver C), a counterexample

C picks one coalition \`bad(S)\`, computes its weight under the candidate (\`#sum\`), and keeps it only
if the vote gets it **wrong**: it wins but its weight is below the quota, or it loses but its weight
reaches the quota. Get the direction right: a constraint removes the models you do *not* want.
Test it: on \`chair4\` the first candidate (all weights 0) must be refuted by a winning coalition.

## Step 4: the loop and the refinement

The shape is the one of part 1 of the IHS exercise: \`M = A.solve(optimal)\`, check, refine, solve
again; accept and stop at the first candidate without a counterexample. (Why is it optimal?)

Then try three refinements, in this order, and look at the number of candidates:

1. **Block**: \`A.add(G.block(M))\`. This rules out one vote. It hits the candidate limit (1000, Loop
   tab) on most instances. Why so many candidates?
2. **A clause from \`relevant/1\`**: mark the weights of the members of \`S\` and the quota, and use
   \`A.add(G.clause(M, X))\`. The audit says it is sound. It is still too weak. Why? What can a
   clause over interface atoms say, and what can it not say?
3. **Learn the coalition**: add to A the requirement that coalition \`S\` must be classified
   correctly, for every future candidate. That is not a clause but a few rules, a copy of the
   specification for one input. Write them in a part \`#program refine(k).\` at the end of the
   abstraction, reading the coalition from \`cex(k,bad(S))\`, and call
   \`A.expand(refine, cex = X.atoms(bad/1))\` (manual, "#program refine(k)").

## Step 5: check yourself

**Check exercise**: every optimum (and no solution for \`two-pairs\`), a sound audit on \`dictator3\` and
\`unanimity3\`, and at most 25 candidates on \`vetoes5\` and \`steps6\`, at most 40 on \`council6\`.

## Questions

1. Why is the first weighting without a counterexample optimal?
2. \`two-pairs\` (1 and 2 win, 3 and 4 win, nobody else) has no weighted vote. Read the
   counterexamples in the trace: which four coalitions together prove it? Does the loop prove
   "no weighted vote at all" or "none with weights up to \`wmax\`"?
3. A one-program encoding checks all \`2^n\` coalitions. How many does the loop use on \`council6\`
   (64 coalitions)?
4. Compare with the IHS loop: in both, A is a relaxation that grows. What does each learn, and from
   what (a core of a witness search, or a counterexample)?

## Hints (read only when stuck)

1. Abstraction: \`1 { w(P,0..wmax) } 1 :- player(P).\` and \`1 { quota(1..n*wmax) } 1.\`
2. Check: \`weight(S,X) :- bad(S), X = #sum { W,P : in(P,S), w(P,W) }.\`, then
   \`:- bad(S), wins(S), weight(S,X), quota(Q), X >= Q.\` and the other direction.
3. In \`refine(k)\`, every head must contain \`k\` (\`weight(k,X)\`), or clingo ignores the rules of the
   second refinement and the loop stops with "no progress".
4. Inside \`refine(k)\` the constraints are those of the check with the opposite effect: they
   remove the weightings that get coalition \`S\` wrong.
`;

const VOTE_README_2 = `# Counterexample-guided synthesis: more per round (part 2)

Do part 1 first: this starter is its worked solution, the basic CEGIS loop.

## Look first

Run \`council6\` and count the rounds: each one costs an optimal solve of A, and each one learns
a single coalition. A check can return more than one: there are usually many coalitions that
the candidate gets wrong.

## The task

Learn **several counterexamples per round**. Ask C for up to a few of them and expand A with each
one, then solve A again. You need:

- \`XS = C.models(assume G(M), limit 3)\`: a list of up to 3 models of C (empty if there is none).
- \`XS.size\`, and \`for X in XS:\`.
- One \`A.expand(refine, cex = ...)\` per counterexample (each gets its own \`k\`).

Another way: let the check pick several wrong coalitions in one model (\`1 { bad(S) : coalition(S) } 3\`
does not quite do it: why not?).

## Check yourself

**Check exercise**: every optimum, a sound audit on \`dictator3\`, at most 9 candidates on \`council6\`,
8 on \`majority5\` and 6 on \`steps6\`.

## Questions

1. What is the trade-off of a larger limit? Look at the time of A's solves in the Statistics tab.
2. Are the counterexamples of one round different from each other in a useful way? Would "the
   coalitions furthest from the quota" be better ones? (Guide chapter 6, "Asking for the best
   counterexample".)
3. With all counterexamples (no limit), how many rounds are left, and what has the loop become?
`;

export const LOOP_EXERCISES = [
  {
    id: 'exercise-ihs-seating',
    title: 'Exercise: implicit hitting sets (1), seating rivals',
    summary: 'Build an implicit hitting set loop from scratch: the cheapest guests to uninvite so that rivals sit at different tables.',
    description: 'Two tables, and some guests are rivals who must not share one. Uninvite guests of least total cost so that ' +
      'everyone else can be seated. Write the abstraction, the glue, the check and the loop yourself (the readme guides ' +
      'you), then press Check exercise in the Instances tab.',
    text: 'Build the implicit hitting set loop. Every instance must give its optimum, the audit must be sound on ring5, ' +
      'calm6 and petersen, tables19 must need at most 20 candidates and dense18 at most 60. A loop that blocks refuted ' +
      'candidates cannot meet the budgets.',
    readme: SEAT_README_1,
    build: () => ({
      fragments: [
        frag('shared', SEAT_SHARED, SEAT_DESC.shared),
        frag('abstraction', '% Solver A chooses which guests to uninvite (readme, step 1). It knows nothing about rivals:\n% it only learns what the loop adds to it.\n', SEAT_DESC.abstraction),
        frag('glue', '% The interface between A and C (readme, step 2): glue(T) for every atom T of A whose\n% value C must see.\n', SEAT_DESC.glue),
        frag('check', '% Solver C seats the guests who are not uninvited, rivals apart (readme, step 3).\n% It looks for a witness, not for a counterexample.\n', SEAT_DESC.check),
      ],
      loop: `${DECL}
# The implicit hitting set loop (readme, step 4):
#   1. the cheapest candidate of A (an optimal hitting set of the cores so far)
#   2. ask C for a seating, assuming the candidate
#   3. seated: the candidate is optimal; accept it and stop
#   4. not seated: refine A from C's unsatisfiable core, and go round again
stop "the loop is not written yet"
`,
      settings: settings('ring5', 30, 500),
      instances: ['ring5', 'calm6', 'petersen', 'party12', 'party16', 'dense14', 'tables19', 'dense18'].map(seatInstance),
      exercise: { instances: 'all', audit: ['ring5', 'calm6', 'petersen'], budgets: [{ instance: 'tables19', candidates: 20 }, { instance: 'dense18', candidates: 60 }] },
    }),
  },
  {
    id: 'exercise-ihs-seating-2',
    title: 'Exercise: implicit hitting sets (2), several cores per round',
    summary: 'Extend the IHS loop of part 1 with an inner loop that finds disjoint cores, so that one round learns several.',
    description: 'Part 2 of the seating exercise; it starts from the solution of part 1. Each round of the loop finds one ' +
      'core. Find several disjoint ones per round by relaxing each core and asking the check again (the readme guides you), ' +
      'then press Check exercise in the Instances tab.',
    text: 'Find several cores per round. Every instance must still give its optimum, the audit must be sound on petersen, ' +
      'tables19, tables23 and tables24 must need at most 3 candidates each and dense18 at most 25.',
    readme: SEAT_README_2,
    build: () => ({
      fragments: [
        frag('shared', SEAT_SHARED, SEAT_DESC.shared),
        frag('abstraction', SEATING_SOLUTION.abstraction, SEAT_DESC.abstraction),
        frag('glue', SEATING_SOLUTION.glue, SEAT_DESC.glue),
        frag('check', SEATING_SOLUTION.check, SEAT_DESC.check),
      ],
      loop: SEATING_SOLUTION.loop,
      settings: settings('tables19', 30, 500),
      instances: ['ring5', 'calm6', 'petersen', 'party12', 'party16', 'dense14', 'dense16', 'dense18', 'tables19', 'tables23', 'tables24'].map(seatInstance),
      exercise: { instances: 'all', audit: ['petersen'], budgets: ['tables19', 'tables23', 'tables24'].map((instance) => ({ instance, candidates: 3 })).concat([{ instance: 'dense18', candidates: 25 }]) },
    }),
  },
  {
    id: 'exercise-cegis-voting',
    title: 'Exercise: counterexample-guided synthesis (1), weighted voting',
    summary: 'Build a CEGIS loop from scratch: the lightest weights and quota that give exactly the winning coalitions of a rule.',
    description: 'A committee decides by a rule that says which coalitions win. Find the lightest weighted vote (a weight per ' +
      'player and a quota) with exactly the same winners, or show that there is none. Write the abstraction, the glue, the ' +
      'check and the loop yourself (the readme guides you), then press Check exercise in the Instances tab.',
    text: 'Build the CEGIS loop. Every instance must give its optimum (two-pairs: no solution), the audit must be sound on ' +
      'dictator3 and unanimity3, vetoes5 and steps6 must need at most 25 candidates and council6 at most 40. Neither ' +
      'blocking nor a clause from relevant/1 meets the budgets.',
    readme: VOTE_README_1,
    build: () => ({
      fragments: [
        frag('shared', VOTE_SHARED, VOTE_DESC.shared),
        frag('abstraction', '% Solver A proposes a weighted vote (readme, step 1): a weight w(P,W) for every player and\n% a quota quota(Q), the lightest first. Later: the rules it learns per counterexample.\n', VOTE_DESC.abstraction),
        frag('glue', '% The interface between A and C (readme, step 2).\n', VOTE_DESC.glue),
        frag('check', '% Solver C looks for one coalition bad(S) that the weights classify wrongly (readme, step 3).\n', VOTE_DESC.check),
      ],
      loop: `${DECL}
# The CEGIS loop (readme, step 4):
#   1. the lightest candidate of A
#   2. ask C for a coalition it classifies wrongly, assuming the candidate
#   3. none: the candidate is optimal; accept it and stop
#   4. one: refine A with it (block, clause, or learn the coalition), and go round again
stop "the loop is not written yet"
`,
      settings: settings('chair4', 30, 1000),
      instances: VOTING.map(voteInstance),
      exercise: { instances: 'all', audit: ['dictator3', 'unanimity3'], budgets: [{ instance: 'vetoes5', candidates: 25 }, { instance: 'steps6', candidates: 25 }, { instance: 'council6', candidates: 40 }] },
    }),
  },
  {
    id: 'exercise-cegis-voting-2',
    title: 'Exercise: counterexample-guided synthesis (2), more per round',
    summary: 'Extend the CEGIS loop of part 1 so that each round learns several counterexamples.',
    description: 'Part 2 of the weighted voting exercise; it starts from the solution of part 1. Each round learns one ' +
      'coalition. Learn several per round (the readme guides you), then press Check exercise in the Instances tab.',
    text: 'Learn several counterexamples per round. Every instance must still give its optimum (two-pairs: no solution), ' +
      'the audit must be sound on dictator3, council6 must need at most 9 candidates, majority5 at most 8 and steps6 at most 6.',
    readme: VOTE_README_2,
    build: () => ({
      fragments: [
        frag('shared', VOTE_SHARED, VOTE_DESC.shared),
        frag('abstraction', VOTING_SOLUTION.abstraction, VOTE_DESC.abstraction),
        frag('glue', VOTING_SOLUTION.glue, VOTE_DESC.glue),
        frag('check', VOTING_SOLUTION.check, VOTE_DESC.check),
      ],
      loop: VOTING_SOLUTION.loop,
      settings: settings('council6', 30, 1000),
      instances: VOTING.map(voteInstance),
      exercise: { instances: 'all', audit: ['dictator3'], budgets: [{ instance: 'council6', candidates: 9 }, { instance: 'majority5', candidates: 8 }, { instance: 'steps6', candidates: 6 }] },
    }),
  },
];
