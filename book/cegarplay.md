---
title: Designing CEGAR loops
subtitle: A course in counterexample-guided loops in ASP
lang: en
generator: tools/export-book.py (generated; do not edit)
---

# Part I: Designing CEGAR loops {#part-1}

## Introduction {#c00}

The graph of the first four chapters, for the figures below (node coordinates in a 100 by 60 box, as `guide/guide.js` draws them):

```{.graph-data}
{"box": [100, 60], "nodes": {"1": [6, 8], "2": [6, 52], "3": [15, 30], "4": [28, 30], "5": [40, 8], "6": [52, 30], "7": [64, 8], "8": [76, 30], "9": [90, 8], "10": [90, 52]}, "edges": [[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4], [4, 5], [4, 6], [5, 6], [6, 7], [6, 8], [7, 8], [8, 9], [8, 10], [9, 10]]}
```

::: lead
A course in building counterexample-guided loops in answer set programming: what goes in the abstraction, how a counterexample becomes a refinement, how a refinement goes wrong, and which loop to choose.
:::

### What this guide is {#c00-what}

Part I of this book teaches the design of a loop. Part II is a tour of the playground, the browser application in which every example of Part I runs. A [glossary](#glossary) and a [bibliography](#bibliography) close Part I.

You should know answer set programming: choice rules, constraints, `#show`, and running clingo. You need not know anything about CEGAR.

### The loop in one picture {#c00-loop}

```{.diagram caption="Propose, test, learn, repeat."}
<svg class="diagram" viewBox="0 45 560 165" role="img"
            aria-label="Solver A proposes a candidate; solver C looks for a counterexample; a counterexample becomes a refinement for solver A.">
            <rect class="box" x="20" y="60" width="180" height="64" rx="6"></rect>
            <text x="110" y="88" text-anchor="middle">Abstraction</text>
            <text class="small" x="110" y="108" text-anchor="middle">solver A proposes</text>
            <rect class="box" x="360" y="60" width="180" height="64" rx="6"></rect>
            <text x="450" y="88" text-anchor="middle">Check</text>
            <text class="small" x="450" y="108" text-anchor="middle">solver C tests</text>
            <path class="arrow" d="M200 76 H350"></path>
            <polygon class="head" points="360,76 350,71 350,81"></polygon>
            <text x="280" y="66" text-anchor="middle">candidate</text>
            <path class="arrow learn" d="M360 110 H210"></path>
            <polygon class="learn-head" points="200,110 210,105 210,115"></polygon>
            <text x="280" y="134" text-anchor="middle">refinement</text>
            <text class="small" x="280" y="152" text-anchor="middle">learnt from the counterexample</text>
            <path class="arrow" d="M450 124 V168"></path>
            <polygon class="head" points="450,178 445,168 455,168"></polygon>
            <text x="450" y="198" text-anchor="middle">no counterexample: a solution</text>
            <path class="arrow" d="M110 124 V168"></path>
            <polygon class="head" points="110,178 105,168 115,168"></polygon>
            <text x="110" y="198" text-anchor="middle">no candidate left: done</text>
          </svg>
```

### The examples {#c00-examples}

Every step of Part I is an example of the playground, named where it appears, as in \[Playground: guide-03-hit-clique\]. The numbers in the text (candidates, counterexamples, solutions) were measured with the engine the playground uses, and a test keeps them up to date, so a run of an example shows the same numbers.

1. 01[Why a loop](#c01) A problem with one quantifier too many for one program, and the idea of the loop.
2. 02[The first loop: guess, check, block](#c02) Two programs, two solvers, the glue, and blocking one wrong candidate at a time.
3. 03[Learning from a counterexample](#c03) relevant/1: a counterexample rules out many candidates at once.
4. 04[Soundness: when a refinement says too much](#c04) A refinement that excludes a solution, how it shows, and how to test for it.
5. 05[Reading a run](#c05) The statistics, the trace and the run history, on a larger graph.
6. 06[Getting more out of each check](#c06) Several counterexamples per candidate, and stronger ones.
7. 07[Designing the abstraction](#c07) What the abstraction knows in advance, and what it should leave to the check.
8. 08[Loop shapes](#c08) One search or many solves, and when each pays.
9. 09[Refinements that are rules](#c09) Grounding a refinement as a program part instead of adding clauses.
10. 10[Checks that look for a witness, and cores](#c10) When a good candidate is one with an answer set, and refining from a core.
11. 11[Optimisation](#c11) Bilevel problems: the best candidate that no check can refute.
12. 12[Your own loop: a walkthrough and a checklist](#c12) A fresh problem from start to finish, and the rules of the guide in one list.

1. 13[2QBF, by clauses and by expansion](#c13) The loop of Part I is a known QBF algorithm; expansion learns a copy of the formula instead of a clause.
2. 14[Implicit hitting sets](#c14) MaxSAT as an optimal hitting set of cores: lower and upper bounds, and minimal cores.
3. 15[MARCO: two kinds of answer](#c15) A map of all subsets, shrink and grow, and refinements in both directions.
4. 16[CEGIS: synthesis from counterexamples](#c16) The counterexample is an input; the synthesiser learns to be right on it.
5. 17[Core-guided optimisation: OLL](#c17) One solver whose cores relax the problem instead of cutting it, against the hitting-set loop.
6. 18[Benders decomposition](#c18) Master and subproblem, optimality cuts as rules, and how much a cut should cover.
7. 19[More than two quantifier levels](#c19) Chains of solvers, recursion over solver families, and cores along the chain.
8. 20[Lazy constraints and omission](#c20) Checks at partial assignments, and abstractions that leave part of the problem out.
9. 21[A case study: explaining voting outcomes](#c21) A research project with the tool: strategies as variants, a campaign, ground truth and open questions.
10. 22[From a paper to a loop](#c22) A checklist from pseudocode to loop script, and which loop for which problem.

- How to compare refinement strategies with a campaign: Variants, a suite, the instance × variant matrix and the plots.
- How to find where the time goes: Solvers, candidates, clause lengths, the timeline and the cost per line.
- How to hunt an unsound refinement: The audit, the candidate space, Fuzz and a regression instance.
- How to build an instance set: Generators, imports, ground truth and Run all instances.
- How to run experiments headlessly: run.mjs, bench.mjs, report.mjs, and when to move to native clingo.
- How to check a loop independently: The reference variant, cegarcheck.py and proof logs with certcheck.py.
- How to write a domain view: Scene and frame, the step facts, and checking a view against the trace.
- How to record and present a run: Recordings, replays, storyboards and lecture links.
- How to turn a paper into a loop: A checklist from pseudocode to loop script, and what to do when CegarPlay lacks something.

- Reading the guide and the tutorial together: One order for both, so that each tool appears when a design question calls for it.
- Notes for instructors: A twelve-week course plan, replays for the key moments, graded exercises and project kits by size.
- [Glossary](#glossary): The terms of the guide, each with the chapter that introduces it.
- [Bibliography](#bibliography): The papers behind the loops of Part II and the manual's table "Loops from the literature".

## Why a loop {#c01}

::: lead
Some problems ask for one thing that works against every possible objection. This chapter shows such a problem, why one answer set program does not solve it, and the idea of the loop that does.
:::

### The problem {#c01-problem}

Take a graph and a number k. Delete at most k of its nodes so that no triangle is left: no three remaining nodes may be joined pairwise by edges. This is a small case of *clique interdiction*, and it is the running example of the guide.

Here is the graph of the first four chapters. It has ten nodes: nodes 1 to 4 are all joined to each other, and a chain of triangles runs from node 4 to node 10.

```{.graph caption="The small graph: ten nodes, fifteen edges, seven triangles."}
Ten nodes: a clique on 1, 2, 3, 4 and a chain of triangles 4-5-6, 6-7-8, 8-9-10.
```

With k = 3, try deleting nodes 4 and 8. That breaks six of the seven triangles, but 1, 2, 3 survives:

```{.graph delete="4 8" clique="1 2 3" caption="Nodes 4 and 8 deleted; the triangle 1, 2, 3 survives."}
Nodes 4 and 8 are crossed out; the triangle 1, 2, 3 is highlighted.
```

### The guess is easy {#c01-guess}

Proposing a deletion set is one choice rule:

```asp
{ del(V) : node(V) } k.
#show del/1.
```

::: listing-source
From the fragment `abstraction` of `guide-01-guess`.
:::

Each answer set of this rule is a *candidate*: a proposal that may or may not solve the problem. The example below runs the rule and accepts every candidate, so the number of solutions it reports is simply the number of candidates. [Playground: guide-01-guess]{.play}

::: {.predict #c01-predict-1}
Predict: how many candidates are there for k = 3? [Answer](#c01-predict-1-answer)
:::

### Testing one guess is easy {#c01-one-candidate}

For one given deletion set, finding a surviving triangle is just as easy: guess three nodes, none deleted, pairwise joined.

```asp
3 { q(V) : node(V) } 3.
:- q(V), del(V).
:- q(U), q(V), U < V, not edge(U,V).
#show q/1.
```

::: listing-source
From the fragment `check` of `guide-01-one-candidate`.
:::

If this program has an answer set, the deletion set is wrong, and the answer set shows why. Such an answer set is a *counterexample*.

The next example fixes the candidate to the deletion of 4 and 8 and runs this test on it. After the run, open the Output tab and look at the trace: under *Counterexample* you see `q(1) q(2) q(3)`, the surviving triangle of the picture above. [Playground: guide-01-one-candidate]{.play}

### Both in one program does not work {#c01-one-program}

The natural next step is to put the guess and the test into one program. Here is the tempting version: guess the deletions, guess a triangle, and demand that a deleted node hits it.

```asp
{ del(V) : node(V) } k.

% The tempting test: guess a triangle and demand that a deleted node hits it.
3 { q(V) : node(V) } 3.
:- q(U), q(V), U < V, not edge(U,V).
hit :- q(V), del(V).
:- not hit.
```

::: listing-source
From the fragment `abstraction` of `guide-01-one-program`.
:::

The solver is free to choose the triangle `q`. So an answer set needs just *some* triangle that is hit, not every one. Deleting node 1 alone passes: the solver picks the triangle 1, 2, 3 and is satisfied. (The example runs clingo with `--project`, so that each deletion set counts once, however many triangles it hits.) [Playground: guide-01-one-program]{.play}

::: {.predict #c01-predict-2}
How many deletion sets does this program accept? [Answer](#c01-predict-2-answer)
:::

Turning the constraint around does not help. A guessed atom in an answer set program always means "there is one": the solver searches for it. The problem needs "there is a deletion set such that *every* triangle is hit", or equivalently "such that *no* triangle survives". A guessed `q` cannot say "no triangle".

### Exists, then for all {#c01-quantifiers}

The problem has the shape *there is an X such that for all Y, Y is not a problem for X*. Here X is a deletion set and Y a triple of nodes. The shape is common. In the side trips of this guide you will meet these:

- Graph colouring: a graph with a colouring of its leaves that *no* proper 3-colouring of the whole graph extends.
- Explanations: a small set of features of an input such that *every* input that agrees on them gets the same class.
- Fair division: an allocation of goods such that *no* other allocation makes everyone at least as happy.
- Bilevel knapsack: a choice by one player such that *every* answer of the other player stays below a bound.

In each case one part is guessed and the other part has to hold for all possibilities.

### The idea of the loop {#c01-idea}

Keep the two easy programs apart and let them talk. One solver, the *abstraction*, proposes candidates. A second solver, the *check*, looks for a counterexample to each candidate. A candidate without a counterexample is a solution. A counterexample is turned into a *refinement*: something the abstraction learns, so that it does not propose the same mistake again.

```{.diagram caption="Propose, test, learn, repeat."}
<svg class="diagram" viewBox="0 45 560 165" role="img"
            aria-label="Solver A proposes a candidate; solver C looks for a counterexample; a counterexample becomes a refinement for solver A.">
            <rect class="box" x="20" y="60" width="180" height="64" rx="6"></rect>
            <text x="110" y="88" text-anchor="middle">Abstraction</text>
            <text class="small" x="110" y="108" text-anchor="middle">solver A proposes</text>
            <rect class="box" x="360" y="60" width="180" height="64" rx="6"></rect>
            <text x="450" y="88" text-anchor="middle">Check</text>
            <text class="small" x="450" y="108" text-anchor="middle">solver C tests</text>
            <path class="arrow" d="M200 76 H350"></path>
            <polygon class="head" points="360,76 350,71 350,81"></polygon>
            <text x="280" y="66" text-anchor="middle">candidate</text>
            <path class="arrow learn" d="M360 110 H210"></path>
            <polygon class="learn-head" points="200,110 210,105 210,115"></polygon>
            <text x="280" y="134" text-anchor="middle">refinement</text>
            <text class="small" x="280" y="152" text-anchor="middle">learnt from the counterexample</text>
            <path class="arrow" d="M450 124 V168"></path>
            <polygon class="head" points="450,178 445,168 455,168"></polygon>
            <text x="450" y="198" text-anchor="middle">no counterexample: a solution</text>
            <path class="arrow" d="M110 124 V168"></path>
            <polygon class="head" points="110,178 105,168 115,168"></polygon>
            <text x="110" y="198" text-anchor="middle">no candidate left: done</text>
          </svg>
```

This is counterexample-guided abstraction refinement, CEGAR for short. The rest of the guide is about doing each step well. The next chapter builds the simplest loop that is correct; the one after makes it learn.

::: theory
**Theory**

Deciding whether a normal answer set program has an answer set is NP-complete. Problems of the form "exists X, for all Y" with a polynomial test are complete for the second level of the polynomial hierarchy, Σ~2~^P^, and are believed to be harder. Disjunctive programs reach that level, and the classic way to use them is *saturation*: an encoding of the "for all" part that derives every atom when the inner check fails. Saturation works, but it is hard to write, hard to read, and grounds the whole inner problem at once. A loop keeps both parts as ordinary programs and pays for the inner problem only where a candidate needs it. This guide does not use saturation.
:::

::: exercise
### Exercise 1 {#c01-exercise-1}

Using the picture, find by hand a set of at most three nodes whose deletion leaves no triangle. How many such sets are there?

[Solution](#c01-exercise-1-solution)
:::

::: exercise
### Exercise 2 {#c01-exercise-2}

In the Loop tab of `guide-01-guess`, change the constant k to 2 and then to 4. Predict the number of candidates before each run.

[Solution](#c01-exercise-2-solution)
:::

::: recap
### Recap

- []{#c01-rule-quantifiers}Look for the quantifiers. "There is an X such that for all Y …" is the shape a loop is for.
- []{#c01-rule-guessed-means-some}A guessed atom means "there is one". One program cannot say "for all" with it.
- []{#c01-rule-split}Split the problem into a guess (the abstraction) and a test of one guess (the check); each is an ordinary program.
:::

### Answers {#c01-answers .answers}

::: {.answer #c01-predict-1-answer}
[Back to the question](#c01-predict-1)

176: the empty set, 10 single nodes, 45 pairs and 120 triples. Only a few of them are solutions.
:::

::: {.answer #c01-predict-2-answer}
[Back to the question](#c01-predict-2)

175: every candidate but the empty set, because every node of this graph lies on some triangle. There are only 3 real solutions.
:::

::: {.answer #c01-exercise-1-solution}
[Back to Exercise 1](#c01-exercise-1)

The triangles 4, 5, 6 and 8, 9, 10 share no node, so two deletions go to them. Node 4 also breaks three triangles of the clique, and node 8 also breaks 6, 7, 8. That leaves the triangle 1, 2, 3, which takes the third deletion. So the solutions are 4, 8 and one of 1, 2, 3: 3 sets. The first loop of the next chapter finds exactly these. [Playground: guide-02-block]{.play}
:::

::: {.answer #c01-exercise-2-solution}
[Back to Exercise 2](#c01-exercise-2)

For k = 2: 1 + 10 + 45 = 56. For k = 4: the 176 of k = 3 plus 210 sets of four, 386. The candidate space grows quickly with k; a loop that looks at every candidate grows with it. [Playground: guide-01-guess]{.play}
:::

## The first loop: guess, check, block {#c02}

::: lead
The simplest loop that is correct: the abstraction proposes, the check refutes, and every refuted candidate is forbidden on its own. It is slow, and it is the yardstick for every faster loop in this guide.
:::

### Two programs, two solvers {#c02-two-programs}

A project in the playground is a list of *fragments*, named pieces of ASP text. The loop builds a *solver* (one clingo instance) from some of them. Our problem needs two solvers. The graph goes into the fragment `shared`, which both solvers read. The abstraction solver A reads `shared` and `abstraction`:

```asp
% A candidate: at most k nodes to delete.
{ del(V) : node(V) } k.
#show del/1.
```

::: listing-source
From the fragment `abstraction` of `guide-02-block`.
:::

The abstraction does not have to be exact. It may propose wrong candidates; the check will catch them. What it must never do is leave out a solution, because a solution that is never proposed is never found. In other words, the abstraction *over-approximates*: every solution is a candidate. Here every candidate is a set of at most k nodes, so this holds trivially.

### The check {#c02-check}

The check solver C reads `shared` and `check`. It is the test of the previous chapter:

```asp
3 { q(V) : node(V) } 3.
:- q(V), del(V).
:- q(U), q(V), U < V, not edge(U,V).
#show q/1.
```

::: listing-source
From the fragment `check` of `guide-02-block`.
:::

Note the direction. The check has an answer set exactly when the candidate is *wrong*. The answer set is a counterexample: a surviving triangle. If the check has no answer set, the candidate is a solution. A check that would instead succeed on good candidates is a different design; chapter 10 is about it.

### The glue {#c02-glue}

The check reads `del/1`, but the deletions are chosen in solver A. The fragment `glue` says which atoms of A the check gets to see:

```asp
glue(del(V)) :- node(V).
```

::: listing-source
From the fragment `glue` of `guide-02-block`.
:::

Every atom T with `glue(T)` is an *interface atom*. For each candidate, the loop passes the value of every interface atom to the check as an assumption: true if the candidate has it, false if not. The check sees nothing else of solver A. An atom the check reads but the glue does not list is simply false in the check, and no one tells you.

### The loop script {#c02-loop}

The Loop tab holds a short script that wires the fragments together and says what to do with each candidate. This is the whole script of the first loop:

```loop
solver A = shared + abstraction
solver C = shared + check          options "--heuristic=Domain"
link   G = A -> C via shared + glue

search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.block(M)
```

::: listing-source
From the loop script of `guide-02-block`.
:::

Line by line:

- `solver A = shared + abstraction` builds solver A from two fragments; the same for C. The option `--heuristic=Domain` is a clingo option for the check; chapter 5 says why it is there.
- `link G = A -> C via shared + glue` declares the *link* G: the interface atoms are the `glue(T)` atoms derived from `shared` and `glue`.
- `search A:` runs one search of solver A for all its answer sets, and `on candidate M:` is called for each of them.
- `X = C.solve(assume G(M))` is the check: solve C with the candidate's interface atoms as assumptions. X is the counterexample, or nothing.
- `reject M with G.block(M)` throws the candidate away and adds a *refinement* to solver A. Here the refinement is a *block*: a clause that says "not exactly this candidate again".

A candidate that is not rejected is a *solution*. The playground calls this script the Reference run; it is one of the templates of the Loop tab.

### Running it {#c02-block}

The run of the first loop, `guide-02-block`, is the subject of the rest of this section. [Playground: guide-02-block]{.play}

::: {.predict #c02-predict-1}
Predict: how many candidates will the loop look at, and how many counterexamples will it find? [Answer](#c02-predict-1-answer)
:::

### Reading the Output tab {#c02-output}

The result line says how the run ended. *Exhausted* means the abstraction has no candidate left, so the list of solutions is complete. Below it are the solutions, and then the *trace*: one step per refinement, which you move through with the slider. Each step shows the candidate (its true interface atoms) and the refinement. In the next chapters it also shows the counterexample the refinement was made from.

Step 2 of this run is the candidate that deletes only node 1. The refinement is the clause

```text
-del(1) del(2) del(3) del(4) del(5) del(6) del(7) del(8) del(9) del(10)
```

read as: "in every later candidate, node 1 is not deleted, or one of the others is". It names all ten interface atoms and asks for any one of them to change. That is what a block is. The Statistics tab shows the mean clause length: 10.0, the number of interface atoms.

### Always sound, always slow {#c02-slow}

Blocking can never lose a solution: it forbids only a candidate that the check has just shown to be wrong. We call a loop *sound* when it reports exactly the solutions of the problem; the blocking loop is sound for any problem whose abstraction over-approximates and whose check is right.

The price is that the loop learns nothing beyond the one candidate. It needs one check per candidate, and the number of candidates grows quickly with the size of the problem. For the small graph that is fine. For anything larger, the loop must learn more from each counterexample. That is the next chapter.

Keep the blocking loop anyway. On a small instance it gives the true solutions, and chapter 4 uses it to test faster loops.

::: pitfall
**Pitfall: the glue**

A glue that names the wrong atoms gives no warning by itself. If none of its atoms occurs in the abstraction (for instance `glue(deleted(V))` for an abstraction that uses `del/1`), the link has no interface atoms, and the first refinement ends the run with the error "an empty clause cannot refine the candidate". If it misses only some atoms, the run finishes normally, with wrong solutions: the missing atoms are false in the check. Exercise 1 shows such a run.

How to find it: a block names every interface atom, so the first block clause in the trace is the list of what the check can see. Compare it with the atoms the check reads.
:::

::: exercise
### Exercise 1 {#c02-exercise-1}

Suppose the glue was written for an earlier graph with seven nodes: `glue(del(1..7)).` What happens when you run the loop on the small graph, and why?

[Solution](#c02-exercise-1-solution)
:::

::: exercise
### Exercise 2 {#c02-exercise-2}

Change the problem: no clique of c = 4 nodes may survive, instead of no triangle. Write the check with a constant `c`. Then predict: will the blocking loop reject more or fewer candidates than for triangles?

[Solution](#c02-exercise-2-solution)
:::

::: recap
### Recap

- []{#c02-rule-over-approximate}The abstraction over-approximates: every solution must be a candidate.
- []{#c02-rule-check-finds-wrong}The check has an answer set exactly when the candidate is wrong; that answer set is the counterexample.
- []{#c02-rule-glue-everything}Glue every atom of the abstraction that the check reads. An atom that is not glued is silently false in the check.
- []{#c02-rule-block-baseline}Blocking is always sound and always slow. Keep the blocking loop as the ground truth for small instances.
:::

### Answers {#c02-answers .answers}

::: {.answer #c02-predict-1-answer}
[Back to the question](#c02-predict-1)

Every one of the 176 sets of at most three nodes. Each block rules out only the candidate it was made from, so no candidate is skipped. Of these, 173 have a counterexample and 3 are solutions.
:::

::: {.answer #c02-exercise-1-solution}
[Back to Exercise 1](#c02-exercise-1)

The run finishes with 0 solutions. The check never sees `del(8)`, `del(9)` or `del(10)`, so for the check those nodes are never deleted, and the triangle 8, 9, 10 survives every candidate. The loop looks at only 66 candidates, because each block now names only the seven interface atoms and so forbids every candidate that agrees with this one on nodes 1 to 7. The trace shows it: every block names only `del(1)` to `del(7)`. [Playground: guide-02-ex1]{.play}
:::

::: {.answer #c02-exercise-2-solution}
[Back to Exercise 2](#c02-exercise-2)

```asp
c { q(V) : node(V) } c.
:- q(V), del(V).
:- q(U), q(V), U < V, not edge(U,V).
```

The constant c is set in the Loop tab. Fewer candidates are rejected: the only clique of four nodes is 1, 2, 3, 4, so a candidate is wrong only when it deletes none of them. The loop still looks at all 176 candidates, rejects 42 and reports 134 solutions. [Playground: guide-02-ex2]{.play}
:::

## Learning from a counterexample {#c03}

::: lead
A counterexample usually says much more than "not this candidate". This chapter shows how the check tells the loop what the counterexample depends on, and how one refinement then rules out many candidates at once.
:::

### Look at one counterexample {#c03-look}

Take the candidate that deletes node 1 and nothing else. The check finds the triangle 2, 3, 4:

```{.graph delete="1" clique="2 3 4" caption="Node 1 deleted; the triangle 2, 3, 4 survives."}
Node 1 is crossed out; the triangle 2, 3, 4 is highlighted.
```

The blocking loop of the previous chapter answers with a clause over all ten nodes: "not exactly this deletion set". But look at what the triangle actually needs. It survives because nodes 2, 3 and 4 are not deleted. Whether node 1 or nodes 5 to 10 are deleted does not matter to it at all. Every candidate that keeps 2, 3 and 4 fails in the same way, and there are many of them.

### relevant/1: what the counterexample depends on {#c03-relevant}

The check can say this itself. It derives `relevant(T)` for each interface atom T whose value the counterexample depends on. Such a T is a *relevant atom*. For the triangle, the relevant atoms are the deletions of its three nodes:

```{.asp .changed}
  #show q/1.
+ relevant(del(V)) :- q(V).
```

The loop then makes a different refinement. Instead of blocking, it calls `G.clause(M, X)`: a clause over the relevant atoms only, which asks for at least one of them to change its value. Here all three are false in the candidate, so the clause is

```text
del(2) del(3) del(4)
```

"delete one of these three". In the loop script only one line changes:

```{.loop .changed}
          if X:
-             reject M with G.block(M)
+             reject M with G.clause(M, X)
```

This is the Shape 1 template of the Loop tab; chapter 8 explains the name.

### One point or a region {#c03-region}

Think of the candidates as points. A block removes the one point that was refuted. The clause removes every point in which nodes 2, 3 and 4 all survive: a whole region, and all of it wrong.

```{.diagram caption="The candidate space, one dot per candidate, the solutions as squares. The candidate in the ring was refuted. A block rules out that point; the clause from its triangle rules out the whole shaded region."}
<svg class="diagram" viewBox="0 0 560 230" role="img"
            aria-label="Left: the candidate space with one refuted candidate ruled out. Right: the same space with a whole region of candidates ruled out.">
            <rect class="frame" x="20" y="40" width="250" height="150" rx="6"></rect>
            <circle class="dot" cx="46" cy="60" r="4"></circle>
            <circle class="dot" cx="46" cy="82" r="4"></circle>
            <circle class="dot" cx="46" cy="104" r="4"></circle>
            <circle class="dot" cx="46" cy="126" r="4"></circle>
            <circle class="dot" cx="46" cy="148" r="4"></circle>
            <circle class="dot" cx="46" cy="170" r="4"></circle>
            <circle class="dot" cx="68" cy="60" r="4"></circle>
            <circle class="dot current" cx="68" cy="82" r="4"></circle>
            <circle class="ring" cx="68" cy="82" r="10"></circle>
            <circle class="dot" cx="68" cy="104" r="4"></circle>
            <circle class="dot" cx="68" cy="126" r="4"></circle>
            <circle class="dot" cx="68" cy="148" r="4"></circle>
            <circle class="dot" cx="68" cy="170" r="4"></circle>
            <circle class="dot" cx="90" cy="60" r="4"></circle>
            <circle class="dot" cx="90" cy="82" r="4"></circle>
            <circle class="dot" cx="90" cy="104" r="4"></circle>
            <circle class="dot" cx="90" cy="126" r="4"></circle>
            <circle class="dot" cx="90" cy="148" r="4"></circle>
            <circle class="dot solution" cx="90" cy="170" r="4"></circle>
            <circle class="dot" cx="112" cy="60" r="4"></circle>
            <circle class="dot" cx="112" cy="82" r="4"></circle>
            <circle class="dot" cx="112" cy="104" r="4"></circle>
            <circle class="dot" cx="112" cy="126" r="4"></circle>
            <circle class="dot" cx="112" cy="148" r="4"></circle>
            <circle class="dot" cx="112" cy="170" r="4"></circle>
            <circle class="dot" cx="134" cy="60" r="4"></circle>
            <circle class="dot" cx="134" cy="82" r="4"></circle>
            <circle class="dot" cx="134" cy="104" r="4"></circle>
            <circle class="dot" cx="134" cy="126" r="4"></circle>
            <circle class="dot" cx="134" cy="148" r="4"></circle>
            <circle class="dot" cx="134" cy="170" r="4"></circle>
            <circle class="dot" cx="156" cy="60" r="4"></circle>
            <circle class="dot" cx="156" cy="82" r="4"></circle>
            <circle class="dot" cx="156" cy="104" r="4"></circle>
            <circle class="dot" cx="156" cy="126" r="4"></circle>
            <circle class="dot" cx="156" cy="148" r="4"></circle>
            <circle class="dot" cx="156" cy="170" r="4"></circle>
            <circle class="dot" cx="178" cy="60" r="4"></circle>
            <circle class="dot" cx="178" cy="82" r="4"></circle>
            <circle class="dot" cx="178" cy="104" r="4"></circle>
            <circle class="dot" cx="178" cy="126" r="4"></circle>
            <circle class="dot" cx="178" cy="148" r="4"></circle>
            <circle class="dot" cx="178" cy="170" r="4"></circle>
            <circle class="dot" cx="200" cy="60" r="4"></circle>
            <circle class="dot solution" cx="200" cy="82" r="4"></circle>
            <circle class="dot" cx="200" cy="104" r="4"></circle>
            <circle class="dot" cx="200" cy="126" r="4"></circle>
            <circle class="dot" cx="200" cy="148" r="4"></circle>
            <circle class="dot" cx="200" cy="170" r="4"></circle>
            <circle class="dot" cx="222" cy="60" r="4"></circle>
            <circle class="dot" cx="222" cy="82" r="4"></circle>
            <circle class="dot" cx="222" cy="104" r="4"></circle>
            <circle class="dot" cx="222" cy="126" r="4"></circle>
            <circle class="dot solution" cx="222" cy="148" r="4"></circle>
            <circle class="dot" cx="222" cy="170" r="4"></circle>
            <circle class="dot" cx="244" cy="60" r="4"></circle>
            <circle class="dot" cx="244" cy="82" r="4"></circle>
            <circle class="dot" cx="244" cy="104" r="4"></circle>
            <circle class="dot" cx="244" cy="126" r="4"></circle>
            <circle class="dot" cx="244" cy="148" r="4"></circle>
            <circle class="dot" cx="244" cy="170" r="4"></circle>
            <rect class="frame" x="290" y="40" width="250" height="150" rx="6"></rect>
            <rect class="region" x="304" y="48" width="112" height="90" rx="14"></rect>
            <circle class="dot" cx="316" cy="60" r="4"></circle>
            <circle class="dot" cx="316" cy="82" r="4"></circle>
            <circle class="dot" cx="316" cy="104" r="4"></circle>
            <circle class="dot" cx="316" cy="126" r="4"></circle>
            <circle class="dot" cx="316" cy="148" r="4"></circle>
            <circle class="dot" cx="316" cy="170" r="4"></circle>
            <circle class="dot" cx="338" cy="60" r="4"></circle>
            <circle class="dot current" cx="338" cy="82" r="4"></circle>
            <circle class="dot" cx="338" cy="104" r="4"></circle>
            <circle class="dot" cx="338" cy="126" r="4"></circle>
            <circle class="dot" cx="338" cy="148" r="4"></circle>
            <circle class="dot" cx="338" cy="170" r="4"></circle>
            <circle class="dot" cx="360" cy="60" r="4"></circle>
            <circle class="dot" cx="360" cy="82" r="4"></circle>
            <circle class="dot" cx="360" cy="104" r="4"></circle>
            <circle class="dot" cx="360" cy="126" r="4"></circle>
            <circle class="dot" cx="360" cy="148" r="4"></circle>
            <circle class="dot solution" cx="360" cy="170" r="4"></circle>
            <circle class="dot" cx="382" cy="60" r="4"></circle>
            <circle class="dot" cx="382" cy="82" r="4"></circle>
            <circle class="dot" cx="382" cy="104" r="4"></circle>
            <circle class="dot" cx="382" cy="126" r="4"></circle>
            <circle class="dot" cx="382" cy="148" r="4"></circle>
            <circle class="dot" cx="382" cy="170" r="4"></circle>
            <circle class="dot" cx="404" cy="60" r="4"></circle>
            <circle class="dot" cx="404" cy="82" r="4"></circle>
            <circle class="dot" cx="404" cy="104" r="4"></circle>
            <circle class="dot" cx="404" cy="126" r="4"></circle>
            <circle class="dot" cx="404" cy="148" r="4"></circle>
            <circle class="dot" cx="404" cy="170" r="4"></circle>
            <circle class="dot" cx="426" cy="60" r="4"></circle>
            <circle class="dot" cx="426" cy="82" r="4"></circle>
            <circle class="dot" cx="426" cy="104" r="4"></circle>
            <circle class="dot" cx="426" cy="126" r="4"></circle>
            <circle class="dot" cx="426" cy="148" r="4"></circle>
            <circle class="dot" cx="426" cy="170" r="4"></circle>
            <circle class="dot" cx="448" cy="60" r="4"></circle>
            <circle class="dot" cx="448" cy="82" r="4"></circle>
            <circle class="dot" cx="448" cy="104" r="4"></circle>
            <circle class="dot" cx="448" cy="126" r="4"></circle>
            <circle class="dot" cx="448" cy="148" r="4"></circle>
            <circle class="dot" cx="448" cy="170" r="4"></circle>
            <circle class="dot" cx="470" cy="60" r="4"></circle>
            <circle class="dot solution" cx="470" cy="82" r="4"></circle>
            <circle class="dot" cx="470" cy="104" r="4"></circle>
            <circle class="dot" cx="470" cy="126" r="4"></circle>
            <circle class="dot" cx="470" cy="148" r="4"></circle>
            <circle class="dot" cx="470" cy="170" r="4"></circle>
            <circle class="dot" cx="492" cy="60" r="4"></circle>
            <circle class="dot" cx="492" cy="82" r="4"></circle>
            <circle class="dot" cx="492" cy="104" r="4"></circle>
            <circle class="dot" cx="492" cy="126" r="4"></circle>
            <circle class="dot solution" cx="492" cy="148" r="4"></circle>
            <circle class="dot" cx="492" cy="170" r="4"></circle>
            <circle class="dot" cx="514" cy="60" r="4"></circle>
            <circle class="dot" cx="514" cy="82" r="4"></circle>
            <circle class="dot" cx="514" cy="104" r="4"></circle>
            <circle class="dot" cx="514" cy="126" r="4"></circle>
            <circle class="dot" cx="514" cy="148" r="4"></circle>
            <circle class="dot" cx="514" cy="170" r="4"></circle>
            <text x="145" y="28" text-anchor="middle">Block: one point</text>
            <text x="415" y="28" text-anchor="middle">Clause: a region</text>
            <text class="small" x="145" y="212" text-anchor="middle">only the refuted candidate</text>
            <text class="small" x="415" y="212" text-anchor="middle">every candidate that keeps the triangle</text>
          </svg>
```

### Everything relevant is blocking again {#c03-relevant-all}

What if the check marks every interface atom as relevant?

```asp
relevant(del(V)) :- node(V).
```

::: listing-source
From the fragment `check` of `guide-03-relevant-all`.
:::

Then the clause names all ten atoms and asks for one of them to change: that is exactly the block. The run gives the numbers of the blocking loop, candidate for candidate. [Playground: guide-03-relevant-all]{.play}

So `relevant/1` is a dial. Marking everything gives the block, which is safe and learns nothing. Marking less makes each refinement stronger. The next chapter shows what happens when you mark too little.

### The learning loop {#c03-hit-clique}

Now run the loop with the triangle's three nodes marked. [Playground: guide-03-hit-clique]{.play}

::: {.predict #c03-predict-1}
Predict: the blocking loop looked at 176 candidates. About how many will this loop need? [Answer](#c03-predict-1-answer)
:::

| Loop | Candidates | Refinements | Mean clause length | Solutions |
|---|---:|---:|---:|---:|
| Blocking | 176 | 173 | 10.0 | 3 |
| Everything relevant | 176 | 173 | 10.0 | 3 |
| The triangle's nodes | 13 | 10 | 3.0 | 3 |

Same solutions, far fewer candidates, short clauses. In the trace you may notice that the same triangle comes back more than once: there are 10 counterexamples for seven triangles. That is the solver's doing, not the design's; chapter 5 explains it.

### Why this clause is right {#c03-why-sound}

The clause "delete 2, 3 or 4" removes many candidates the check has never seen. Why is that allowed? Because every solution satisfies it. A solution leaves no triangle, so in particular it does not leave 2, 3, 4; so it deletes one of them. The clause removes only candidates that are not solutions.

This argument is the heart of designing a refinement: *every solution satisfies the refinement*. Make it for every refinement you write, before you run anything. For a clause made by `relevant/1` it takes this form: if the relevant atoms keep their values, the counterexample is still a counterexample, whatever the other atoms do.

::: theory
**Theory**

The solutions are the *hitting sets* of size at most k of the set of triangles: sets of nodes that meet every triangle. Each clause adds one triangle to hit. The loop discovers triangles only when a candidate misses them, so on a large graph it may never list most of them.

The loop terminates: each refinement rules out at least the current candidate (the candidate deletes none of the triangle's nodes, so it violates the clause), and there are finitely many candidates.
:::

::: exercise
### Exercise 1 {#c03-exercise-1}

The first candidate of the learning loop is the empty set: nothing deleted. Which refinements could the check produce for it? How many candidates (for k = 3) does each rule out? Then open the run and look at the first three steps of the trace.

[Solution](#c03-exercise-1-solution)
:::

::: exercise
### Exercise 2 {#c03-exercise-2}

Raise k to 4 and then to 5 in the Loop tab, for the blocking loop and for the learning loop. How do the numbers of candidates grow?

[Solution](#c03-exercise-2-solution)
:::

::: recap
### Recap

- []{#c03-rule-mark-dependencies}Mark with `relevant/1` the interface atoms the counterexample depends on, and no others. The refinement then rules out every candidate that agrees on them.
- []{#c03-rule-every-solution-satisfies}For every refinement, argue that every solution satisfies it. If the relevant atoms keep their values, the counterexample must still be one.
- []{#c03-rule-all-relevant-blocks}Marking every interface atom is blocking: safe, and no faster.
:::

### Answers {#c03-answers .answers}

::: {.answer #c03-predict-1-answer}
[Back to the question](#c03-predict-1)

13\. The graph has only seven triangles, and each clause rules out every candidate that keeps one of them.
:::

::: {.answer #c03-exercise-1-solution}
[Back to Exercise 1](#c03-exercise-1)

Every triangle survives the empty set, so the check may return any of the seven, and the clause says "delete one of its three nodes". Each such clause rules out the sets of at most three nodes taken from the other seven nodes: 1 + 7 + 21 + 35 = 64 candidates. In this run the first three counterexamples are the triangles 1, 2, 4; then 2, 3, 4 (for the candidate that deletes 1); then 4, 5, 6 (for the candidate that deletes 1 and 2). [Playground: guide-03-hit-clique]{.play}
:::

::: {.answer #c03-exercise-2-solution}
[Back to Exercise 2](#c03-exercise-2)

| k | Blocking: candidates | Learning: candidates | Learning: refinements | Solutions |
|---|---:|---:|---:|---:|
| 3 | 176 | 13 | 10 | 3 |
| 4 | 386 | 65 | 20 | 45 |
| 5 | 638 | 197 | 24 | 173 |

The blocking loop looks at every candidate. The learning loop's candidates are mostly solutions now, since there are many more of them; what it needs on top of them, the refinements, grows only slowly. Each solution has to be found anyway. [Playground: guide-03-hit-clique]{.play}
:::

## Soundness: when a refinement says too much {#c04}

::: lead
Marking fewer atoms relevant makes a refinement stronger, and the loop faster. Mark too few and the refinement removes solutions. Nothing warns you. This chapter shows the mistake, how to catch it, and a real case.
:::

### A refinement that is too strong {#c04-too-strong}

A refinement is *too strong* when some solution violates it. The loop then never proposes that solution again, and so never reports it. The run finishes normally, with outcome finished and the search exhausted, and lists fewer solutions than there are. No error, no warning.

Since the clause from `relevant/1` asks for one of the relevant atoms to change, a clause gets stronger as fewer atoms are marked. Too strong means: the check marked too little.

### A plausible mistake {#c04-one-node}

Here is a tempting shortcut for the running example. A triangle must lose a node; why not say which one? Delete the busiest node, the one with the most edges, since that breaks the most triangles. The check marks just that node:

```asp
deg(V,D) :- node(V), D = #count { W : edge(V,W) ; W : edge(W,V) }.
busier(V) :- q(V), q(W), deg(V,D), deg(W,E), (E,W) > (D,V).
relevant(del(V)) :- q(V), not busier(V).
```

::: listing-source
From the fragment `check` of `guide-04-one-node`.
:::

On a tie the node with the larger number counts as busier. Each refinement is now a clause with one literal: "this node must go". [Playground: guide-04-one-node]{.play}

::: {.predict #c04-predict-1}
Predict: the problem has 3 solutions. How many will this loop report? [Answer](#c04-predict-1-answer)
:::

```{.graph delete="1 4 8" caption="A solution the loop lost: delete 1, 4 and 8. No triangle survives, but the first refinement demanded node 3."}
Nodes 1, 4 and 8 are crossed out; no triangle is left.
```

Try the argument of the previous chapter on the clause "delete 3": does every solution satisfy it? No. If node 3 stays, the triangle 1, 2, 3 can still be broken by deleting 1 or 2. The counterexample depends on all three nodes, and the check marked one.

### The soundness test {#c04-test}

You cannot see a missing solution in the output. You can only compare. The blocking loop of chapter 2 is the ground truth: it is sound for any check that is right. So run both on the same instance and compare the counts:

- the same fragments and constants;
- all solutions (Solutions: all, in the run bar);
- both runs exhausted;
- the same number of solutions, or the faster loop is wrong.

In the playground the two loops are the same project with one line of the loop script changed:

```{.loop .changed}
          if X:
-             reject M with G.clause(M, X)
+             reject M with G.block(M)
```

The run history at the foot of the Statistics tab now has two rows for the same fragments, both exhausted, with different counts, and marks both with ⚠: one of the two loops is unsound. Keep the fragments unchanged between the two runs; the history compares only runs of the same fragments. [Playground: guide-04-one-node]{.play}

The test only works where the blocking loop finishes, so use small instances. That is rarely a limit: a mistake in `relevant/1` usually shows on small instances already.

### The audit: every counterexample at once {#c04-audit}

The comparison only sees the counterexamples that one run happens to meet. The **Audit** sees them all: it lists every candidate of the abstraction and every counterexample of each, and asks of every refinement the loop would make whether it removes a solution. Its verdict does not depend on the search order, and when it is "unsound" it comes with a witness.

For the loop that marks one node the witness is a candidate that deletes 4 and 8, its counterexample the triangle 1, 2, 3, and the relevant set "delete 3". The solution that deletes 1, 4 and 8 agrees with the candidate on node 3, so the clause removes it too. The two differ on node 1 only: the node that should have been relevant. [Playground: guide-04-one-node]{.play}

The audit lists every candidate, so like the blocking loop it needs a small instance. Blocks and cores need no audit (they are sound by construction); clauses written in ASP (`G.clauses`) are audited like relevant sets.

[]{#c04-symbolic}The **symbolic audit** asks the audit's question without the list. It searches for three things at once: a candidate, a counterexample of it, and a solution that the counterexample's clause removes. When the search finds none, every refinement is sound on the instance; when it finds one, that is the witness, with as few differing atoms as the audit's. It runs a small loop of its own: a triple whose "solution" turns out to have a counterexample after all is ruled out, and the search goes on. On a correct relevant set it usually needs a single search, so it also answers for instances far too large to enumerate. It is optional: the audit stays the default.

### Every instance up to a bound {#c04-bounded}

Both audits judge one instance. A **space** describes a whole family: a few choice rules over the instance's predicates, with a bound k. "Every graph on the nodes 1..k" is `node(1..k). { edge(U,V) : node(U), node(V), U < V }.` The symbolic audit can leave the instance free inside such a space, and checking k = 1, 2, … in turn gives a verdict for *every* instance of the space up to the bound: **sound up to k**, or the smallest instance on which a refinement removes a solution.

The tutorial's sum-free sets have the space "n = 1, 2, …". The correct relevant set is sound up to n = 10 (and further); the too weak one first loses a solution at n = 2, exactly where the audit over n = 1, 2, … first fails. For a graph problem the space can be every graph on k nodes: the clique-colouring example's strategy is sound on every graph with up to 12 nodes, more than 10^19^ graphs, checked in seconds.

What "sound up to k" does not say: anything about k + 1, or about instances the space leaves out (no self-loops, one query, only two players). It is strong evidence, not a proof. Write the space so that it contains the small instances where your relevant set could go wrong, and keep the bound where each step still takes seconds.

### One instance is not enough {#c04-instances}

Which solutions a too-strong refinement removes depends on which counterexamples the check happens to return, and so on the search order, the loop shape and the instance. A wrong loop can lose nothing on one instance and lose many on the next. Apply the soundness test to several small instances, and to several values of the constants.

The playground keeps them together. The Instances tab holds the instances of one project, each with its expected count; **Run all instances** marks every count that differs. **Fuzz** audits instances from small to large, stops at the first unsound one and shrinks it. A campaign (Campaign tab, an Advanced tab) runs your loop and the blocking loop, as a variant, over a grid of instances, and marks every instance where the two disagree.

### Too weak and too strong {#c04-both-ways}

Marking too much is safe but slow: at the far end it is blocking. Marking too little is fast but wrong. Aim for exactly the atoms the counterexample depends on.

Remember both values. A counterexample can depend on an atom being *false* as well as on one being true. In the running example, the triangle depends on three deletions being false. In the next example, a colouring depends on an edge being absent: add the edge, and the colouring may break.

### A true story: leaf colouring {#c04-story}

The problem: find connected graphs on n nodes, with a colouring of their leaves (nodes with one neighbour) in three colours, such that no proper 3-colouring of the whole graph agrees with the leaf colours. The abstraction guesses the graph and the leaf colours; the check looks for a proper 3-colouring that agrees, which is the counterexample. The example comes from an earlier prototype of the same loop, and its check marked these atoms:

```asp
relevant(edge(N,M)) :- node(N), node(M), N < M, not edge(N,M).
relevant(leaf_color(N,C)) :- leaf_color(N,C), leaf(N).
```

::: listing-source
The first two `relevant/1` rules of the fragment `check` of `graph-coloring`.
:::

Missing edges are relevant, because adding one can break the colouring. Leaf colours are relevant, because changing one can too. It looks complete. It is not: removing an edge can turn a node into a leaf, and if its new leaf colour differs from its colour in the counterexample, the counterexample breaks. The fix marks those atoms too:

```asp
relevant(leaf_color(N,C)) :- node(N), not leaf(N), color(C), not color(N,C).
```

::: listing-source
From the fragment `check` of `graph-coloring`.
:::

Without the fix, n = 5 gives the same count as the blocking loop's 101. Nothing to see. At n = 6 the rules without the fix give 9,270 solutions, the fixed rules 10,698, and so does the blocking loop. The mistake shows from n = 6 on. [Playground: graph-coloring]{.play} [Playground: gc-reference]{.play}

::: pitfall
**Pitfall: skipping the soundness test**

A too-strong refinement shows only as missing solutions. Make the test a routine: whenever you change `relevant/1`, the glue or the loop, run the blocking loop and the new loop with all solutions on a few small instances and compare the counts. A row marked ⚠ in the run history means stop and look.
:::

::: theory
**Letting the playground find the relevant atoms**

Write `lift` after a link's fragments (`link G = A -> C via shared + glue lift`) and `G.clause(M, X)` computes its set from the ground programs instead of from `relevant/1`, keeping only atoms it can prove necessary. It is slower, but it never removes a solution, so it is a good check of a hand-written set: the Statistics tab compares the two. See "Refinement variants" in the manual.
:::

::: tool-moment
### Tool moment: seeing the lost solution

The audit names one witness. To see every candidate at once, the Observatory's **Candidate space** draws one square per candidate of the unrefined abstraction and marks the solutions a refinement removed; its blame matrix shows which atoms each clause relies on. The map shows one run; when its search avoids the bad refinement, **Find a run that loses one** tries seeds until a run does not. When the instance is large, **Fuzz** (Instances tab) audits instances from small to large and shrinks the first unsound one to a handful of facts. The how-to hunting an unsound refinement walks through both on this chapter's example.

To see what the right clause would have been, the **Refinement lab** (the Lab tab, a switch under Tabs in the Control tab) takes the witness candidate and lists every clause the loop could make there: which are sound, how much each removes, and the smallest sound one. It also names the **forced** atoms, those every sound clause must contain, each with the solution that differs from the candidate only there. A forced atom that `relevant/1` did not mark is the atom this chapter's test looks for.
:::

::: exercise
### Exercise 1 {#c04-exercise-1}

Name both solutions that the loop marking one node loses, and the refinement that removed each.

[Solution](#c04-exercise-1-solution)
:::

::: exercise
### Exercise 2 {#c04-exercise-2}

In the leaf-colouring example, delete its third `relevant/1` rule and, without looking back at the fix above, write it again yourself. Ask: which change of the candidate, not covered by the two rules, breaks the counterexample? Then compare with the blocking loop `gc-reference` at n = 6 (set n in its Loop tab; that run takes a while).

[Solution](#c04-exercise-2-solution)
:::

::: recap
### Recap

- []{#c04-rule-too-strong-is-silent}A refinement that is too strong removes solutions without any sign. The run still finishes, exhausted.
- []{#c04-rule-soundness-test}Test soundness by comparison: the blocking loop and your loop, same fragments and constants, all solutions, both exhausted, same count.
- []{#c04-rule-audit}Audit a small instance: it checks every refinement against every solution, and its witness names the atom that should have been relevant.
- []{#c04-rule-several-instances}Apply the test to several small instances: a wrong loop can be right on one.
- With a space, check every instance up to a bound at once: "sound up to k" covers the whole family below k, and nothing beyond it.
- []{#c04-rule-both-polarities}A counterexample can depend on an atom being false. Mark it too.
:::

### Answers {#c04-answers .answers}

::: {.answer #c04-predict-1-answer}
[Back to the question](#c04-predict-1)

1, after only 4 candidates. The first counterexample is the triangle 1, 2, 3. All three nodes have three edges, so the tie goes to node 3, and the refinement is "delete 3". The solutions that delete 1 or 2 instead violate it and are gone.
:::

::: {.answer #c04-exercise-1-solution}
[Back to Exercise 1](#c04-exercise-1)

Deleting 1, 4, 8 and deleting 2, 4, 8. Both violate the first refinement, "delete 3", made from the triangle 1, 2, 3. The other two refinements, "delete 4" and "delete 8", happen to be satisfied by every solution, which is why one solution survives. The blocking loop finds all three. [Playground: guide-02-block]{.play}
:::

::: {.answer #c04-exercise-2-solution}
[Back to Exercise 2](#c04-exercise-2)

Removing an edge can make a node a leaf, and its leaf colour then has to match its colour in the counterexample. So the leaf colours other than the node's colour are relevant for every node that is not a leaf yet:

```asp
relevant(leaf_color(N,C)) :- node(N), not leaf(N), color(C), not color(N,C).
```

With it the loop finds 10,698 solutions at n = 6, as the blocking loop does. [Playground: graph-coloring]{.play}
:::

## Reading a run {#c05}

::: lead
A run leaves a record: the trace, the statistics, the run history. This chapter moves the running example to a larger graph and shows how to read that record, so that you can tell a good design from a poor one by its numbers.
:::

### A larger graph {#c05-paley}

From now on the running example uses the *Paley graph* on n nodes, for n a prime of the form 4m + 1. Its nodes are 0 to n − 1, and two nodes are joined when their difference is a square modulo n. It is defined by three rules in `shared`, so the size is one constant:

```asp
node(0..n-1).
square((X*X) \ n) :- X = 1..n-1.
edge(U,V) :- node(U), node(V), U < V, square((V-U) \ n).
```

::: listing-source
From the fragment `shared` of `guide-05-paley-clause`.
:::

The check now looks for a clique of c nodes, with c a constant too. The defaults are n = 13, k = 6, c = 3: delete six of thirteen nodes so that no triangle is left. The loops are those of chapters 2 and 3.

The blocking loop is the ground truth for chapters 5 to 8. [Playground: guide-05-paley-block]{.play}

The learning loop marks the clique's nodes as relevant, as in chapter 3. [Playground: guide-05-paley-clause]{.play}

| Loop | Instance | Candidates | Refinements | Solutions |
|---|---|---:|---:|---:|
| Blocking | n = 13, k = 6 | 4,096 | 4,057 | 39 |
| Learning | n = 13, k = 6 | 96 | 57 | 39 |
| Blocking | n = 17, k = 9 | 90,793 | 90,742 | 51 |
| Learning | n = 17, k = 9 | 185 | 134 | 51 |

To try the larger instance, set n = 17 and k = 9 in the Constants table of the Loop tab. The blocking loop takes a few seconds there; at n = 29 it would never finish, while the learning loop does (try n = 29, c = 4, k = 13: 2,436 solutions from 3,086 candidates). Beyond the blocking loop's reach, the soundness test of chapter 4 is no longer possible: test on the small instances, then scale.

### The trace, step by step {#c05-trace}

The first steps of the trace of the learning loop (the Output tab of the playground) are:

| Step | Candidate | Counterexample | Refinement |
|---|---|---|---|
| 1 | (nothing deleted) | `q(1) q(10) q(11)` | `del(1) del(10) del(11)` |
| 2 | `del(1)` | `q(3) q(4) q(7)` | `del(3) del(4) del(7)` |
| 3 | `del(1) del(3)` | `q(4) q(5) q(8)` | `del(4) del(5) del(8)` |

Read each step as a question and an answer. The *candidate* lists the true interface atoms. The *counterexample* is what the check found: a triangle none of whose nodes is deleted. The *refinement* lists the clause's literals; in the Output tab the candidate's atoms that the refinement names are highlighted. Each candidate satisfies all the clauses before it: step 2 deletes node 1, as step 1 demanded.

When something goes wrong, the trace is where you look first. A refinement that names the wrong atoms, or none, is visible at the first step it happens.

### The Statistics tab {#c05-statistics}

The Statistics tab summarises the whole run:

- **Summary**: candidates, counterexamples, refinements, solutions. Here every candidate is either a solution or has a counterexample, so candidates = counterexamples + solutions.
- **Solvers**: per solver the calls, satisfiable and unsatisfiable answers, solving time and grounding time. Solver A is called once: Shape 1 runs one search. Solver C is called once per candidate, 96 times.
- **Refinements**: the number of clauses, their mean and largest length, and a histogram of clause lengths. All clauses here have length 3; the blocking loop's have length 13, one literal per node.
- **Charts**: candidates and refinements over time, and the time split between the solvers and grounding.
- **Run history**: one row per finished run; the row marked ▶ is the run whose results the tabs show.

All of this belongs to one run: the line **Shown:** under the run bar names it (a run or an audit, its instance and variant, how much was recorded), and turns amber once the project is edited, since the results on screen are then of the earlier version. After an audit the Summary holds the audit's own figures, not the loop's.

### What a good run looks like {#c05-good-run}

- **Short clauses.** A clause of length l rules out more candidates the smaller l is. Clause lengths close to the number of interface atoms mean blocking in disguise.
- **Few candidates per solution.** Every solution has to be proposed once. The candidates beyond the solutions are what the loop pays to learn; compare them with the number of refinements.
- **No solver dominates without reason.** If the check takes most of the time, each check should earn more (chapter 6). If the abstraction does, it may be searching blindly for something it could know in advance (chapter 7).

On the larger instances the learning loop does well on all three counts.

### A note on enumeration {#c05-record}

The learning run has 57 counterexamples, but the Paley graph on 13 nodes has only 26 triangles, and the trace shows some of them over and over (the triangle 0, 9, 10 most often). The design is not at fault. While clasp enumerates answer sets, its default mode keeps clauses added during the search only weakly, so a later candidate may violate one; the check then finds the same triangle again. The result stays right, because every candidate is checked.

The option `--enum-mode=record` on solver A keeps the clauses firmly:

```{.loop .changed}
- solver A = shared + abstraction
+ solver A = shared + abstraction    options "--enum-mode=record"
```

::: {.predict #c05-predict-1}
Predict: the clause loop needed 96 candidates. With `--enum-mode=record`, more, fewer, or the same? And the solutions? [Answer](#c05-predict-1-answer)
:::

It changes the number of candidates, never the solutions: 84 instead of 96 at n = 13, but 186 instead of 185 at n = 17. Worth a try, not a rule. [Playground: guide-05-paley-record]{.play}

[]{#c05-lab}How long could a run of these refinements be? The **Refinement lab** (the Lab tab) answers on a small instance: the shortest and the longest run its refinements allow, and the lengths of runs that take the candidates in random order. Placed among them, a recorded run shows where its length comes from: how many bad candidates the abstraction admits, how many refinements a better `relevant/1` could save, and how many the order cost. Refinements of candidates that an earlier clause had already removed, the effect described above, are counted there.

The templates also give the check the option `--heuristic=Domain`. It makes clingo follow `#heuristic` statements in the check, which can steer which counterexample it finds; chapter 6 uses that. Without such statements it only changes the order of clasp's choices. The manual's section Settings lists the options.

::: tool-moment
### Tool moment: where the time goes

The Statistics tab says how much time each solver took; the Observatory's **timeline** says when, one bar per solver call, and its **cost per line** table charges every call to the line of the loop script that made it. On the Paley graph the blocking loop makes 4,096 calls of the check inside one search of the abstraction, the learning loop 96: the timeline shows where each of them went. The how-to finding where the time goes turns this into a procedure.
:::

::: exercise
### Exercise 1 {#c05-exercise-1}

Without looking at the trace, how many distinct counterexamples can the learning run at n = 13 have at most? Then find, in the trace, a step whose counterexample an earlier step already returned, and check that its candidate violates the earlier clause.

[Solution](#c05-exercise-1-solution)
:::

::: exercise
### Exercise 2 {#c05-exercise-2}

Your loop takes twice the time you can give it. What do you change first, and which statistic tells you?

[Solution](#c05-exercise-2-solution)
:::

::: exercise
### Exercise 3: a fresh problem, 2QBF {#c05-exercise-fresh}

The starter solves the 2QBF of the library example `qbf` (exists x forall y, a formula in disjunctive normal form) by blocking. Read its run as this chapter does: how many candidates, how long are the clauses, and what would a good run look like? Then write a `relevant/1` rule for the check. [Playground: guide-05-ex2-qbf-block]{.play}

[Solution](#c05-exercise-fresh-solution)
:::

::: recap
### Recap

- []{#c05-rule-read-trace}Read the first steps of the trace: candidate, counterexample, refinement. Mistakes in a refinement show there first.
- []{#c05-rule-good-run}A good run has short clauses, few candidates beyond the solutions, and no solver that dominates without reason.
- []{#c05-rule-test-small-then-scale}Test soundness where the blocking loop finishes; scale only afterwards.
- []{#c05-rule-options-change-counts}Solver options can change the number of candidates, never the solutions of a sound loop.
:::

### Answers {#c05-answers .answers}

::: {.answer #c05-predict-1-answer}
[Back to the question](#c05-predict-1)

Fewer: 84, because no clause is forgotten and no triangle is found twice. The solutions stay 39: the enumeration mode changes how much a clause prunes, never what is a solution.
:::

::: {.answer #c05-exercise-1-solution}
[Back to Exercise 1](#c05-exercise-1)

At most 26, one per triangle; the run has 57, so many come back. The triangle 0, 9, 10 is the most frequent. Every candidate that returns it deletes none of 0, 9 and 10, so it violates the clause "delete 0, 9 or 10" learnt the first time: the clause was kept only weakly. [Playground: guide-05-paley-clause]{.play}
:::

::: {.answer #c05-exercise-2-solution}
[Back to Exercise 2](#c05-exercise-2)

Look at the Solvers table before changing anything. If the check takes most of the time, make each check earn more, or make it cheaper. If the abstraction does, give it more knowledge in advance, or try another loop shape. If candidates far outnumber solutions and clauses are long, the refinements are too weak: look at `relevant/1`. If grounding dominates, the program, not the loop, is the problem. Try it on the learning loop at n = 29, c = 4, k = 13. [Playground: guide-05-paley-clause]{.play}
:::

::: {.answer #c05-exercise-fresh-solution}
[Back to Exercise 3: a fresh problem, 2QBF](#c05-exercise-fresh)

Blocking looks at all 64 assignments of the six x-variables with clauses of 6.0 literals: every refinement names every variable, the sign of a weak refinement. A counterexample (a y-assignment that falsifies every term) stays one while every open term keeps a false x-literal, so those literals are relevant: `relevant(x(I)) :- bad(T,I), not closed(T).` The library example then needs 15 candidates with clauses of 2.8 literals, and finds the same 5 solutions. Chapter 13 takes this problem further. [Playground: qbf]{.play}
:::

## Getting more out of each check {#c06}

::: lead
A check is a solver call, and each one should teach the abstraction as much as it can. This chapter shows three ways to get more out of it: several counterexamples per candidate, better counterexamples, and clauses the check writes itself.
:::

### Several counterexamples per candidate {#c06-several}

A wrong candidate usually has more than one counterexample: several cliques survive. The check can return more than one, and each gives a clause:

```loop
search A:
    on candidate M:
        for X in C.models(assume G(M), limit 3):
            reject M with G.clause(M, X)
```

::: listing-source
From the loop script of `clique-interdiction`.
:::

`C.models(…, limit 3)` enumerates up to three answer sets of the check. The candidate is rejected once; all the clauses are added. The library example `clique-interdiction` is exactly the running example with this loop. [Playground: clique-interdiction]{.play}

| Counterexamples per candidate | Candidates (n = 13) | Refinements (n = 13) | Candidates (n = 17) | Refinements (n = 17) |
|---|---:|---:|---:|---:|
| 1 | 96 | 57 | 185 | 134 |
| up to 3 | 68 | 42 | 124 | 115 |

Fewer candidates, so fewer check calls. But each call now enumerates up to three answer sets, and the refinements per candidate go up. Whether that pays depends on how expensive a check is compared with a candidate. Here both are cheap, and the gain is in candidates only. Measure it on your own problem; exercise 1 asks how far to go.

### Side trip: explanations {#c06-reasons}

Not all counterexamples are equally good. To see why, leave the graph for a moment. A classifier (here a small neural network over eight binary features) answers yes or no on an input. A *sufficient reason* for its answer is a set of features such that every input that agrees with the given one on those features gets the same answer. We look for sufficient reasons of at most k = 4 features.

That is "there is a set of features such that for all inputs …", the shape of chapter 1. The abstraction guesses `keep(F)` for at most k features. The check looks for an input that agrees on the kept features and gets the other answer:

```asp
differs(F) :- is(F,1), not x(F).
differs(F) :- is(F,0), x(F).
#show x/1.
#show differs/1.
```

::: listing-source
From the fragment `check` of `guide-06-reason-clause`.
:::

The counterexample input refutes every set of kept features on which it agrees with the given input, so the refinement says: keep one of the features on which it differs.

```asp
relevant(keep(F)) :- differs(F).
```

The fewer features the counterexample differs on, the shorter and stronger the clause. A counterexample that differs everywhere teaches almost nothing.

### Asking for the best counterexample {#c06-smallest}

So ask the check for a counterexample that differs on as few features as possible: a `#minimize` in the check, and `optimal` in the loop, so that `C.solve` returns an optimal answer set.

```{.asp .changed}
  relevant(keep(F)) :- differs(F).
+ #minimize { 1,F : differs(F) }.
```

```{.loop .changed}
-         X = C.solve(assume G(M))
+         X = C.solve(assume G(M), optimal)
```

::: {.predict #c06-predict-1}
Predict: one clause per counterexample needed 29 candidates. If every counterexample is a smallest one, how many? [Answer](#c06-predict-1-answer)
:::

[Playground: guide-06-reason-smallest]{.play}

| Loop | Candidates | Refinements | Mean clause length | Solutions |
|---|---:|---:|---:|---:|
| Blocking | 163 | 150 | 8.0 | 13 |
| Any counterexample | 29 | 16 | 2.3 | 13 |
| Smallest counterexample | 22 | 9 | 2.0 | 13 |

Shorter clauses, fewer of them. The cost is an optimisation inside every check, which on a hard check can be much more than one answer set. The two other loops: [Playground: guide-06-reason-block]{.play} [Playground: guide-06-reason-clause]{.play}

### Clauses the check writes itself {#c06-clauses}

With `relevant/1` the check chooses atoms, and the loop builds one clause: one of them must change. Sometimes you want something else, for instance several clauses from one answer set. Then the check derives the clauses itself, as `clause(Id, Atom, Value)`: the atoms with one Id form a clause, and "Value" is the value the atom should get. The loop reads them with `G.clauses(X)`.

On the running example: let one answer set of the check hold up to two different surviving cliques, and write one clause per clique.

```asp
clique(1). { clique(2) }.
#heuristic clique(2). [1,true]
c { q(I,V) : node(V) } c :- clique(I).
:- q(I,V), del(V).
:- q(I,U), q(I,V), U < V, not edge(U,V).
:- clique(2), q(2,V) : q(1,V).
#show q/2.

% One clause per clique: one of its nodes must be deleted.
clause(I, del(V), true) :- q(I,V).
```

::: listing-source
From the fragment `check` of `guide-06-clauses`.
:::

Marking both cliques with `relevant/1` would give one clause of length six, much weaker than two of length three. The `#heuristic` makes the check try for the second clique first; clingo follows it because the check runs with `--heuristic=Domain`. Without that option the solver never bothers, and you get one clique per answer set again. [Playground: guide-06-clauses]{.play}

It works: 77 candidates instead of 96, with 49 clauses from 38 counterexamples. But be honest with yourself: `C.models(…, limit 3)` above did as well with less effort. Use `clause/3` when the clause you need cannot be said with `relevant/1`, or when a clause must be built from the counterexample alone; chapter 8 needs it for the second reason.

### A solver for the refinement {#c06-second-solver}

When the refinement needs a search of its own, for instance the smallest set of atoms that explains a counterexample, a third solver can compute it from the candidate and the counterexample together. The library example `lang-second-solver` shows the loop. [Playground: lang-second-solver]{.play}

::: exercise
### Exercise 1 {#c06-exercise-1}

Change the limit in `clique-interdiction` to 30. Do more counterexamples per candidate keep paying? Try n = 13, k = 6 and n = 17, k = 9.

[Solution](#c06-exercise-1-solution)
:::

::: exercise
### Exercise 2 {#c06-exercise-2}

The `#minimize` changes which counterexample the check returns. Why can that never make the loop unsound?

[Solution](#c06-exercise-2-solution)
:::

::: exercise
### Exercise 3: a fresh problem, preferred extensions {#c06-exercise-fresh}

The starter looks for preferred extensions of an argumentation framework that leave out a query argument, blocking each refuted candidate. A counterexample is a larger admissible set. What could one check say about more than one candidate, and can it give more than one clause? [Playground: guide-06-ex2-af-block]{.play}

[Solution](#c06-exercise-fresh-solution)
:::

::: recap
### Recap

- []{#c06-rule-several-cex}Several counterexamples per candidate save candidates and cost check work; measure the trade.
- []{#c06-rule-small-cex}A counterexample that depends on few atoms gives a short, strong clause. Ask for it with `#minimize` and `optimal` when checks are cheap.
- []{#c06-rule-clause3}Write the clauses in the check with `clause/3` when `relevant/1` cannot say what you need.
:::

### Answers {#c06-answers .answers}

::: {.answer #c06-predict-1-answer}
[Back to the question](#c06-predict-1)

22\. Each clause names fewer features (on average 2.0 instead of 2.3), so it rules out more candidates; the solutions are the same 13.
:::

::: {.answer #c06-exercise-1-solution}
[Back to Exercise 1](#c06-exercise-1)

At n = 13, up to 30 brings the candidates down to 40. At n = 17 it needs 111, hardly better than 124 for 3, while each check enumerates more. The counts do not fall smoothly: which cliques come first depends on the search. Most of the gain comes with the first extra counterexamples; beyond that, measure before you pay. [Playground: guide-06-ex1]{.play}
:::

::: {.answer #c06-exercise-2-solution}
[Back to Exercise 2](#c06-exercise-2)

Every answer set of the check is a counterexample, and the clause made from any counterexample is satisfied by every solution (chapter 3). The minimisation only picks one of them. The same holds for the `#heuristic` of the two-clique check, and for solver options in general. [Playground: guide-06-reason-smallest]{.play}
:::

::: {.answer #c06-exercise-fresh-solution}
[Back to Exercise 3: a fresh problem, preferred extensions](#c06-exercise-fresh)

A larger admissible set S refutes every candidate that it contains, as long as the candidate leaves S somewhere it still could. The library example writes its refinement as `clause/3` atoms: leave the larger set somewhere, or contain all of it, which is several clauses from one check (`G.clauses`). It needs 13 candidates where blocking needs 36, with the same 3 solutions. [Playground: af-preferred]{.play}
:::

## Designing the abstraction {#c07}

::: lead
So far the abstraction was a bare guess, and the check taught it everything. This chapter asks what the abstraction should know in advance, which atoms it should share with the check, and what it must never contain.
:::

### The loop learns what the abstraction does not know {#c07-know}

Every refinement teaches the abstraction one fact about the solutions. If a fact is cheap to state and true of every solution, there is no need to learn it at run time: write it into the abstraction. The loop then has less to learn, and the abstraction proposes fewer wrong candidates.

The rule for what may go in is the rule for refinements: every solution must satisfy it. The abstraction must still over-approximate.

### A dial from pure loop to no loop {#c07-spectrum}

On the running example, the triangles themselves are such facts. A constant m puts the constraint "this triangle does not survive" into the abstraction for every triangle among the nodes below m:

```asp
:- node(U), node(V), node(W), U < V, V < W, W < m,
   edge(U,V), edge(V,W), edge(U,W), not del(U), not del(V), not del(W).
```

::: listing-source
From the fragment `abstraction` of `guide-07-spectrum` (written for c = 3).
:::

::: {.predict #c07-predict-1}
Predict: the constant m puts the triangles among the first m nodes into the abstraction. With m = 13, every node of the graph, how many counterexamples will the check find? [Answer](#c07-predict-1-answer)
:::

With m = 0 the abstraction knows nothing, and this is the learning loop of chapter 5. With m = n it knows every triangle: every candidate is a solution, and the check only confirms. In between, it knows some. [Playground: guide-07-spectrum]{.play}

| m | Rules of A | Candidates | Refinements | Solutions |
|---|---:|---:|---:|---:|
| 0 | 63 | 96 | 57 | 39 |
| 5 | 65 | 84 | 45 | 39 |
| 9 | 73 | 67 | 28 | 39 |
| 13 | 89 | 39 | 0 | 39 |

The rules of A are those after grounding (Statistics tab, Solvers). Each step of the dial trades ground program for refinements. On this graph the whole program is tiny, so m = n wins: that is the plain single program, possible here because a triangle can be listed in advance. It stops being possible when what the check looks for cannot be listed: cliques of a size c given as input in a large graph grow too fast, and in other problems (the 3-colourings of chapter 4, the inputs of chapter 6) the counterexamples are far too many. Put into the abstraction what is cheap to list and often needed; leave the rest to the loop.

### Interface atoms need not be the guessed atoms {#c07-derived}

The glue decides what the check sees, and so what a refinement can talk about. It does not have to be the atoms the abstraction guesses. If the check depends only on some derived property of the candidate, glue that property instead.

The library example `subset-sum-game` picks a set of numbers; the check asks whether some other numbers make up the difference to a target. The check needs only the sum of the picked numbers, so the abstraction derives `xsum(S)` and the glue shares just that:

```asp
glue(xsum(S)) :- S = 0..M, M = #sum { W,I : xnum(I,W) }.
```

::: listing-source
From the fragment `glue` of `subset-sum-game`.
:::

A refinement then says "the sum is not S", which rules out every set with that sum at once. Gluing `pick/1` instead would refute one set at a time. The library example `af-semi-stable` uses the same idea with argumentation frameworks: it glues the derived `range/1`, not the guessed `in/1`. [Playground: subset-sum-game]{.play} [Playground: af-semi-stable]{.play}

### Witnesses the check does not see {#c07-private}

Sometimes the abstraction needs atoms that the check must not see. In the library example `diagnosis`, a candidate is a set of broken gates of a circuit, and the abstraction also guesses the value of every wire, as a witness that the broken gates explain the observations. The check compares with other sets of broken gates only, so the glue shares `broken/2` and not the wires. Refinements then speak only of gates, which is right: no counterexample depends on the wires.

The price is in counting. A solution is an answer set of the abstraction, wires included, so one set of broken gates can be reported once for each wire assignment that fits. In `diagnosis` the observations fix the wires, so each diagnosis appears once; in general, project the solutions onto the interface atoms when you count them. [Playground: diagnosis]{.play}

### What must never go in {#c07-too-strong}

A constraint in the abstraction that some solution violates removes that solution as surely as a too-strong refinement. A tempting one: every node of the Paley graph looks the same as every other (the graph is symmetric), so why not demand that node 0 is deleted?

```asp
:- not del(0).
```

::: listing-source
From the fragment `abstraction` of `guide-07-too-strong`.
:::

The loop then reports 18 solutions instead of 39. For the question "is there a solution at all?" the constraint is harmless: by symmetry, if there is one, there is one that deletes node 0. For the list of all solutions it is wrong. The soundness test of chapter 4 catches it, as it catches any other way to cut a solution. [Playground: guide-07-too-strong]{.play}

::: theory
**Theory**

Think of the "for all" part as a big conjunction: one constraint per possible counterexample. The single program of chapter 1 would need all of them in advance; this is the full expansion of the quantifier. The loop adds them on demand, one per counterexample. An abstraction that contains some of them in advance sits in between, and the dial m above moves along that line. Chapter 9 adds rules on demand instead of clauses.
:::

::: exercise
### Exercise 1 {#c07-exercise-1}

Add a different piece of knowledge to the abstraction: no triangle through node 0 survives. Is it sound? Apply the soundness test.

[Solution](#c07-exercise-1-solution)
:::

::: exercise
### Exercise 2 {#c07-exercise-2}

The constraint "delete node 0" removes solutions, the constraint "no triangle through node 0 survives" does not. Both are about node 0. What is the difference, as a rule you can apply to any constraint?

[Solution](#c07-exercise-2-solution)
:::

::: exercise
### Exercise 3: a fresh problem, strategic companies {#c07-exercise-fresh}

The starter finds strategic sets of companies (producing every good, closed under control, and minimal) by blocking. Which of the three properties does the abstraction know in advance, and which is left to the check? Would you move one? [Playground: guide-07-ex2-companies-block]{.play}

[Solution](#c07-exercise-fresh-solution)
:::

::: recap
### Recap

- []{#c07-rule-cheap-in-advance}Put into the abstraction what is cheap to state and true of every solution; leave to the loop what is too much to list.
- []{#c07-rule-glue-what-check-needs}Glue what the check depends on, which may be a derived atom; one refinement then covers every candidate with the same value.
- []{#c07-rule-private-witness}Atoms the check need not see stay out of the glue; count solutions on the interface atoms.
- []{#c07-rule-nothing-that-cuts}Nothing in the abstraction may cut a solution. Symmetry breaking is for existence, not for lists.
:::

### Answers {#c07-answers .answers}

::: {.answer #c07-predict-1-answer}
[Back to the question](#c07-predict-1)

0\. The abstraction then knows every triangle, its 39 candidates are exactly the solutions, and the loop has become one program: the check has nothing left to teach.
:::

::: {.answer #c07-exercise-1-solution}
[Back to Exercise 1](#c07-exercise-1)

```asp
:- edge(0,V), edge(0,W), edge(V,W), not del(0), not del(V), not del(W).
```

Every solution leaves no triangle, so it satisfies this constraint: it is sound. The loop finds 39 solutions, as the blocking loop does, with 75 candidates instead of 96. [Playground: guide-07-ex1]{.play}
:::

::: {.answer #c07-exercise-2-solution}
[Back to Exercise 2](#c07-exercise-2)

Ask the question of chapter 3: does every solution satisfy it? A solution must break every triangle, so it breaks those through node 0. A solution need not delete node 0; it is only true that *some* solution does, which is enough for existence but not for the full list. [Playground: guide-07-too-strong]{.play}
:::

::: {.answer #c07-exercise-fresh-solution}
[Back to Exercise 3: a fresh problem, strategic companies](#c07-exercise-fresh)

The abstraction already knows "produces every good" and "closed under control": both are properties of one set and cost nothing to state. Minimality says something about every smaller set: a quantifier over sets, which is the check's job. Moving it into the abstraction would be the one-program encoding the loop exists to avoid. With the library example's refinement (the check writes it as `clause/3` atoms, one clause per company of the smaller set), the loop needs 10 candidates where blocking needs 44. [Playground: strategic-companies]{.play}
:::

## Loop shapes {#c08}

::: lead
Every loop so far ran one search of the abstraction and checked candidates as they came. That is one shape among several. This chapter compares three on the same problem and says when each tends to win.
:::

### Shape 1: the check inside one search {#c08-shape1}

The loops of chapters 3 to 7 have the shape the Loop tab calls Shape 1: `search A:` runs one search for all answer sets of A, the check runs on each candidate, and `reject M with …` adds the clause to the running search. Solver A is called once; what clasp learns along the way stays with it. A candidate that is not rejected is a solution, and the search moves on by itself.

### Shape 2: solve, check, add, solve again {#c08-shape2}

The alternative is to ask A for one answer set at a time:

```loop
loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        A.add(G.block(M))
```

::: listing-source
From the loop script of `guide-08-shape2`.
:::

Each `A.solve()` is a new solve call that starts from the program plus every clause added so far. Two things change. First, nothing moves the search past a solution for you: after `accept M` the loop must block it, or the next solve returns it again. Second, the refinements are part of the program now, never kept "weakly", but each solve starts its search afresh. [Playground: guide-08-shape2]{.play}

### Batches and restarts {#c08-shape4}

A middle way: run one search as in Shape 1, but only block the wrong candidates while collecting their counterexamples; after a batch, restart the search and add the clauses learnt from the batch. The Loop tab's Shape 4 template does this with rule refinements (chapter 9). Here is the version with clauses:

```loop
pending = []
repeat:
    search A:
        on candidate M:
            X = C.solve(assume G(M))
            if X:
                pending.push(X)
                reject M with G.block(M)
                if pending.size >= 10: restart
    added = pending.size
    for X in pending:
        A.add(G.clauses(X))
    pending.clear()
until A.exhausted and added == 0
```

::: listing-source
From the loop script of `guide-08-shape4`.
:::

Why `G.clauses(X)`, with the clause written in the check by `clause/3` (chapter 6)? A clause made with `G.clause(M, X)` inside a search is tied to that search, and the loop refuses to add it after the search has ended. A clause built from the counterexample alone can be added at any time. [Playground: guide-08-shape4]{.play}

### Three shapes, measured {#c08-compare}

::: {.predict #c08-predict-1}
Before you look at the table: which shape needs the fewest candidates? [Answer](#c08-predict-1-answer)
:::

| Shape | Instance | Candidates | Clauses | Restarts | Solutions |
|---|---|---:|---:|---:|---:|
| 1 | n = 13, c = 3, k = 6 | 96 | 57 | 0 | 39 |
| 2 | n = 13, c = 3, k = 6 | 65 | 65 | 0 | 39 |
| 4 | n = 13, c = 3, k = 6 | 119 | 160 | 8 | 39 |
| 1 | n = 29, c = 4, k = 13 | 3,086 | 650 | 0 | 2,436 |
| 2 | n = 29, c = 4, k = 13 | 2,639 | 2,639 | 0 | 2,436 |
| 4 | n = 29, c = 4, k = 13 | 2,956 | 1,040 | 52 | 2,436 |

Read the clause counts with care: Shape 2's include one block per solution, Shape 4's one block per wrong candidate. Now run the three at n = 29, c = 4, k = 13 and compare the elapsed times in the run history. Shape 2 has the fewest candidates and is by far the slowest: it solves A once per candidate, and each solve starts over. Shape 1 is the fastest. With thousands of solutions, each of which costs Shape 2 a solve call, that is no surprise.

### When each shape tends to win {#c08-when}

- **Shape 1** when checks are cheap and there are many candidates or many solutions: one search, no restarts, clauses added on the fly.
- **Shape 2** when checks are expensive, so that the fewest candidates matter most, or when you want only the first solution. It is also the natural shape for refinements that are not clauses: new rules must be grounded between two solves (chapter 9).
- **Batches** in between: rule refinements without a solve call per candidate. Tune the batch size by measuring.

All three are sound with the same check; the soundness test applies to each, and the run history compares them directly, since only the loop changes.

### The guards {#c08-guards}

Shape 2 puts the bookkeeping in your hands, and the loop guards against the commonest slips. Leave out the block after `accept M`:

```{.loop .changed}
          accept M
-         A.add(G.block(M))
```

The next solve returns the same solution, and the run stops with the error "the refinement made no progress: the same candidate came back". The run of `guide-08-forgot-block` ends after 13 candidates with 1 solution reported. [Playground: guide-08-forgot-block]{.play}

Two more guards:

- "refinement does not exclude the candidate": a clause given to `reject` that the candidate satisfies. Such a refinement teaches nothing about this candidate, which is almost always a mistake in the check.
- "A.add: the clause was built from a candidate inside a search; use reject": inside `search A:`, refinements go to the running search with `reject`, not to A with `A.add`. This is also why the batch loop above writes its clauses with `clause/3`.

::: tool-moment
### Tool moment: one shape against another, on many instances

A single run says little about which shape is better: the difference may flip on the next instance. Write the shapes as **variants** of one project and run a **campaign** over a grid of instances: the instance × variant matrix and the cactus plot show where each shape wins, and the campaign marks any instance on which two shapes disagree about the solutions. See the how-to comparing strategies with a campaign.
:::

::: exercise
### Exercise 1 {#c08-exercise-1}

Change the Shape 2 script so that it stops at the first solution.

[Solution](#c08-exercise-1-solution)
:::

::: exercise
### Exercise 2 {#c08-exercise-2}

In the batch loop, what happens to the number of candidates if you raise the batch size from 10 to 1,000, and why? Predict, then try.

[Solution](#c08-exercise-2-solution)
:::

::: exercise
### Exercise 3: a fresh problem, semi-stable extensions {#c08-exercise-fresh}

The starter is a Shape 1 loop that blocks. Which shape would you choose if the refinement were a clause, and which if it were a rule grounded per counterexample? Then compare the starter with the library example. [Playground: guide-08-ex2-semistable-block]{.play}

[Solution](#c08-exercise-fresh-solution)
:::

::: recap
### Recap

- []{#c08-rule-shape1-default}Start with Shape 1: one search, clauses on the fly. It is the fastest when checks are cheap.
- []{#c08-rule-shape2-expensive}Use Shape 2 when checks are expensive or refinements are rules; block every accepted solution yourself.
- []{#c08-rule-measure-shapes}Compare shapes by the run history: same fragments, only the loop changes, the counts must agree.
:::

### Answers {#c08-answers .answers}

::: {.answer #c08-predict-1-answer}
[Back to the question](#c08-predict-1)

Shape 2: its clauses are never violated by a later candidate. Shape 4 has a handicap: within a batch only blocks apply, so a clique can come back until the batch ends.
:::

::: {.answer #c08-exercise-1-solution}
[Back to Exercise 1](#c08-exercise-1)

Stop after accepting: replace the block by `stop`. No block is needed, because no further solve follows. (Setting Solutions to 1 in the run bar does the same for any shape.)

```text
    else:
        accept M
        stop
```

[Playground: guide-08-shape2]{.play}
:::

::: {.answer #c08-exercise-2-solution}
[Back to Exercise 2](#c08-exercise-2)

The candidates go up, by about a thousand: the first search blocks 1,000 wrong candidates one by one before a single clause arrives. With a batch larger than the number of wrong candidates, the search never restarts and the loop becomes the blocking loop, with its 4,096 candidates; the clauses come when there is nothing left to prune. Small batches keep the clauses coming. [Playground: guide-08-shape4]{.play}
:::

::: {.answer #c08-exercise-fresh-solution}
[Back to Exercise 3: a fresh problem, semi-stable extensions](#c08-exercise-fresh)

A clause fits Shape 1: one search, clauses added on the fly. A rule needs a solver that is not searching, so Shape 2 or 3. The library example stays in Shape 1 with clauses about the range: 7 candidates where the blocking starter needs 12, the same 2 solutions. [Playground: af-semi-stable]{.play}
:::

## Refinements that are rules {#c09}

::: lead
A clause can only say "one of these interface atoms must change". Some lessons need more: a sum, a comparison, a fresh copy of part of the problem. This chapter shows how a refinement can be a set of rules instead, grounded once per counterexample.
:::

### What a clause cannot say {#c09-limits}

Every refinement so far was a clause over interface atoms. That works when the counterexample depends on a few atoms keeping their values. It fails when it depends on a quantity: "this alternative is better for everyone, as long as the sums come out this way" is not a statement about any particular atom. The best clause is then close to a block, and the loop learns little.

### A program part per counterexample {#c09-refine}

The abstraction solver can hold a *program part* with a parameter:

```asp
#program refine(i).
% cex(i,q(V)): node V is in the i-th surviving clique. One of its nodes must go.
hit(i) :- cex(i,q(V)), del(V).
:- not hit(i).
```

::: listing-source
From the fragment `refine` of `guide-09-clique-rules`.
:::

The loop grounds the part once for every counterexample:

```{.loop .changed}
      if X:
-         A.add(G.clause(M, X))
+         A.expand(refine, cex = X.atoms(q/1))
```

`A.expand(refine, cex = X.atoms(q/1))` takes the `q/1` atoms of the counterexample, adds them to A as facts `cex(i, q(V))` with the next value of i (1, 2, …), and grounds `refine(i)`. The rules may use anything in A: interface atoms, other atoms of the abstraction, arithmetic, aggregates. The fragment `refine` is added to solver A in the first line of the script.

Two rules about the part. First, **every head must contain the parameter**. Each expansion grounds the same rules with a new i; if a head lacks i, the second expansion defines an atom the first one already defined, clingo silently ignores the new rules, and the refinement has no effect. Second, the parameter here is called i because k is already a constant of the problem, and a constant with the parameter's name replaces it.

This is the Loop tab's Shape 3: Shape 2 with `A.expand` in place of `A.add`. Expanding needs a solver that is not searching, so rule refinements go with Shape 2 or with the batches of chapter 8, not with `search A:`.

### Warm-up: the clique lesson as a rule {#c09-clique-rules}

::: {.predict #c09-predict-1}
Predict: the clause version needed 57 counterexamples. The rule version learns the same lesson per clique, but in a Shape 2 loop. More counterexamples, or fewer? [Answer](#c09-predict-1-answer)
:::

The part above says exactly what the clause said: one of the clique's nodes must be deleted. So it should need exactly the candidates of Shape 2 with clauses, and it does: 65 and 65, with 26 expansions for the 26 triangles. Nothing gained; the mechanism is clear. [Playground: guide-09-clique-rules]{.play}

### Where rules pay: fair division {#c09-fair}

Three agents divide seven indivisible goods; each agent values each good. An allocation is wanted that is *envy-free* (no agent prefers another agent's bundle) and *efficient*: no other allocation makes everyone at least as happy and somebody happier. "There is an allocation such that for all other allocations …": the shape again. The abstraction guesses envy-free allocations `gets(A,G)`; the check looks for an allocation `alt(A,G)` that dominates the candidate.

What does a dominating allocation teach? Not that some assignment must change: any candidate in which every agent is no better off than in the alternative is dominated too. That is a statement about sums, and it is a rule:

```asp
loses(k,A) :- agent(A),
    #sum { V,G : cex(k,alt(A,G)), value(A,G,V) ; -V,G : gets(A,G), value(A,G,V) } < 0.
gains(k,A) :- agent(A),
    #sum { V,G : cex(k,alt(A,G)), value(A,G,V) ; -V,G : gets(A,G), value(A,G,V) } > 0.
% The candidate must not be dominated by it: if somebody gains, somebody loses.
:- gains(k,A), not loses(k,B) : agent(B).
```

::: listing-source
From the fragment `refine` of `fair-division` (this problem has no constant k, so its part may use the name).
:::

"If somebody would gain by the alternative, somebody must lose by it." The best clause available speaks only of the candidate's own assignments: one of them must change. That is a block in fewer words. [Playground: guide-09-fair-block]{.play} [Playground: guide-09-fair-clause]{.play} [Playground: fair-division]{.play}

| Refinement | Candidates | Refinements | Rules of A | Solutions |
|---|---:|---:|---:|---:|
| Block | 11 | 8 | 85 | 3 |
| Best clause | 11 | 8 | 85 | 3 |
| Rule | 6 | 6 | 196 | 3 |

The clause is the block with 7.0 literals instead of 21.0, and learns nothing more. The rule needs 3 expansions where blocking needed 8 refutations. (Its refinements include one block per solution, as in every Shape 2 loop.) The instance is tiny; on larger ones the gap grows with the number of allocations a single alternative dominates.

### The cost {#c09-cost}

Every expansion grounds new rules into A, and A keeps them. In the table, the rule run's A ends with 196 rules against 85; the clique rules took A from 63 to 245. With thousands of counterexamples, grounding time and the size of A become what you watch in the Statistics tab. Use a rule where a clause cannot say the lesson; use a clause where it can.

::: pitfall
**Pitfall: a head without the parameter**

Here the heads lack i:

```asp
hit :- cex(i,q(V)), del(V).
:- not hit.
```

The first expansion works. The second defines `hit` again; clingo ignores the new rule without a word, the candidate comes back unchanged, and the loop stops with "the refinement made no progress: the same candidate came back" after 3 candidates. Check every head for the parameter. [Playground: guide-09-missing-k]{.play}
:::

::: theory
**Theory**

Expanding the "for all" of chapter 1 completely would mean one copy of the inner problem per possible counterexample, all grounded at once. A rule refinement grounds one copy, for one counterexample, when it is needed: it is a lazily grounded piece of that expansion. A clause is what remains of such a copy when it can be reduced to interface atoms; when it cannot, the copy itself is the refinement.
:::

::: exercise
### Exercise 1 {#c09-exercise-1}

Someone proposes: "the clique survives because nothing next to it is deleted; demand that a node next to the clique, outside it, is deleted." Write it as a refine part and run it. What happens, and which argument of chapter 3 does it fail?

[Solution](#c09-exercise-1-solution)
:::

::: exercise
### Exercise 2 {#c09-exercise-2}

Why is the clique rule's count of candidates exactly that of Shape 2 with clauses, and not that of Shape 1?

[Solution](#c09-exercise-2-solution)
:::

::: exercise
### Exercise 3: a fresh problem, 2QBF as rules {#c09-exercise-fresh}

Start again from the blocking 2QBF starter of chapter 5. Write the refinement as a rule instead of a clause: what should a program part grounded per counterexample y-assignment say? [Playground: guide-05-ex2-qbf-block]{.play}

[Solution](#c09-exercise-fresh-solution)
:::

::: recap
### Recap

- []{#c09-rule-rules-when-clauses-cannot}Use a rule refinement when the lesson is not "one of these atoms must change": sums, comparisons, copies of the problem.
- []{#c09-rule-heads-contain-parameter}Every head of a refine part contains its parameter, and no constant has the parameter's name.
- []{#c09-rule-refinement-excludes-candidate}A refinement must exclude the candidate it was made from, and every solution must satisfy it.
- []{#c09-rule-watch-grounding}Rule refinements grow the abstraction; watch its size and grounding time.
:::

### Answers {#c09-answers .answers}

::: {.answer #c09-predict-1-answer}
[Back to the question](#c09-predict-1)

Fewer: 26. A grounded rule is never forgotten (a Shape 1 clause may be, chapter 5), and every new solve of A starts from all lessons so far.
:::

::: {.answer #c09-exercise-1-solution}
[Back to Exercise 1](#c09-exercise-1)

```asp
hit(i) :- cex(i,q(V)), edge(V,W), not cex(i,q(W)), del(W).
hit(i) :- cex(i,q(V)), edge(W,V), not cex(i,q(W)), del(W).
:- not hit(i).
```

The loop stops with the no-progress guard after 3 candidates. The second candidate already deletes a neighbour of the clique the check returns for it, so the refinement does not exclude that candidate, and it comes back. A refinement must exclude the candidate it was made from (the termination argument of chapter 3), and every solution must satisfy it. This one fails the first, and nothing makes it pass the second: a solution must delete a node of the clique, not one next to it. [Playground: guide-09-ex1]{.play}
:::

::: {.answer #c09-exercise-2-solution}
[Back to Exercise 2](#c09-exercise-2)

The rule says what the clause says, and both loops have the same shape: solve, check, refine, solve again. Shape 1 adds clauses inside one search, where clasp keeps them only weakly (chapter 5), so it sees more candidates. [Playground: guide-08-shape2]{.play}
:::

::: {.answer #c09-exercise-fresh-solution}
[Back to Exercise 3: a fresh problem, 2QBF as rules](#c09-exercise-fresh)

The counterexample fixes the y-variables; the part instantiates the formula with them and demands that some term the assignment leaves open is true. That is expansion: the library example `qbf-expansion` needs 10 candidates and finds the same 5 solutions. Chapter 13 compares the two refinements on a larger formula. [Playground: qbf-expansion]{.play}
:::

## Checks that look for a witness, and cores {#c10}

::: lead
Until now the check looked for a counterexample, and an answer set meant "wrong". Some properties are shown the other way round: by a witness. This chapter turns the check around and shows where the refinement then comes from: the unsatisfiable core.
:::

### Witness or counterexample {#c10-witness}

Take the problem "find the graphs on n nodes that can be 3-coloured". A candidate is a graph, and it is good when a proper 3-colouring exists. The natural check looks for that colouring, a *witness*:

```asp
1 { col(N,1..3) } 1 :- node(N).
:- edge(X,Y), col(X,C), col(Y,C).
```

::: listing-source
From the fragment `check` of `guide-10-core-block`.
:::

Now the polarity is reversed: an answer set means the candidate is *good*, and an unsatisfiable check means it is wrong. The loop rejects when the check fails:

```loop
search A:
    on candidate M:
        if not C.solve(assume G(M)):
            reject M with G.block(M)
```

::: listing-source
From the loop script of `guide-10-core-block`.
:::

There is no counterexample to read `relevant/1` from. Something else must say why the candidate failed.

### The unsatisfiable core {#c10-core}

When clingo finds a solve under assumptions unsatisfiable, it can report a *core*: a subset of the assumptions that is unsatisfiable on its own. Here the assumptions are the candidate's edge atoms, so the core is a set of edges (present or absent) that already rules out every 3-colouring. Every graph that agrees with the candidate on those atoms has no colouring either. So the clause "one of these atoms must change" is satisfied by every solution: a sound refinement.

`G.core(C)` builds that clause from the core of the last solve of C. The library example `lang-core` is the loop above with `reject M with G.core(C)`. [Playground: lang-core]{.play} [Playground: guide-10-core-block]{.play}

| Refinement | Candidates | Clauses | Mean length | Longest | Solutions |
|---|---:|---:|---:|---:|---:|
| Block | 1,024 | 66 | 10.0 | 10 | 958 |
| Core | 999 | 41 | 6.1 | 9 | 958 |

::: {.predict #c10-predict-1}
Predict: blocking needed 66 clauses of 10.0 literals each. How long will a core be on average? [Answer](#c10-predict-1-answer)
:::

On five nodes almost every graph can be coloured, so there is little to learn either way. But look at the lengths.

### Cores are not minimal {#c10-not-minimal}

The smallest graph that cannot be 3-coloured is the clique on four nodes, with six edges. A minimal core would therefore have six literals. clasp's cores have 6.1 on average and up to 9: clasp returns the first core it finds, not a smallest one. Each extra literal makes the clause weaker. If that matters, shrink the core yourself (drop one atom, check again, keep the drop if the check stays unsatisfiable), at the price of more check calls.

### A core from the wrong check {#c10-misused}

The argument above needs one thing: the unsatisfiable check means the candidate is *wrong*. After a satisfiable check there is no core, and the loop refuses `G.core(C)`. The dangerous case is a check of the other polarity, where unsatisfiable means *good*. Treat the clique check of the running example as if it were a witness check:

```loop
search A:
    on candidate M:
        if not C.solve(assume G(M)):
            reject M with G.core(C)
```

::: listing-source
From the loop script of `guide-10-core-misused`.
:::

Every solution now has an unsatisfiable check, and its core says why the candidate is *good*; rejecting with it removes the solution and others like it. Every wrong candidate, on the other hand, is accepted. The run reports 4,057 solutions instead of 39. The soundness test of chapter 4 notices a count that is too large as well as one that is too small. [Playground: guide-10-core-misused]{.play}

### Two checks in one loop {#c10-two-checks}

Some problems need both kinds. Back to the sufficient reasons of chapter 6, now with the extra demand that no kept feature is redundant (a *minimal* sufficient reason). "Sufficient" is refuted by a counterexample, as before. "Every kept feature is needed" is shown by a witness: for each kept feature, an input that agrees on the others and gets the other answer. A second check solver D looks for that family of inputs:

```loop
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.clause(M, X)
        elif not D.solve(assume GD(M)):
            reject M with GD.core(D)
```

::: listing-source
From the loop script of `minimal-reasons`.
:::

A candidate that passes C but has no witness in D is not minimal; the core of D names kept features that already make some other kept feature redundant. The loop needs 67 candidates where blocking needs 256, and both find 4. [Playground: minimal-reasons]{.play} [Playground: guide-10-minimal-block]{.play}

### Subset-minimal solutions in general {#c10-shrinking}

Minimality has a second standard treatment. Take any candidate that passes, shrink it (drop one element at a time while it still passes), report the minimal set, and exclude all its supersets from then on. The library example `reasons-by-shrinking` does this for the same network; it is written in raw Lua because the loop language has no superset clause. [Playground: reasons-by-shrinking]{.play}

::: exercise
### Exercise 1 {#c10-exercise-1}

For each problem, should the check look for a witness or for a counterexample, and what would the refinement be made from?

1. Graphs on n nodes that have a Hamiltonian cycle.
2. Graphs on n nodes that have *no* Hamiltonian cycle.
3. Deletion sets that leave no clique of c nodes.

[Solution](#c10-exercise-1-solution)
:::

### Cores in the literature

A core as clasp returns it need not be minimal. `C.core.minimal` shrinks it until no assumption can be left out, at the price of a few more solves of the check; a short core is a strong clause.

Cores drive several well-known algorithms, and each is a short loop script. The implicit hitting set loop of MaxHS asks an optimal abstraction for the cheapest set of soft clauses to give up and learns one core per failed check; it walks the core as a list (`for a in C.core`) to relax it and find disjoint cores in the same round. Core-guided MaxSAT (OLL) keeps one solver and grounds a rule refinement per core. MARCO grows satisfiable seeds and shrinks unsatisfiable ones, blocking supersets and subsets. Branch-and-check runs the witness check already at partial assignments (`on partial`): a core found there cuts every completion. The section "Loops from the literature" of the manual has the full list. [Playground: maxsat-ihs]{.play} [Playground: maxsat-oll]{.play} [Playground: marco]{.play} [Playground: colourable-partial]{.play}

::: exercise
### Exercise 2: a fresh problem, diagnosis {#c10-exercise-fresh}

The starter finds diagnoses of a circuit (sets of faulty gates that explain an observation), blocking each refuted candidate. Is its check a witness check or a counterexample check, and where would the refinement come from? [Playground: guide-10-ex2-diagnosis-block]{.play}

[Solution](#c10-exercise-fresh-solution)
:::

::: recap
### Recap

- []{#c10-rule-witness-polarity}Know your check's polarity: does an answer set mean wrong (counterexample) or good (witness)?
- []{#c10-rule-core-after-failed-witness}Refine from the core only when an unsatisfiable check means the candidate is wrong.
- []{#c10-rule-cores-not-minimal}Cores are not minimal; shrink them when clause length matters.
:::

### Answers {#c10-answers .answers}

::: {.answer #c10-predict-1-answer}
[Back to the question](#c10-predict-1)

6.1 literals: shorter than a block, but longer than the six edges a clique on four nodes needs, because clasp returns the first core it finds.
:::

::: {.answer #c10-exercise-1-solution}
[Back to Exercise 1](#c10-exercise-1)

1. A witness: the cycle. A graph without one is refined with the core.
2. A counterexample: a cycle refutes the graph. The cycle depends on its edges being present, so `relevant/1` marks them: one of them must go.
3. A counterexample, as in every chapter so far: a surviving clique.

The rule of thumb: look at the "for all". If the property is "for all Y, not bad", look for a bad Y, a counterexample. If it is "there is a Y" about the candidate, look for that Y, a witness, and learn from the core when there is none. [Playground: lang-core]{.play}
:::

::: {.answer #c10-exercise-fresh-solution}
[Back to Exercise 2: a fresh problem, diagnosis](#c10-exercise-fresh)

Read the loop: it rejects when the check finds a model, so the check looks for a counterexample, and the refinement comes from `relevant/1`, not from a core. With it the library example needs 8 candidates where blocking needs 14; both find 2. The rule of thumb of exercise 1 decides the polarity before any code is written. [Playground: diagnosis]{.play}
:::

## Optimisation {#c11}

::: lead
So far the loop answered "which candidates are solutions?". Often the question is "which solution is best?". This chapter shows how a loop optimises, why it needs sound refinements even more than before, and what to do when the inner problem optimises too.
:::

### Fewest deletions {#c11-fewest}

Drop the bound k from the running example and ask for a deletion set that is as small as possible. The abstraction proposes any deletion set and prefers small ones:

```asp
{ del(V) : node(V) }.
#minimize { 1,V : del(V) }.
#show del/1.
```

::: listing-source
From the fragment `abstraction` of `guide-11-fewest-deletions`.
:::

and the loop asks it for an optimal answer set each time:

```loop
loop:
    M = A.solve(optimal)
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        stop
```

::: listing-source
From the loop script of `guide-11-fewest-deletions`.
:::

`A.solve(optimal)` returns a smallest candidate that satisfies all refinements so far. If the check refutes it, the clause goes in and the next smallest comes. The first candidate without a counterexample is the answer. [Playground: guide-11-fewest-deletions]{.play}

::: {.predict #c11-predict-1}
How many deletions will it report for n = 13, and how do you know without running it? [Answer](#c11-predict-1-answer)
:::

### Why the first survivor is optimal {#c11-why-optimal}

Suppose a smaller solution existed. It is a candidate (the abstraction over-approximates), and it satisfies every refinement (each is sound). So at every step it was available to `A.solve(optimal)`, which would have returned it, or one just as small, before the reported one. Hence nothing smaller exists.

The argument uses soundness at every step. A refinement that is too strong can remove the true optimum, and the loop then reports a worse one with full confidence. When you count solutions, an unsound loop at least shows a different number from the blocking loop; when you optimise, it shows a plausible value. Apply the soundness test of chapter 4 to the decision version (with a bound) before you trust an optimum.

### When the inner problem optimises too {#c11-bilevel}

In a *bilevel* problem the check is itself an optimisation. The bilevel knapsack: a leader locks items within a budget, then a follower packs the remaining items within a capacity, as profitably as possible. The leader wants to keep the follower's profit low.

The decision version fixes a bound: find the locked sets after which the follower cannot get more than the bound. That is our familiar loop: the check packs a knapsack above the bound, and the refinement says "lock one of these items". [Playground: knapsack-interdiction]{.play}

```asp
relevant(lock(I)) :- pack(I).
% A packing with few items gives a short clause.
#minimize { 1,I : pack(I) }.
```

::: listing-source
From the fragment `check` of `knapsack-interdiction`.
:::

To find the best bound itself, the abstraction also guesses a claim, the follower's profit, smallest first, and the check packs a knapsack that beats the claim. Now a refinement carries a number: "unless one of these items is locked, the claim must be at least this profit". That needs a sum, so it is a rule (chapter 9):

```asp
profit(k,P) :- P = #sum { Q,I : cex(k,pack(I)), item(I,_,_,Q) }.
% The claim has to cover this profit unless one of the packed items is locked.
hit(k) :- cex(k,pack(I)), lock(I).
:- not hit(k), profit(k,P), value(V), V < P.
```

::: listing-source
From the fragment `refine` of `knapsack-optimum`.
:::

The first candidate that survives the check has the optimal claim. The loop then grounds a second part that forbids larger claims and goes on to list every locked set that achieves the optimum: 2 sets after 8 candidates. [Playground: knapsack-optimum]{.play}

### Bounds along the way {#c11-bounds}

An optimisation loop knows more than its final answer while it runs. Each claim the abstraction makes is a lower bound on the optimum (nothing smaller survived the refinements), and the follower's best reply to a locked set is an upper bound (that set achieves it). The library example `knapsack-bounds` logs both until they meet; it is written in raw Lua, because the loop language cannot read numbers out of a model. Stop early with both bounds in hand when the gap is small enough. [Playground: knapsack-bounds]{.play}

::: theory
**Theory**

There are two ways to optimise with a loop. *Optimal first*, as here: the abstraction proposes the best remaining candidate, and the first survivor is optimal. Its runs end with a proof of optimality, but every refutation costs an optimisation of A. *Improving solutions*: accept any solution, then demand a better one (add "cost below this" to A) and go on; each solution is a usable answer, and the last one is optimal when A runs out. Both depend on sound refinements; an unsound one can hide the optimum without any sign.
:::

::: exercise
### Exercise 1 {#c11-exercise-1}

Change the fewest-deletions loop so that it lists every optimal deletion set, not just the first. Hint: `knapsack-optimum` does the same with a second program part.

[Solution](#c11-exercise-1-solution)
:::

::: exercise
### Exercise 2 {#c11-exercise-2}

Suppose the fewest-deletions loop used the "busiest node" refinement of chapter 4. What could it report, and would you notice?

[Solution](#c11-exercise-2-solution)
:::

### Optimisation in the literature

Logic-based Benders decomposition is this chapter's loop with numbers in the refinement: the master problem (an optimal abstraction) estimates a cost, the subproblem (an optimal check) computes it, and a too-low estimate becomes an optimality cut, grounded as rules. The master's optimum is a lower bound, every feasible assignment an upper bound; `track` draws both in the Statistics tab until they meet. The implicit hitting set loop (MaxHS) and core-guided MaxSAT (OLL) are optimisation loops driven by cores (previous chapter). [Playground: benders-tardiness]{.play} [Playground: knapsack-bounds]{.play}

::: exercise
### Exercise 3: a fresh problem, knapsack interdiction {#c11-exercise-fresh}

The library example `knapsack-interdiction` lists every set of locked items that keeps the follower below a goal. Turn it into an optimisation: the locked set that leaves the follower the least. What must the abstraction minimise, and why does a too-strong refinement now do more harm than before? [Playground: knapsack-interdiction]{.play}

[Solution](#c11-exercise-fresh-solution)
:::

::: recap
### Recap

- []{#c11-rule-optimal-first}To optimise, ask the abstraction for the best candidate first; the first one that survives the check is optimal.
- []{#c11-rule-optimum-needs-soundness}An optimum is only as good as the soundness of every refinement; test the bounded version first.
- []{#c11-rule-bilevel-rules}When the inner problem optimises, refinements carry numbers; write them as rules.
:::

### Answers {#c11-answers .answers}

::: {.answer #c11-predict-1-answer}
[Back to the question](#c11-predict-1)

Six. Chapter 5's blocking loop has 39 solutions with k = 6 and 0 with k = 5. The loop gets there after 23 candidates.
:::

::: {.answer #c11-exercise-1-solution}
[Back to Exercise 1](#c11-exercise-1)

Block each solution and continue; after the first, ground a part that forbids larger deletion sets. The abstraction derives the size, and the part reads it from the first solution:

```asp
#program cap(i).
% best(i,size(B)): the fewest deletions are B. No larger set is of interest.
:- best(i,size(B)), size(N), N > B.
```

```loop
    else:
        accept M
        A.add(G.block(M))
        if not capped:
            A.expand(cap, best = M.atoms(size/1))
            capped = true
```

It lists 39 sets of six, the solutions of the blocking loop with k = 6. [Playground: guide-11-ex1]{.play}
:::

::: {.answer #c11-exercise-2-solution}
[Back to Exercise 2](#c11-exercise-2)

A deletion set that survives the check, so it is a solution, but possibly not a smallest one: the too-strong clauses can remove every smallest set. Nothing in the run would show it. Only the soundness test on the bounded version reveals the problem; the blocking loop is the reference. [Playground: guide-04-one-node]{.play}
:::

::: {.answer #c11-exercise-fresh-solution}
[Back to Exercise 3: a fresh problem, knapsack interdiction](#c11-exercise-fresh)

The abstraction claims a value for the follower and minimises it; the check finds the follower's best reply, and a reply above the claim refutes the candidate. The first candidate that survives is optimal only if no refinement ever removed a better one: a too-strong refinement now changes the answer, not just the count. The library example `knapsack-optimum` is this loop. [Playground: knapsack-optimum]{.play}
:::

## Your own loop: a walkthrough and a checklist {#c12}

::: lead
This last chapter builds a loop for a problem the guide has not used, from the plain statement to a measured, tested loop, naming at each step the chapter it applies. Then it collects the rules of all chapters into one checklist.
:::

### The problem, and its quantifiers {#c12-statement}

A robot stands somewhere in a 3 × 3 room, and does not know where. It can move east, west, north or south; a move against a wall leaves it where it is. Find a plan of t moves that brings it to the centre cell *from every start cell*. There are no observations along the way: the same moves are made whatever the start.

State the quantifiers first (chapter 1): *there is* a plan such that *for all* start cells the robot ends in the goal. The plan is the guess; a start cell from which the plan fails is a counterexample. The library example `conformant-planning` is the same problem in a larger room; we start small, as chapter 4 advises.

### Step 1: the abstraction, with an empty check {#c12-step-guess}

The room, the moves and the horizon go into `shared`. The abstraction guesses one move per step:

```asp
1 { do(T,D) : dir(D,_,_) } 1 :- step(T).
#show do/2.
```

::: listing-source
From the fragment `abstraction` of `guide-12-step1-guess`.
:::

Before writing the check, run the abstraction with a check that is just `#false.`: it accepts everything, and the count of solutions is the size of the candidate space (chapter 1). For t = 6 that is 4,096 plans, four moves at each of six steps. Small enough for a blocking loop. [Playground: guide-12-step1-guess]{.play}

### Step 2: the check, the glue, the ground truth {#c12-step-block}

The check guesses a start cell, follows the plan from it, and demands that it ends *off* the goal (chapter 2: an answer set means the candidate is wrong):

```asp
1 { start(X,Y) : free(X,Y) } 1.
at(X,Y,0) :- start(X,Y).
at(X2,Y2,T) :- at(X,Y,T-1), do(T,D), to(X,Y,D,X2,Y2).
:- goal(X,Y), at(X,Y,t).
#show start/2.
```

::: listing-source
From the fragment `check` of `guide-12-step2-block`.
:::

It reads `do/2`, so the glue shares exactly that:

```asp
glue(do(T,D)) :- step(T), dir(D,_,_).
```

The Reference run template blocks each failing plan (chapter 2). This run is the ground truth for everything that follows: 80 plans work, found among 4,096 candidates. [Playground: guide-12-step2-block]{.play}

### Step 3: a first relevant/1, tested and measured {#c12-step-clause}

Which interface atoms does a failing start cell depend on (chapter 3)? The robot's path from that cell goes through every step, and changing any single move can send it elsewhere, possibly to the goal. So every move of the plan is relevant:

```asp
relevant(do(T,D)) :- do(T,D).
```

The soundness test (chapter 4) passes: 80 solutions, as in step 2. The measurement (chapter 5) shows the catch: 4,096 candidates, no better than blocking. Marking every move is a block in fewer literals (chapter 3). The counterexample's lesson is not "one of these moves must change". [Playground: guide-12-step3-clause]{.play}

### Step 4: decide clause or rule, and pick the shape {#c12-step-rules}

What a failing start cell really teaches is: "the plan must also work from here". That is not a statement about a few moves, but a copy of the robot that starts in that cell and must reach the goal: a rule refinement (chapter 9).

```asp
#program refine(k).
% cex(k,start(X,Y)): the k-th counterexample is a start cell. Follow the plan from there ...
at(k,X,Y,0) :- cex(k,start(X,Y)).
at(k,X2,Y2,T) :- at(k,X,Y,T-1), do(T,D), to(X,Y,D,X2,Y2).
% ... it has to end in the goal.
:- goal(X,Y), not at(k,X,Y,t).
```

::: listing-source
From the fragment `refine` of `guide-12-step4-rules` (the constant here is t, so the part may use k).
:::

::: {.predict #c12-predict-1}
Predict: the plan has to work from every start cell of the room. How many counterexamples (start cells) does the rule loop need before every plan it proposes works? [Answer](#c12-predict-1-answer)
:::

Rule refinements need a solver that is not searching, so the shape is Shape 3: solve, check, expand, solve again (chapter 8). Every head contains the parameter (chapter 9). The result: 83 candidates and only 3 counterexamples; once the plan works from three well-chosen start cells, it works from everywhere. The soundness test passes again: 80 solutions. [Playground: guide-12-step4-rules]{.play}

### Step 5: scale the constants {#c12-scale}

Only now scale (chapter 5). With t = 7 the rule loop finds 560 plans from 562 candidates. The library example `conformant-planning` is the same loop in a 4 × 4 room with a pillar and t = 8: 3 plans after 11 candidates, where a blocking run has to wade through tens of thousands. [Playground: conformant-planning]{.play}

The order of the steps is the point: the empty check before the real one, the blocking loop before any refinement, the soundness test before any measurement, and the small instance before the large one.

### The checklist {#c12-checklist}

Every rule from the recaps of chapters 1 to 11, grouped by what it is about.

#### The problem

- Look for the quantifiers. "There is an X such that for all Y …" is the shape a loop is for. [Chapter 01](#c01-rule-quantifiers)
- A guessed atom means "there is one". One program cannot say "for all" with it. [Chapter 01](#c01-rule-guessed-means-some)
- Split the problem into a guess (the abstraction) and a test of one guess (the check); each is an ordinary program. [Chapter 01](#c01-rule-split)

#### The abstraction

- The abstraction over-approximates: every solution must be a candidate. [Chapter 02](#c02-rule-over-approximate)
- Put into the abstraction what is cheap to state and true of every solution; leave to the loop what is too much to list. [Chapter 07](#c07-rule-cheap-in-advance)
- Glue what the check depends on, which may be a derived atom; one refinement then covers every candidate with the same value. [Chapter 07](#c07-rule-glue-what-check-needs)
- Atoms the check need not see stay out of the glue; count solutions on the interface atoms. [Chapter 07](#c07-rule-private-witness)
- Nothing in the abstraction may cut a solution. Symmetry breaking is for existence, not for lists. [Chapter 07](#c07-rule-nothing-that-cuts)
- To optimise, ask the abstraction for the best candidate first; the first one that survives the check is optimal. [Chapter 11](#c11-rule-optimal-first)

#### The check

- The check has an answer set exactly when the candidate is wrong; that answer set is the counterexample. [Chapter 02](#c02-rule-check-finds-wrong)
- Glue every atom of the abstraction that the check reads. An atom that is not glued is silently false in the check. [Chapter 02](#c02-rule-glue-everything)
- Know your check's polarity: does an answer set mean wrong (counterexample) or good (witness)? [Chapter 10](#c10-rule-witness-polarity)
- Several counterexamples per candidate save candidates and cost check work; measure the trade. [Chapter 06](#c06-rule-several-cex)
- A counterexample that depends on few atoms gives a short, strong clause. Ask for it with `#minimize` and `optimal` when checks are cheap. [Chapter 06](#c06-rule-small-cex)

#### The refinement

- Mark with `relevant/1` the interface atoms the counterexample depends on, and no others. The refinement then rules out every candidate that agrees on them. [Chapter 03](#c03-rule-mark-dependencies)
- For every refinement, argue that every solution satisfies it. If the relevant atoms keep their values, the counterexample must still be one. [Chapter 03](#c03-rule-every-solution-satisfies)
- Marking every interface atom is blocking: safe, and no faster. [Chapter 03](#c03-rule-all-relevant-blocks)
- A counterexample can depend on an atom being false. Mark it too. [Chapter 04](#c04-rule-both-polarities)
- A refinement must exclude the candidate it was made from, and every solution must satisfy it. [Chapter 09](#c09-rule-refinement-excludes-candidate)
- Write the clauses in the check with `clause/3` when `relevant/1` cannot say what you need. [Chapter 06](#c06-rule-clause3)
- Use a rule refinement when the lesson is not "one of these atoms must change": sums, comparisons, copies of the problem. [Chapter 09](#c09-rule-rules-when-clauses-cannot)
- Every head of a refine part contains its parameter, and no constant has the parameter's name. [Chapter 09](#c09-rule-heads-contain-parameter)
- Refine from the core only when an unsatisfiable check means the candidate is wrong. [Chapter 10](#c10-rule-core-after-failed-witness)
- Cores are not minimal; shrink them when clause length matters. [Chapter 10](#c10-rule-cores-not-minimal)
- When the inner problem optimises, refinements carry numbers; write them as rules. [Chapter 11](#c11-rule-bilevel-rules)

#### Soundness

- Blocking is always sound and always slow. Keep the blocking loop as the ground truth for small instances. [Chapter 02](#c02-rule-block-baseline)
- A refinement that is too strong removes solutions without any sign. The run still finishes, exhausted. [Chapter 04](#c04-rule-too-strong-is-silent)
- Test soundness by comparison: the blocking loop and your loop, same fragments and constants, all solutions, both exhausted, same count. [Chapter 04](#c04-rule-soundness-test)
- Audit a small instance: it checks every refinement against every solution, and its witness names the atom that should have been relevant. [Chapter 04](#c04-rule-audit)
- Apply the test to several small instances: a wrong loop can be right on one. [Chapter 04](#c04-rule-several-instances)
- Test soundness where the blocking loop finishes; scale only afterwards. [Chapter 05](#c05-rule-test-small-then-scale)
- An optimum is only as good as the soundness of every refinement; test the bounded version first. [Chapter 11](#c11-rule-optimum-needs-soundness)

#### Measuring

- Read the first steps of the trace: candidate, counterexample, refinement. Mistakes in a refinement show there first. [Chapter 05](#c05-rule-read-trace)
- A good run has short clauses, few candidates beyond the solutions, and no solver that dominates without reason. [Chapter 05](#c05-rule-good-run)
- Solver options can change the number of candidates, never the solutions of a sound loop. [Chapter 05](#c05-rule-options-change-counts)
- Rule refinements grow the abstraction; watch its size and grounding time. [Chapter 09](#c09-rule-watch-grounding)
- Compare shapes by the run history: same fragments, only the loop changes, the counts must agree. [Chapter 08](#c08-rule-measure-shapes)

#### The loop shape

- Start with Shape 1: one search, clauses on the fly. It is the fastest when checks are cheap. [Chapter 08](#c08-rule-shape1-default)
- Use Shape 2 when checks are expensive or refinements are rules; block every accepted solution yourself. [Chapter 08](#c08-rule-shape2-expensive)

### Which loop for which situation {#c12-decisions}

| Situation | Choose | Chapter |
|---|---|---|
| The counterexample depends on a few interface atoms keeping their values | `relevant/1` and `G.clause`, Shape 1 | [03](#c03) |
| Checks are cheap; candidates or solutions are many | Shape 1; several or smallest counterexamples per check | [06](#c06), [08](#c08) |
| Checks are expensive | Shape 2: the fewest candidates | [08](#c08) |
| The lesson is a sum, a comparison or a copy of the problem | A refine part, Shape 3 or batches | [09](#c09) |
| The check only needs a derived property of the candidate | Glue the derived atom | [07](#c07) |
| Some facts about solutions are cheap to list in advance | Put them in the abstraction | [07](#c07) |
| A good candidate is shown by a witness | Witness check, refine from the core | [10](#c10) |
| The best solution is wanted | `A.solve(optimal)`, first survivor; rules if the inner problem optimises | [11](#c11) |
| Any change of loop, refinement or abstraction | The soundness test against the blocking loop | [04](#c04) |

### Where next {#c12-where-next}

- The manual: the loop language in full, every option, the troubleshooting table.
- The library's problem groups (Control tab, Library): more than forty problems from the literature, each a working loop with a short description, most with several instances and their expected counts.
- The playground's Tutorial: the tools around a loop, from the Observatory and the audit to instances and campaigns.
- docs/chat-package/START-HERE.md: how to write a new example together with an AI assistant in a chat, with a soundness checklist.
- tools/cegarcheck.py: checks a project with the Python clingo, outside the browser.

::: tool-moment
### Tool moment: keeping the run

A design session ends with a run worth showing. A **recording** keeps every step (and, with solver calls, the timeline) in a file that replays without the engine; a link to a replay can open it on a chosen step and view. The how-tos presenting a run and checking a loop independently cover the last two steps of a project: showing it, and making sure it is right.
:::

::: exercise
### Exercise 1 {#c12-exercise-1}

Step 3 claimed that changing a single move can send the robot elsewhere. Take a plan that fails from some start cell and try to find a single move whose change makes it succeed from that cell. Why does that make every move relevant?

[Solution](#c12-exercise-1-solution)
:::

::: exercise
### Exercise 2 {#c12-exercise-2}

Take a problem of your own with the shape "there is … for all …", or one from the library's problem categories (such as Graphs or Voting), and follow the five steps. Keep the blocking run.

[Solution](#c12-exercise-2-solution)
:::

::: exercise
### Exercise 3: a fresh problem, abduction from start to finish {#c12-exercise-fresh}

Follow the five steps of this chapter on abduction (sets of hypotheses that explain the observations): the starter is step 2, the real check with blocking. Write step 3 (a `relevant/1` rule, tested against the starter's count), and decide whether step 4 is worth it. [Playground: guide-12-ex2-abduction-block]{.play}

[Solution](#c12-exercise-fresh-solution)
:::

::: recap
### Recap

- Quantifiers, abstraction with an empty check, real check and glue, blocking run, first refinement, soundness test, measurement, clause or rule, shape, and only then larger constants.
- Before you trust a loop, go through the checklist.
:::

### Answers {#c12-answers .answers}

::: {.answer #c12-predict-1-answer}
[Back to the question](#c12-predict-1)

3\. Once the plan works from three well-chosen start cells, it works from everywhere, and the 80 solutions follow with almost no wasted candidates.
:::

::: {.answer #c12-exercise-1-solution}
[Back to Exercise 1](#c12-exercise-1)

Any plan that ends in the goal from that cell differs from the failing one in some moves. If a move were not marked, the clause would also rule out plans that differ from the candidate only in that move, and one of them might work from every cell: a lost solution (chapter 4). The moves the robot "wastes" against a wall look irrelevant, but changing one of them changes where it is for the rest of the plan. [Playground: guide-12-step3-clause]{.play}
:::

::: {.answer #c12-exercise-2-solution}
[Back to Exercise 2](#c12-exercise-2)

There is no single answer. Start from the starter project of the Tutorial tab (New project gives the four fragments with comments), and check each step against the checklist above. [Playground: starter]{.play}
:::

::: {.answer #c12-exercise-fresh-solution}
[Back to Exercise 3: a fresh problem, abduction from start to finish](#c12-exercise-fresh)

The starter finds 17 explanations after 22 candidates; the library example, with a clause from the counterexample, finds the same 17 after 20. On so small an instance step 4 does not pay: the measure, not the elegance of the refinement, decides. [Playground: abduction]{.play}
:::

## 2QBF, by clauses and by expansion {#c13}

::: lead
Part II takes loops from the research literature and derives each one from a blocking loop, as Part I did for its running example. The first is the problem every CEGAR loop in this guide reduces to: a quantified Boolean formula with two blocks. Its quantifiers are given, so finding the interface is easy; the interesting choice is what to learn from a counterexample: a clause, or a copy of the formula.
:::

### The problem {#c13-problem}

A 2QBF asks for an assignment to the variables x~1~ … x~n~ such that *for every* assignment to y~1~ … y~m~ a formula holds. Here the formula is in disjunctive normal form: a disjunction of terms, each a conjunction of up to three literals. The formula of this chapter is random, with twelve x-variables, five y-variables and sixteen terms; the facts `xlit(T,I,S)` and `ylit(T,J,S)` say that term T has the literal on x~I~ or y~J~ with sign S.

The exists block is the abstraction (any x-assignment), the forall block the check. A counterexample is a y-assignment under which every term is false:

```asp
1 { yval(J,0); yval(J,1) } 1 :- yvar(J).
% The y-assignment closes a term when it makes one of its y-literals false.
closed(T) :- ylit(T,J,S), yval(J,1-S).
% A term that stays open must be false because of the candidate: bad(T,I) says that
% the literal on x_I in term T is false.
bad(T,I) :- xlit(T,I,1), not x(I).
bad(T,I) :- xlit(T,I,0), x(I).
falsified(T) :- closed(T).
falsified(T) :- bad(T,_).
:- term(T), not falsified(T).
```

::: listing-source
From the fragment `check` of `guide-13-qbf-block`.
:::

A term is false when the y-assignment *closes* it (one of its y-literals is false) or when the candidate makes one of its x-literals false (`bad/2`).

### The blocking loop {#c13-block}

The baseline blocks every refuted candidate on its own:

```loop
search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.block(M)
```

::: listing-source
From the loop script of `guide-13-qbf-block`.
:::

It looks at all 4,096 x-assignments, finds 2,448 solutions and blocks the other 1,648, each with a clause of 12.0 literals. [Playground: guide-13-qbf-block]{.play}

### A clause from the counterexample {#c13-clause}

Chapter 3's question applies unchanged: for which other candidates is this y-assignment still a counterexample? The terms it closes stay false whatever x does. Every other term is false only because of a false x-literal, and it stays false as long as those literals stay false. So the clause "flip one of the false x-literals of an open term" holds for every solution:

```asp
relevant(x(I)) :- bad(T,I), not closed(T).
```

::: listing-source
From the fragment `check` of `guide-13-qbf-clause`.
:::

With `reject M with G.clause(X)` the loop needs 3,168 candidates and 720 clauses of 8.4 literals on average. [Playground: guide-13-qbf-clause]{.play}

This is the loop of Part I, and it is also a published algorithm: the CEGAR procedure for 2QBF of Janota and Marques-Silva learns exactly such a clause (they call it a *strategy* clause) from each counterexample.

### Learning a copy of the formula {#c13-expansion}

A counterexample y-assignment says more than "these literals must change". It says: under these y-values, the formula must still be true. That is a formula over x alone, the formula *instantiated* with the counterexample. Adding it to the abstraction rules out every candidate this y-assignment refutes, now and later, not only those that agree on the named literals.

A program part does this (chapter 9): it is grounded once per counterexample, with the counterexample's `yval/2` atoms as facts `cex(k,…)`:

```asp
#program refine(k).
% cex(k,yval(J,B)): the k-th counterexample gives y_J the value B.
% It closes the terms that have a y-literal with the other value ...
closed(k,T) :- ylit(T,J,S), cex(k,yval(J,1-S)).
% ... and the candidate has to make one of the remaining terms true.
holds(k,T) :- term(T), not closed(k,T), x(I) : xlit(T,I,1); not x(I) : xlit(T,I,0).
:- not holds(k,T) : term(T).
```

::: listing-source
From the fragment `refine` of `guide-13-qbf-expansion`.
:::

```loop
    X = C.solve(assume G(M))
    if X:
        A.expand(refine, cex = X.atoms(yval/2))
    else:
        accept M
        A.add(G.block(M))
```

::: listing-source
From the loop script of `guide-13-qbf-expansion`.
:::

::: {.predict #c13-predict-1}
Predict: the clause loop met 720 counterexamples. How many will expansion meet? [Answer](#c13-predict-1-answer)
:::

The loop meets 6 counterexamples and looks at 2,454 candidates: the 2,448 solutions and the six refuted ones. The price is in the abstraction: its ground program grows from 92 to 266 rules, a copy of the formula per counterexample. The loop is a Shape 2 loop (chapter 8) because a program part needs a fresh solve of A. [Playground: guide-13-qbf-expansion]{.play}

### Clauses or copies {#c13-compare}

| Refinement | Candidates | Counterexamples | Mean clause | Rules of A | Solutions |
|---|---:|---:|---:|---:|---:|
| Block | 4,096 | 1,648 | 12.0 | 92 | 2,448 |
| Clause | 3,168 | 720 | 8.4 | 92 | 2,448 |
| Expansion | 2,454 | 6 | – | 266 | 2,448 |

Here most candidates are solutions, so no loop can look at fewer than 2,448 of them; the difference is in the wrong ones. A clause is cheap but weak: it names the literals that made *this* candidate fail. A copy is strong but grows the abstraction by the size of the formula. With few y-variables, as here, there are few distinct counterexamples to copy, and expansion wins. With many y-variables and a large formula the copies fill the memory, and solvers such as RAReQS mix the two: they expand only the part of the formula that the counterexample touches.

::: paper
### The paper

Expansion with counterexamples is the core of **AReQS** (Janota, Klieber, Marques-Silva and Clarke, "Solving QBF with counterexample guided refinement", SAT 2012; journal version in Artificial Intelligence 234, 2016). The clause loop is the 2QBF algorithm of Janota and Marques-Silva ("Abstraction-based algorithm for 2QBF", SAT 2011). AReQS for two levels, in the paper's notation, and the loop script line by line:

| Paper | Loop script |
|---|---|
| α ← true | solver A = shared + abstraction + refine |
| τ ← SAT(α); if none, return false | `M = A.solve()`; `if not M: stop` |
| μ ← SAT(¬φ\[τ\]); if none, return τ | `X = C.solve(assume G(M))`; `accept M` |
| α ← α ∧ φ\[μ\] | `A.expand(refine, cex = X.atoms(yval/2))` |

The paper stops at the first τ (is the formula true?); the guide's loop blocks it and goes on, to count all solutions. The full bibliography is on the [bibliography page](#bibliography).
:::

::: exercise
### Exercise 1 {#c13-exercise-1}

The clause names every false x-literal of every open term. Is that more than needed? Find a shorter clause that is still satisfied by every solution, and predict its effect on the number of candidates.

[Solution](#c13-exercise-1-solution)
:::

::: recap
### Recap

- In a QBF the quantifier blocks are the abstraction and the check; the loop of Part I is a known 2QBF algorithm.
- A counterexample can be learnt as a clause (cheap, weak) or as a copy of the problem instantiated with it (strong, grows the abstraction).
- A clause needs only enough literals to keep the counterexample a counterexample; often one per reason suffices.
:::

### Answers {#c13-answers .answers}

::: {.answer #c13-predict-1-answer}
[Back to the question](#c13-predict-1)

6\. After six copies the abstraction holds the formula for six y-assignments, and every x-assignment that satisfies those six satisfies all thirty-two: the check never fails again.
:::

::: {.answer #c13-exercise-1-solution}
[Back to Exercise 1](#c13-exercise-1)

One false x-literal per open term is enough: while it stays false, the term stays false, and so the y-assignment stays a counterexample. Pick, say, the one with the smallest index:

```asp
relevant(x(I)) :- bad(T,I), not closed(T), I = #min { J : bad(T,J) }.
```

The clauses get shorter (6.4 literals instead of 8.4) and the loop needs 2,732 candidates instead of 3,168, with the same 2,448 solutions. Which literal to pick is a free choice; a different rule gives a different, equally sound clause. [Playground: guide-13-ex1]{.play}
:::

## Implicit hitting sets {#c14}

::: lead
Chapter 10 refined a witness check with its unsatisfiable core, and chapter 11 asked the abstraction for an optimal candidate. Put the two together and you get one of the most successful MaxSAT algorithms, the implicit hitting set loop of MaxHS. This chapter derives it in three steps from a blocking loop, and shows what the bounds say along the way.
:::

### The problem {#c14-problem}

Weighted MaxSAT: a CNF formula with *hard* clauses that must hold and *soft* clauses with weights. Find an assignment that satisfies the hard clauses and falsifies soft clauses of the smallest total weight. The instance has eight variables, sixteen soft clauses with weights 1 to 5 and four hard clauses; the optimum is 8.

Turn it into a loop by naming what the abstraction guesses: the set of soft clauses to give up. It prefers cheap sets:

```asp
{ drop(C) : soft(C,_) }.
% Each call is optimal (A.solve(optimal)): the cheapest set that hits every core so far.
% Its cost is a lower bound on the optimum.
#minimize { W,C : drop(C), soft(C,W) }.
```

::: listing-source
From the fragment `abstraction` of `guide-14-ihs-block`.
:::

The check is a SAT call on the clauses that are kept: a *witness* check (chapter 10). If it finds an assignment, the drop set is good; if not, it is wrong.

```asp
{ t(V) } :- var(V).
sat(C) :- pos(C,V), t(V).
sat(C) :- neg(C,V), not t(V).
:- hard(C), not sat(C).
:- soft(C,_), not drop(C), not sat(C).
```

::: listing-source
From the fragment `check` of `guide-14-ihs-block`.
:::

### Step 1: block {#c14-block}

Ask for the cheapest drop set, check it, block it if the rest is unsatisfiable. The first drop set with a witness is optimal, because every cheaper one was refuted (chapter 11):

```loop
loop:
    M = A.solve(optimal)
    if not M: stop "the hard clauses are unsatisfiable"
    if C.solve(assume G(M)):
        accept M
        stop
    A.add(G.block(M))
```

::: listing-source
From the loop script of `guide-14-ihs-block`.
:::

It finds the optimum after 198 drop sets, each blocked by a clause of all 16 soft clauses. [Playground: guide-14-ihs-block]{.play}

### Step 2: learn the core {#c14-core}

A failed SAT call has a core: a set of kept soft clauses that cannot all hold together with the hard clauses. Every drop set that keeps all of them fails too, so the next one must drop at least one clause of the core. `G.core(C)` is that clause:

```loop
    if C.solve(assume G(M)):
        accept M
        stop
    A.add(G.core(C))
```

::: listing-source
From the loop script of `guide-14-ihs-core`.
:::

Now look at what the abstraction has become. It knows nothing about the formula; it holds a list of sets (the cores) and finds the cheapest set of soft clauses that meets every one of them: an optimal *hitting set*. The cores are never listed in advance, only discovered one at a time; hence "implicit" hitting sets. The loop needs 57 drop sets; the clauses have 10.7 literals on average. [Playground: guide-14-ihs-core]{.play}

### Two bounds {#c14-bounds}

Each hitting set is optimal for the cores found so far, and the true optimum must hit all cores, found or not. So the cost of each hitting set is a *lower bound* on the optimum, and the bound never drops. Any assignment the check finds, on the other hand, falsifies some soft clauses, and their weight is an *upper bound*. The loop is done when the two meet. In the playground, `track lower = M.cost` draws the lower bound in the Statistics tab, call by call.

### Step 3: minimal cores {#c14-minimal}

clasp's cores are not minimal (chapter 10), and a core with extra clauses is a weak constraint for the hitting-set solver. `C.core.minimal` shrinks the core until no clause can be left out:

```loop
    track lower = M.cost
    if C.solve(assume G(M)):
        accept M
        stop
    A.add(C.core.minimal.on(G))
```

::: listing-source
From the loop script of `guide-14-ihs-minimal`.
:::

::: {.predict #c14-predict-1}
Predict: step 2 needed 57 hitting sets. How many with minimal cores, and what do they cost? [Answer](#c14-predict-1-answer)
:::

[Playground: guide-14-ihs-minimal]{.play}

### The full loop: several cores per round {#c14-maxhs}

One more idea makes each hitting-set call count. After a core is found, relax it (take its clauses out of the assumptions) and ask the SAT oracle again in the same round: any core it now finds is disjoint from the first. One round can deliver several cores before the expensive optimal call.

```loop
    loop:
        X = C.solve(assume E)
        if X:
            if upper == none or X.cost < upper: upper = X.cost
            break
        K = C.core.minimal             # no assumption of it can be left out
        if K.on(G).size == 0: stop "the hard clauses are unsatisfiable"
        A.add(K.on(G))                 # hit at least one clause of the core
        cores = cores + 1
        count cores
        for a in K:                    # relax the core's clauses, look for a disjoint one
            E = E.without(a)
```

::: listing-source
From the loop script of `maxsat-ihs`.
:::

The library example `maxsat-ihs` needs 5 hitting sets and 67 check calls, and it also tracks the upper bound from each witness's cost. In the Statistics tab the two lines meet at 8. [Playground: maxsat-ihs]{.play}

| Step | Hitting sets | Check calls | Mean clause |
|---|---:|---:|---:|
| Block | 198 | 198 | 16.0 |
| Core | 57 | 57 | 10.7 |
| Minimal core | 6 | 65 | 2.8 |
| Disjoint minimal cores | 5 | 67 | 2.8 |

::: paper
### The paper

The implicit hitting set loop for MaxSAT is due to Davies and Bacchus ("Solving MAXSAT by solving a sequence of simpler SAT instances", CP 2011); MaxHS, their solver, uses an integer programming solver for the hitting sets ("Exploiting the power of MIP solvers in MAXSAT", SAT 2013). The general scheme is Moreno-Centeno and Karp's ("The implicit hitting set approach to solve combinatorial optimization problems", Operations Research 2013).

| Paper | Loop script |
|---|---|
| K ← ∅ | solver A starts with no clause on `drop/1` |
| hs ← Opt-HS(K) | `M = A.solve(optimal)` |
| (sat, κ) ← SAT(F~h~ ∪ F~s~ \\ hs) | `C.solve(assume G(M))`, `C.core.minimal` |
| if sat: return hs's assignment | `accept M`; `stop` |
| K ← K ∪ {κ} | `A.add(K.on(G))` |

More papers are on the [bibliography page](#bibliography).
:::

::: exercise
### Exercise 1 {#c14-exercise-1}

The library example `smallest-mus` looks for a set of at most k clauses of a formula that are unsatisfiable together. It is the dual of MaxSAT. What plays the role of the cores there, and what is the hitting-set problem?

[Solution](#c14-exercise-1-solution)
:::

::: recap
### Recap

- An optimal abstraction refined by cores of a witness check is an implicit hitting set loop: each candidate's cost is a lower bound.
- A witness's cost is an upper bound; the loop may stop when the bounds meet.
- When the abstraction's calls are the expensive ones, spend check calls on short (minimal, disjoint) cores.
:::

### Answers {#c14-answers .answers}

::: {.answer #c14-predict-1-answer}
[Back to the question](#c14-predict-1)

6 hitting sets, from cores of 2.8 clauses on average. The price is paid in the check: shrinking takes up to one solve per clause of the core, so the check is called 65 times against 57. The check calls are cheap SAT calls; the hitting-set calls are optimisation problems, which is why MaxHS prefers to spend effort on the cores.
:::

::: {.answer #c14-exercise-1-solution}
[Back to Exercise 1](#c14-exercise-1)

The abstraction picks clauses; the check looks for an assignment that satisfies all the picked ones. Such an assignment falsifies some other clauses, and one of those must be picked next: the set of clauses an assignment falsifies is a correction set, and the picked set must hit every correction set. So the roles swap: in MaxSAT the abstraction hits cores, in the smallest-MUS loop it hits correction sets. This duality between unsatisfiable cores and correction sets is the hitting-set duality behind MARCO, the next chapter. [Playground: smallest-mus]{.play}
:::

## MARCO: two kinds of answer {#c15}

::: lead
So far a check either refuted a candidate or let it through. In MARCO both outcomes are answers worth keeping, and both refine the abstraction, in opposite directions. The chapter enumerates the minimal unsatisfiable subsets of a formula, starting from a loop that looks at every subset.
:::

### The problem {#c15-problem}

A CNF formula with ten clauses over four variables is unsatisfiable. Which subsets of its clauses are *minimal unsatisfiable subsets* (MUSes): unsatisfiable, but satisfiable as soon as any one clause is left out? MUSes are the explanations of unsatisfiability, and debugging tools for specifications and configurations enumerate them. Their partners are the *maximal satisfiable subsets* (MSSes): satisfiable, but unsatisfiable as soon as any other clause is added.

The abstraction, here called the *map*, guesses a subset of the clauses (a *seed*); the check asks whether the seed is satisfiable:

```asp
{ t(V) } :- var(V).
sat(C) :- pos(C,V), t(V).
sat(C) :- neg(C,V), not t(V).
:- pick(C), not sat(C).
```

::: listing-source
From the fragment `check` of `guide-15-mus-block`.
:::

### Every subset once {#c15-block}

A seed is a MUS when the check fails on it and succeeds on every seed with one clause less. The baseline tests exactly that, and blocks every seed after looking at it:

```loop
    if not C.solve(assume E):
        minimal = true
        for a in E:
            if a.true and not C.solve(assume E.flip(a)): minimal = false
        if minimal: accept M
    A.add(G.block(M))
```

::: listing-source
From the loop script of `guide-15-mus-block`.
:::

`E = G(M)` is the seed as a list of assumptions, and `E.flip(a)` the same list with one clause taken out (or put in). The loop finds the 7 MUSes after looking at all 1,024 subsets, with 4,614 check calls. [Playground: guide-15-mus-block]{.play}

### Shrink, and block upwards {#c15-shrink}

An unsatisfiable seed need not be minimal, but it contains a MUS: drop clauses one by one, keeping each drop that leaves the seed unsatisfiable. What is left is a MUS. And every superset of a MUS is unsatisfiable and not minimal, so none of them need ever be proposed again: `G.above(E)` is the clause "leave out at least one clause of E".

```loop
    else:
        for a in E:
            if a.true and not C.solve(assume E.flip(a)): E = E.flip(a)
        accept A.solve(assume E)
        A.add(G.above(E))
```

::: listing-source
From the loop script of `guide-15-mus-above`.
:::

Each MUS is now found once, from whichever unsatisfiable seed leads to it, and the loop needs 410 seeds. Most of them are satisfiable seeds, still blocked one at a time. [Playground: guide-15-mus-above]{.play}

### Grow, and block downwards {#c15-grow}

The satisfiable seeds have the mirror image. Add clauses one by one, keeping each addition that leaves the seed satisfiable; what is left is an MSS. Every subset of an MSS is satisfiable, so none needs to be proposed again: `G.below(E)` is the clause "add at least one clause outside E". That is the MARCO loop:

```loop
    if C.solve(assume E):
        for a in E:
            if not a.true and C.solve(assume E.flip(a)): E = E.flip(a)
        accept A.solve(assume E) as mss
        A.add(G.below(E))
    else:
        for a in E:
            if a.true and not C.solve(assume E.flip(a)): E = E.flip(a)
        accept A.solve(assume E)
        A.add(G.above(E))
```

::: listing-source
From the loop script of `marco`.
:::

::: {.predict #c15-predict-1}
Predict: there are 7 MUSes and 12 MSSes. Every seed MARCO proposes ends in one of them. How many seeds will it propose? [Answer](#c15-predict-1-answer)
:::

Both kinds of answer refine the map, one upwards and one downwards, and the map is empty after 19 clauses of 3.5 literals on average. [Playground: marco]{.play}

| Loop | Map calls | Clauses | Check calls | MUSes |
|---|---:|---:|---:|---:|
| Every subset | 1,024 | 1,024 | 4,614 | 7 |
| Shrink, block upwards | 410 | 403 | 456 | 7 |
| MARCO: also grow, block downwards | 38 | 19 | 118 | 7 |

### A second kind of solution {#c15-second-kind}

The MSSes are answers too: their complements are the minimal correction sets, the smallest ways to repair the formula. The loop reports MUSes as solutions and MSSes as a second kind of solution: `accept … as mss` lists each one in the Output tab's messages and counts them next to the solutions ("7; also 12 mss") and in the Statistics tab, without counting them as solutions. The MUSes and the minimal correction sets are each other's minimal hitting sets, the duality that the exercise of chapter 14 met from the other side.

::: paper
### The paper

MARCO is from Liffiton and Malik ("Enumerating infeasibility: finding multiple MUSes quickly", CPAIOR 2013) and Liffiton, Previti, Malik and Marques-Silva ("Fast, flexible MUS enumeration", Constraints 21, 2016). Previti and Marques-Silva's eMUS ("Partial MUS enumeration", AAAI 2013) is the same loop.

| Paper | Loop script |
|---|---|
| while map is satisfiable: seed ← getUnexplored() | `M = A.solve()`; `if not M: stop` |
| if sat(seed): MSS ← grow(seed); block down | the `for a in E` walk; `A.add(G.below(E))` |
| else: MUS ← shrink(seed); block up | the other walk; `A.add(G.above(E))` |
| getUnexploredMax (maximal seeds first) | `#heuristic pick(C) : cl(C). [1,true]` with `--heuristic=Domain` |

More papers are on the [bibliography page](#bibliography).
:::

::: exercise
### Exercise 1 {#c15-exercise-1}

The map proposes maximal seeds first, as the paper's `getUnexploredMax` does. Change the heuristic so that it proposes the smallest seeds first. What happens to the number of seeds and to the number of check calls?

[Solution](#c15-exercise-1-solution)
:::

::: recap
### Recap

- When both outcomes of a check are answers, both can refine the abstraction: an answer and everything it implies leave the map.
- Shrink a failing candidate and grow a passing one before learning from it: the clause then covers a whole up-set or down-set.
- The order of the seeds does not change the answers, but it changes the cost of reaching them.
:::

### Answers {#c15-answers .answers}

::: {.answer #c15-predict-1-answer}
[Back to the question](#c15-predict-1)

38 calls of the map, of which 19 become an answer (7 MUSes and 12 MSSes, each found exactly once, because its clause removes it from the map). The other calls are the `A.solve(assume E)` inside the loop, which turn the shrunk or grown list back into atoms for the output.
:::

::: {.answer #c15-exercise-1-solution}
[Back to Exercise 1](#c15-exercise-1)

Change the sign of the heuristic to `false`:

```asp
#heuristic pick(C) : cl(C). [1,false]
```

The map still makes 38 calls: every answer is found once whatever the order. But small seeds are mostly satisfiable and must be grown a long way, so the check is called 132 times instead of 118. With many clauses and few MUSes, the order decides which kind of answer comes first; MARCO's authors prefer maximal seeds when MUSes are what is wanted. [Playground: guide-15-ex1]{.play}
:::

## CEGIS: synthesis from counterexamples {#c16}

::: lead
Counterexample-guided inductive synthesis is CEGAR for programs: a synthesiser proposes a program, a verifier looks for an input on which it is wrong. The twist is what the synthesiser learns: not a clause about the program, but the input itself. This chapter synthesises small Boolean circuits.
:::

### The problem {#c16-problem}

Find every circuit of g two-input gates (and, or, nand) over m = 3 inputs that computes the majority of its inputs. The synthesiser guesses a circuit: a kind and two earlier nodes for each gate. The verifier holds the specification, which the synthesiser never sees:

```asp
ones(N) :- N = #count { I : x(I) }.
spec :- ones(N), 2 * N > m.
:- out, spec.
:- not out, not spec.
```

::: listing-source
From the fragment `check` of `guide-16-cegis-block`.
:::

A counterexample is an input `x/1` on which the circuit's output `out` and the specification disagree. It is an ∃∀ problem: is there a circuit such that for every input it is right?

### Blocking circuits {#c16-block}

With three gates, the blocking loop looks at 1,215 circuits and finds 0: no circuit of three gates computes the majority of three inputs. Each refuted circuit is blocked by a clause of 28.0 literals. With four gates the blocking loop does not finish within a minute. [Playground: guide-16-cegis-block]{.play}

### Learning the input {#c16-cegis}

A counterexample is an input and the output the specification wants there. Every circuit that gives another output on that input is wrong too. So hand the input to the synthesiser and make it simulate every circuit on it: a program part grounded once per input.

```asp
#program refine(k).
% The k-th counterexample input: cex(k,inval(I,V)) gives input I the value V, and
% goal(k,want(V)) the value the specification wants. Simulate the circuit on this input
% (w(k,N): node N is 1) and require the wanted output.
w(k,I) :- cex(k,inval(I,1)).
w(k,G) :- arg(G,A,B), op(G,and), w(k,A), w(k,B).
w(k,G) :- arg(G,A,B), op(G,or), w(k,A).
w(k,G) :- arg(G,A,B), op(G,or), w(k,B).
w(k,G) :- arg(G,A,B), op(G,nand), not w(k,A).
w(k,G) :- arg(G,A,B), op(G,nand), not w(k,B).
:- outnode(N), w(k,N), goal(k,want(0)).
:- outnode(N), not w(k,N), goal(k,want(1)).
```

::: listing-source
From the fragment `abstraction` of `guide-16-cegis`.
:::

```loop
    if X:
        A.expand(refine, cex = X.atoms(inval/2), goal = X.atoms(want/1))
        count inputs
```

::: listing-source
From the loop script of `guide-16-cegis`.
:::

::: {.predict #c16-predict-1}
Predict: there are eight inputs of three bits. How many counterexamples can the CEGIS loop meet at most, and how many does it need to show that three gates are not enough? [Answer](#c16-predict-1-answer)
:::

The loop needs 7 circuits instead of 1,215. With four gates it finds all 27 circuits after 34 candidates and the same 7 inputs. The specification never leaves the verifier: the synthesiser knows only examples. [Playground: guide-16-cegis]{.play}

This is the expansion of chapter 13 in another costume: a counterexample instantiates the problem (here, the circuit's behaviour on one input) inside the abstraction.

::: paper
### The paper

CEGIS was introduced with program sketching by Solar-Lezama, Tancau, Bodík, Seshia and Saraswat ("Combinatorial sketching for finite programs", ASPLOS 2006).

| Paper | Loop script |
|---|---|
| inputs ← ∅ | solver A without refine parts |
| P ← synthesise(inputs); if none, fail | `M = A.solve()`; `if not M: stop` |
| x ← verify(P); if none, return P | `X = C.solve(assume G(M))`; `accept M` |
| inputs ← inputs ∪ {x} | `A.expand(refine, cex = …, goal = …)` |

The library example `min-dnf` synthesises shortest DNF formulas the same way. More papers are on the [bibliography page](#bibliography).
:::

::: exercise
### Exercise 1 {#c16-exercise-1}

Change the specification to the parity (exclusive or) of m = 2 inputs. How many gates does the smallest circuit need, and how many inputs does CEGIS use to find out?

[Solution](#c16-exercise-1-solution)
:::

::: recap
### Recap

- In synthesis the counterexample is an input; learning it (simulating the candidate on it) rules out every program that is wrong there.
- The specification can stay in the verifier; the synthesiser needs only the examples.
- The number of counterexamples is bounded by the number of inputs, not of programs.
:::

### Answers {#c16-answers .answers}

::: {.answer #c16-predict-1-answer}
[Back to the question](#c16-predict-1)

At most eight: once an input is grounded, no circuit that is wrong on it is proposed again. It needs 7: after seven inputs no circuit of three gates is right on all of them, and the synthesiser has no candidate left.
:::

::: {.answer #c16-exercise-1-solution}
[Back to Exercise 1](#c16-exercise-1)

```asp
spec :- ones(N), N \ 2 == 1.
```

Two gates are not enough: CEGIS proves it with all 4 inputs. Three gates are: the loop finds 2 circuits (the and of an or and a nand, in both orders of their inputs) after 4 counterexamples. [Playground: guide-16-ex1]{.play}
:::

## Core-guided optimisation: OLL {#c17}

::: lead
The hitting-set loop of chapter 14 kept two solvers: an optimiser that knows only the cores, and a SAT oracle that knows only the formula. Core-guided algorithms keep one solver and let each core *relax* the problem it solves. The refinement no longer cuts candidates away; it changes what the solver is asked.
:::

### The problem {#c17-problem}

Unweighted MaxSAT: a random formula over five variables with forty soft clauses and two hard ones; the optimum violates six soft clauses. The library example `maxsat-oll` solves it with OLL.

### For comparison: hitting sets {#c17-ihs}

The MaxHS loop of chapter 14, on the same formula with every weight 1, needs 6 hitting sets, but finds 21 cores along the way, with 289 calls of the SAT oracle (shrinking the cores is most of them). [Playground: guide-17-ihs]{.play}

### One solver, relaxed by its cores {#c17-oll}

OLL calls one solver under the assumptions "every soft constraint holds". A core is a set of soft constraints that cannot all hold: at least one of them is violated in every solution, so the lower bound rises by one. Instead of telling another solver about it, OLL stops assuming the core's constraints and adds new soft constraints: "at most one of them is violated", "at most two", and so on. A program part grounds them (a totaliser) once per core:

```asp
size(k,N) :- N = #count { T : core(k,T) }.
over(k,J) :- size(k,N), J = 2..N, #count { T : core(k,T), viol(T) } >= J.
viol(over(k,J)) :- over(k,J).
```

::: listing-source
From the fragment `check` of `maxsat-oll`.
:::

```loop
    K = C.core
    if K.size == 0: stop "the hard clauses are unsatisfiable"
    lower = lower + 1
    for a in K:                    # relax the core's soft constraints
        E = E.without(a)
    C.expand(relax, core = K)      # facts core(k,T): the core's atoms (B2)
```

::: listing-source
From the loop script of `maxsat-oll`.
:::

The new soft constraints `over(k,J)` are then assumed false. A core over them says that some earlier core must lose two of its constraints, and so on: every core raises the bound by one, and the first satisfiable call is optimal.

On this formula OLL meets 6 cores, one per unit of the optimum, with 7 calls in all. [Playground: maxsat-oll]{.play}

### Cutting or relaxing {#c17-compare}

| Loop | Cores | Solver calls (check) | Optimiser calls |
|---|---:|---:|---:|
| Implicit hitting sets (minimal, disjoint cores) | 21 | 289 | 6 |
| OLL | 6 | 7 | – |

The two loops learn from the same cores but use them differently. The hitting-set loop *cuts*: each core is a clause for a separate optimiser, and the expensive calls are the optimiser's. OLL *relaxes*: each core grows the one solver's program by a totaliser, and every call is a plain satisfiability call under assumptions. On unweighted instances with a small optimum, as here, OLL needs one core per unit of cost; with many distinct weights, the hitting-set loop is often the better choice.

::: paper
### The paper

OLL was introduced for clasp by Andres, Kaufmann, Matheis and Schaub ("Unsatisfiability-based optimization in clasp", ICLP 2012) and named and studied for MaxSAT by Morgado, Dodaro and Marques-Silva ("Core-guided MaxSAT with soft cardinality constraints", CP 2014). Fu and Malik's algorithm ("On solving the partial MAX-SAT problem", SAT 2006) is its ancestor: it relaxes each core with fresh blocking variables and an at-most-one constraint.

| Paper | Loop script |
|---|---|
| A ← all soft constraints | `E = G(A.solve(optimal))` |
| (sat, κ) ← SAT(hard, A) | `X = C.solve(assume E)`; `K = C.core` |
| lb ← lb + 1 | `lower = lower + 1` |
| A ← A \\ κ ∪ {¬o~2~}; add totaliser(κ) | `E = E.without(a)`; `C.expand(relax, core = K)`; push `over(k,2)` |

More papers are on the [bibliography page](#bibliography).
:::

::: exercise
### Exercise 1 {#c17-exercise-1}

The example is unweighted. What breaks when soft clauses have different weights, and how do the algorithms in the literature repair it?

[Solution](#c17-exercise-1-solution)
:::

::: recap
### Recap

- A core can cut (a clause for another solver) or relax (new soft constraints in the same solver).
- In core-guided optimisation each core raises the lower bound; the first satisfiable call is optimal.
- Relaxing suits small optima and few weights; cutting suits many weights and a strong optimiser.
:::

### Answers {#c17-answers .answers}

::: {.answer #c17-exercise-1-solution}
[Back to Exercise 1](#c17-exercise-1)

A core then raises the bound by the smallest weight in it, not by one. Weighted OLL splits each soft constraint of the core in two: one part with that smallest weight, which is relaxed, and the rest, which stays assumed, as in WPM1 and weighted OLL. Stratification first solves with the heaviest clauses only and adds lighter strata later. The hitting-set loop needs neither: the optimiser takes the weights directly, which is one reason MaxHS is strong on weighted instances. [Playground: maxsat-ihs]{.play}
:::

## Benders decomposition {#c18}

::: lead
Operations research has its own CEGAR loop. Benders decomposition splits a problem into a master, which decides some variables and estimates the cost of the rest, and a subproblem, which computes that cost exactly. When the estimate is too low, a *cut* tells the master. The design question is the one of chapter 3: how many master solutions should a cut cover?
:::

### The problem {#c18-problem}

Assign six jobs to two machines and sequence each machine, so that the assignment cost plus the total tardiness is smallest. The master (the abstraction, solved with `A.solve(optimal)`) assigns jobs and guesses an estimate `est(M,V)` of each machine's tardiness, cheapest first. The subproblem (the check, solved with `optimal`) sequences each machine and reports a machine whose estimate is below its real tardiness.

### Optimality cuts as rules {#c18-cuts}

If machine M runs jobs S with total tardiness V, then any assignment that gives M at least the jobs S has tardiness at least V on M: more jobs never finish earlier. That is the cut, grounded from a program part once per subproblem:

```asp
need(k,M,V) :- machine(M), cut(k,has(M,_)), V = #sum { L,J : lateness(k,late(J,L)), cut(k,has(M,J)) }.
covered(k,M) :- need(k,M,_), assign(J,M) : cut(k,has(M,J)).
:- covered(k,M), need(k,M,V), est(M,E), E < V.
```

::: listing-source
From the fragment `abstraction` of `benders-tardiness`.
:::

```loop
    if X.count(bad/1) == 0:
        log "optimum:", M.cost
        accept M
        stop
    count cuts by X.count(bad/1)
    A.expand(refine, cut = X.atoms(has/2), lateness = X.atoms(late/2))
```

::: listing-source
From the loop script of `benders-tardiness`.
:::

The master's optimum is a lower bound; its cost with the estimates replaced by the real tardiness is a feasible cost, an upper bound (`track` draws both). They meet at the optimum, 20, after 26 master solutions and 25 cuts. [Playground: benders-tardiness]{.play}

### A weaker cut {#c18-exact}

The cut above covers every superset of S. A cut that covers only assignments that give M exactly the jobs S is also sound, but weaker:

```asp
covered(k,M) :- need(k,M,_), assign(J,M) : cut(k,has(M,J)); not assign(J,M) : job(J,_,_), not cut(k,has(M,J)).
```

::: listing-source
From the fragment `abstraction` of `guide-18-benders-exact`.
:::

::: {.predict #c18-predict-1}
Predict: the superset cut needed 26 master solutions. How many with the exact-set cut? [Answer](#c18-predict-1-answer)
:::

Both reach the same optimum; the stronger cut needs half the master solutions. Logic-based Benders lives on such arguments ("more jobs never help"): they are what lifts a cut from one assignment to many, exactly like `relevant/1` lifts a clause from one candidate to many. [Playground: guide-18-benders-exact]{.play}

::: paper
### The paper

Logic-based Benders decomposition is due to Hooker and Ottosson ("Logic-based Benders decomposition", Mathematical Programming, 2003); the classical method is Benders' (1962), for linear programs.

| Paper | Loop script |
|---|---|
| solve the master: x̄, lower bound z | `M = A.solve(optimal)`; `track lower = M.cost` |
| solve the subproblem for x̄: cost v | `X = C.solve(assume G(M), optimal)` |
| if the estimate equals v: optimal | `if X.count(bad/1) == 0: accept M` |
| add the Benders cut B~x̄~(x) ≤ estimate | `A.expand(refine, cut = …, lateness = …)` |

More papers are on the [bibliography page](#bibliography).
:::

::: exercise
### Exercise 1 {#c18-exercise-1}

The library example `knapsack-bounds` is also a Benders-style loop with bounds. Read its loop: what are the master and the subproblem, and what plays the role of the cut?

[Solution](#c18-exercise-1-solution)
:::

::: recap
### Recap

- Benders is a CEGAR loop with an optimal abstraction (the master) and an optimal check (the subproblem).
- A cut is as strong as the set of master solutions it covers; a monotonicity argument lifts it from one assignment to many.
:::

### Answers {#c18-answers .answers}

::: {.answer #c18-predict-1-answer}
[Back to the question](#c18-predict-1)

57\. Every set of jobs on a machine now needs its own cut, even when a subset was already known to be too late.
:::

::: {.answer #c18-exercise-1-solution}
[Back to Exercise 1](#c18-exercise-1)

The master (solver A) chooses the items to lock and claims a value for the follower's best packing; the subproblem (solver C) is that best packing of the unlocked items, solved optimally. Each packing that beats the claim is grounded in the master as rules (the part `refine`): every locked set that leaves this packing possible must claim at least its value. The master's claim is a lower bound, the follower's reply an upper bound, and the loop ends when they meet. [Playground: knapsack-bounds]{.play}
:::

## More than two quantifier levels {#c19}

::: lead
Every loop so far had two levels: a candidate and a check. Problems with three alternating quantifiers, Σ~3~^P^ and beyond, need a check that is itself a loop. This chapter shows two ways to build one: a chain of solvers, and a recursive procedure over a family of solvers.
:::

### A trilevel problem {#c19-problem}

Knapsack interdiction with fortification: a defender fortifies up to two items, an attacker removes up to two unfortified ones, and the defender packs what is left. A fortification is a solution when every attack leaves a packing that reaches the goal: ∃ fortification ∀ attack ∃ packing. Three solvers in a chain: A fortifies, B attacks, C packs.

### Blocking at both levels {#c19-block}

The middle level is a loop of its own: B proposes attacks for the current fortification, and C answers each with a packing or fails. The baseline blocks a refuted attack and a refuted fortification each on its own:

```loop
        loop:
            Y = B.solve(assume GF(M))
            if not Y: break
            K = C.solve(assume GA(Y))
            if K:
                B.add(GA.block(Y))
            else:
                reject M with GF.block(M)
                break
```

::: listing-source
From the loop script of `guide-19-fortify-block`.
:::

### Clauses at both levels {#c19-clauses}

Each level can learn as in Part I. A packing refutes an attack, and every attack that leaves the packed items alone is refuted by it too: "attack one of the packed items". An attack refutes a fortification, and every fortification that leaves the attacked items unprotected is refuted too: "fortify one of the attacked items". The library example `knapsack-fortification` uses these two clauses. It finds the 2 solutions after 7 fortifications and 21 inner calls, against 37 and 137 for blocking. [Playground: knapsack-fortification]{.play} [Playground: guide-19-fortify-block]{.play}

One subtlety: B's clauses must stay valid for *later* fortifications, because B keeps them. "Attack one of the packed items" does not mention the fortification, so it holds for every one. A clause of the middle level that named the outer candidate would have to name its atoms too, as the next section's loop does.

### Cores along a chain {#c19-cores}

In QBF form (∃x ∀y ∃z), the innermost solver is a witness check, and a failure is explained by its core. The library example `qbf-three-blocks` searches B inside A's check and turns the x-part of C's core into a clause for A, CAQE-style: one solver per block, cores flowing outwards. It finds 4 solutions after 34 candidates. [Playground: qbf-three-blocks]{.play}

### Any number of levels {#c19-recursion}

For a formula with any number of blocks, write the check once as a procedure over a family of solvers `S[1..depth]` and links `G`. Level i answers a candidate of level i − 1 with a clause, or with none when it stands:

```loop
def refute(i, M):
    loop:
        Y = S[i].solve(assume G[i-1](M))
        if not Y: return none
        if i == S.size: return G[i-1].clause(Y)
        c = refute(i + 1, Y)
        if not c: return G[i-1].clause(Y) + S[i+1].core.on(G[i-1])
        S[i].add(c)
```

::: listing-source
From the loop script of `qbf-deep`.
:::

This is RAReQS's recursion with clauses in place of expansion. With three blocks the example's formula is false: the loop proves it after 4 candidates; with four blocks (`depth = 4`) after 4 candidates and 36 inner calls. [Playground: qbf-deep]{.play}

::: paper
### The paper

RAReQS: Janota, Klieber, Marques-Silva and Clarke ("Solving QBF with counterexample guided refinement", SAT 2012 and Artificial Intelligence 2016). Clausal abstraction: CAQE (Rabe and Tentrup, FMCAD 2015) and QESTO (Janota and Marques-Silva, IJCAI 2015). Trilevel knapsack interdiction with fortification: Boggio Tomasaz, Carvalho, Cordone and Hosteins.

| Paper (RAReQS) | Loop script |
|---|---|
| one abstraction per quantifier block | `solver S[i in 1..depth]` |
| recursive call on the inner formula | `c = refute(i + 1, Y)` |
| refine the abstraction of level i | `S[i].add(c)` |

More papers are on the [bibliography page](#bibliography).
:::

::: exercise
### Exercise 1 {#c19-exercise-1}

In the fortification loop, B's clause "attack one of the packed items" is learnt inside the check of one fortification and kept for all later ones. Why is that sound, and which clause would not be?

[Solution](#c19-exercise-1-solution)
:::

::: recap
### Recap

- With three levels the check is a loop: a chain of solvers, each refining the one before.
- A clause learnt by an inner level must stay valid for every outer candidate, or name the outer atoms it depends on.
- For any number of levels, a recursive procedure over a solver family writes the loop once.
:::

### Answers {#c19-answers .answers}

::: {.answer #c19-exercise-1-solution}
[Back to Exercise 1](#c19-exercise-1)

A packing that avoids the attacked items exists whatever is fortified, so every attack that leaves those items alone is answered by it, for every fortification: the clause removes no attack that could still win. A clause that used the current fortification (for example "attack an item that is not fortified now") would be valid only for this candidate; B would have to forget it, or name the fortification's atoms in it, before the next candidate. [Playground: knapsack-fortification]{.play}
:::

## Lazy constraints and omission {#c20}

::: lead
Not every loop has a quantifier alternation. Sometimes the abstraction simply leaves out part of an ordinary problem, because that part is too large to ground or because most of it never matters, and the check puts back what does. This chapter shows two such loops: lazy constraints checked inside the search, and omission-based abstraction.
:::

### Lazy constraints {#c20-lazy}

Graphs on eight nodes with at least sixteen edges and no triangle: the abstraction has no triangle constraint, and the check finds a triangle. Each triangle becomes a clause inside the search (Shape 1), so the constraint is generated only where the search needs it: lazy clause generation.

With `on partial`, the check also runs at partial assignments of the search, with the undecided edges taken as absent:

```loop
    on partial P every 8:
        X = C.solve(assume G(P, false))
        if X: reject P with G.clause(X)
```

::: listing-source
From the loop script of `triangle-free-lazy`.
:::

A triangle among the edges chosen so far cuts the whole subtree. The loop needs 136 candidates where the variant `total-only` needs 218, but it calls the check 1,141 times instead of 218. This is branch-and-check (Thorsteinsson): whether it pays depends on how cheap the check is against the search it saves. [Playground: triangle-free-lazy]{.play}

The witness-check version is `colourable-partial`: a core found at a partial assignment names few edges, so its clause is short. It needs 537 candidates against 550, with 6,460 check calls against 5,881. Here the partial checks barely pay: an example where they win on time needs a cheap check and an expensive completion.

### Omission: put back what matters {#c20-omission}

Six queens on a 6 × 6 board. An abstraction that knows rows and columns only proposes permutations; the check finds two queens on a diagonal. Blocking each bad permutation takes 720 candidates, every permutation of six.

Omission-based abstraction keeps the omitted constraints in the program, each guarded by an external atom that starts false, and switches on the ones a candidate breaks:

```asp
#external active(D) : diag(_,_,D).
:- active(D), #count { R,C : q(R,C), diag(R,C,D) } > 1.
```

::: listing-source
From the fragment `abstraction` of `queens-omission`.
:::

```loop
        for v in X.atoms(violated/1):
            A.set(A.atom("active", v.arg(1)), true)
```

::: listing-source
From the loop script of `queens-omission`.
:::

The refinement says nothing about the candidate; it makes the abstraction more like the real problem. With six queens the loop needs 10 candidates; with eight, the 92 solutions take 106 candidates, and only the diagonals some candidate broke are ever switched on. [Playground: queens-omission]{.play} [Playground: guide-20-queens-block]{.play}

::: paper
### The paper

Branch-and-check: Thorsteinsson ("Branch-and-check: a hybrid framework integrating mixed integer programming and constraint logic programming", CP 2001). Omission-based abstraction: Saribatur and Eiter ("Omission-based abstraction for answer set programs", KR 2018).

| Paper (omission) | Loop script |
|---|---|
| abstract program: omit the atoms or rules in Ω | `#external active(D)`, false at the start |
| check the abstract answer set against the full program | `X = C.solve(assume G(M))` |
| refine: Ω ← Ω \\ (what the failure involves) | `A.set(A.atom("active", …), true)` |

More papers are on the [bibliography page](#bibliography).
:::

::: exercise
### Exercise 1 {#c20-exercise-1}

`conformant-growing` grows the planning horizon one step at a time. Is that omission, lazy constraints, or something else?

[Solution](#c20-exercise-1-solution)
:::

::: recap
### Recap

- A constraint that is too large to ground can be generated lazily: the check finds the violated instances, inside the search.
- Checking partial assignments cuts subtrees but costs calls; it pays only when the check is cheap against the search it saves.
- An abstraction can omit part of the program and put it back on demand: the refinement changes the abstraction, not the candidates.
:::

### Answers {#c20-answers .answers}

::: {.answer #c20-exercise-1-solution}
[Back to Exercise 1](#c20-exercise-1)

Omission: the horizon is part of the problem the abstraction leaves out, and the loop puts it back step by step (it grounds more of the program and switches an external query to the new horizon), instead of learning about one candidate. The first horizon with a plan gives the shortest plans. [Playground: conformant-growing]{.play}
:::

## A case study: explaining voting outcomes {#c21}

::: lead
The other chapters derive one algorithm each. This one shows what a project with the tool looks like: a loop from a research paper's encoding, several refinement strategies, a campaign to compare them, checks of soundness, and questions that are still open. The project is `voting-justification`, a library example with a readme.
:::

### The problem {#c21-problem}

Why does a voting rule give a profile a certain outcome? A *justification* answers with axioms (Pareto, faithfulness, reinforcement, ...): a small set of axiom instances, each applied to one, two or three concrete profiles, such that every rule satisfying them must give the target profile this outcome (Boixel and Endriss). There is a set of axiom instances such that every assignment of outcomes that satisfies them gives the target outcome: a CEGAR loop.

- The abstraction guesses the profiles and the axiom instances.
- The check guesses outcomes for all profiles that satisfy every chosen instance but differ from the target outcome.
- The refinement is a clause over the interface atoms that `relevant/1` marks; the original encoding comes with five strategies for it.

### Baseline and variants {#c21-baseline}

Strategy 2, the default, marks every profile atom and the axiom instances the counterexample's outcomes do *not* falsify:

```asp
relevant(profile(Prof,V,Cand,Pos)) :-
    profile_num(Prof), voter(V), candidate(Cand), position(Pos).
relevant(use_axiom_instance(Profiles,Axiom)) :-
    not falsified(pos_axiom_instance(Profiles,Axiom)),
    pos_axiom_instance(Profiles,Axiom).
```

::: listing-source
From the fragment `relevant` of `voting-justification`.
:::

Each strategy is a variant that swaps in another fragment (`s1`, `s3`, `s4`, `s5`); `shape2` and `record` change the loop, and `reference` blocks. The project's suite `strategies` runs them all on the fifteen questions with a known answer. [Playground: voting-justification]{.play}

### Reading the matrix {#c21-campaign}

The Campaign tab (or `tools/bench.mjs` with `tools/report.mjs`) gives one row per question and one column per variant. Eleven questions need at most nine candidates in every variant; four separate the strategies. On one of them:

| faith-cancel-reinf-pareto-k3 | Candidates | Mean clause |
|---|---:|---:|
| Strategy 2 (default) | 1,364 | 219.4 |
| Strategy 1 | 405 | 189.4 |
| Reference (blocking) | 1,407 | 248.0 |

Two findings. First, strategy 1 is the only one that beats blocking clearly (also on `faith-pareto-neutral-reinf-k4`: 44 candidates against 146). Second, the default strategy is barely better than blocking, and the clause lengths say why: 219 literals against 248. Every strategy marks every profile atom relevant, so every clause is nearly a block. A strategy that marked only the profiles the counterexample's falsified instances touch would be shorter; whether it is sound is the kind of question chapter 4 teaches you to test.

### Soundness and ground truth {#c21-soundness}

- On the questions with a known answer, every variant agrees with the reference: the campaign marks no cell ✗.
- **Audit** and **Fuzz** test a strategy on small questions; the generator `vote-question` draws random ones (`random-1`: strategy 1 needs 405 candidates, the default 2,526).
- `tools/cegarcheck.py` runs the loop with Python clingo, independently of the page's runtime.
- The two hard questions have no ground truth yet: neither finishes within forty minutes in this setting. Getting it, with native clingo, a stronger strategy or a better abstraction, is part of the project.

### Open questions {#c21-open}

The project's readme (Control tab, under the description) lists them: which strategy wins on which kind of question and why; whether a refinement can be lifted over symmetric profiles; whether Shape 2 or a rule refinement pays on the hard questions; what change to the abstraction makes them finish. Each is a student project of a few weeks.

::: exercise
### Exercise 1 {#c21-exercise-1}

The suite `generated` runs twelve random questions with four variants. Read its matrix by candidates. Does the ranking of the strategies on the fixed questions hold on random ones?

[Solution](#c21-exercise-1-solution)
:::

::: recap
### Recap

- In a project, every design choice is a variant, and the reference variant is always one of them.
- Read the matrix by candidates and clause lengths before times; they explain why one variant beats another.
- Ground truth comes from independent runs (reference, audit, cegarcheck); a question without it is an open question, not a test.
:::

### Answers {#c21-answers .answers}

::: {.answer #c21-exercise-1-solution}
[Back to Exercise 1](#c21-exercise-1)

On the machine where this guide was measured, strategy 1 needed 9.8 s in total, the reference 36.9 s, record 43.0 s and the default 49.6 s: the same ranking, with the default strategy now behind blocking. Times vary between machines; compare candidates first. [Playground: voting-justification]{.play}
:::

## From a paper to a loop {#c22}

::: lead
Part II took published algorithms apart. This last chapter turns the method around: given an algorithm in a paper, how do you write it as a loop, check it, and compare it with the paper's numbers?
:::

### A checklist {#c22-checklist}

1. **Name the oracles.** Every call to a SAT, ASP, MIP or optimisation solver in the pseudocode is a solver. Name what each one guesses. The abstraction is the one whose formula grows over the run.
2. **Name the interface.** What does each oracle need to know about the previous one's answer? Those atoms are the glue, and a link per pair of solvers.
3. **Name the refinement.** "Add a clause" is `G.clause` or a core; "add φ\[μ\]" is a program part grounded per counterexample (`A.expand`, chapters 13 and 16); "relax the core" is a part in the same solver (chapter 17); "block up/down" is `G.above`/`G.below` (chapter 15); "switch a constraint on" is an external (chapter 20).
4. **Name the control.** "Repeat until unsatisfiable" is Shape 2; "for each model" a `search`; "the cheapest" `A.solve(optimal)`; bounds `track`; recursion a `def` over a solver family (chapter 19).
5. **Write the blocking baseline first,** with the same solvers, and keep it as the `reference` variant.
6. **Check.** Same answers as the baseline on small instances, an audit, Fuzz; then `tools/cegarcheck.py` if the loop is in its scope.
7. **Compare with the paper.** Iterations are candidates, oracle calls are solver calls (Statistics tab). Expect the same counts on the same instances, not the same times.

### Which loop for which problem {#c22-which}

| The problem looks like | Try | Chapter |
|---|---|---|
| ∃∀ with a clear reason for each refutation | Shape 1, `relevant/1` | 3, 13 |
| ∃∀ with few distinct counterexamples | expansion (copies) | 13, 16 |
| a witness check, optimisation over soft constraints | implicit hitting sets | 14 |
| the same, unweighted, small optimum | core-guided (OLL) | 17 |
| enumerate minimal or maximal sets | MARCO | 15 |
| a master and a costed subproblem | Benders with bounds | 18 |
| three or more quantifier blocks | a chain, or recursion over a family | 19 |
| a constraint too large to ground | lazy constraints, omission | 20 |

### When the paper needs something CegarPlay lacks {#c22-missing}

- **Interpolants or proofs.** clingo produces none, so refinement by interpolation (predicate abstraction) is out of reach. Omission (chapter 20) is the nearest substitute.
- **A MIP solver.** Use an optimal ASP solver (`A.solve(optimal)`); expect it to be slower on large linear problems.
- **Parallel oracles.** The engine runs one call at a time; several checks of one candidate run one after the other.

::: exercise
### Exercise 1 {#c22-exercise-1}

Fu and Malik's algorithm, in short: assume all soft clauses; on a core, add a fresh relaxation variable to each of its soft clauses and an "at most one relaxed" constraint; repeat until satisfiable. Which chapter's loop is closest, and what changes?

[Solution](#c22-exercise-1-solution)
:::

::: recap
### Recap

- Oracles are solvers, their arguments are links, their updates are refinements, and the outer control is a shape.
- Write the blocking baseline first and keep it as a variant: it is the ground truth for the published loop.
- Compare counts with the paper, not times.
:::

### Answers {#c22-answers .answers}

::: {.answer #c22-exercise-1-solution}
[Back to Exercise 1](#c22-exercise-1)

Chapter 17's OLL loop: one solver under assumptions, relaxed by each core. The difference is the relaxation: Fu-Malik adds new relaxation variables to the clauses of the core (and keeps assuming the relaxed clauses), with an at-most-one constraint over them, where OLL adds totaliser outputs as new soft constraints. In the loop script, the program part `relax(k)` would ground the relaxation variables and the at-most-one constraint, and the loop would keep the core's assumptions instead of dropping them. [Playground: maxsat-oll]{.play}
:::

## Glossary {#glossary}

::: lead
The terms of the guide, each with the chapter that introduces it. The manual's section "Model and terms" is the reference version.
:::

Abstraction
:   The solver (A) that proposes candidates. It knows part of the problem and learns the rest from refinements. [Chapter 1](#c01), [chapter 7](#c07).

Candidate
:   An answer set of the abstraction: a proposed solution, to be checked. [Chapter 2](#c02).

Check
:   The solver (C) that tests a candidate. Usually it looks for a counterexample; a witness check looks for evidence that the candidate is good. [Chapter 2](#c02), [chapter 10](#c10).

Counterexample
:   An answer set of the check under a candidate: proof that the candidate is wrong. [Chapter 2](#c02).

Interface (glue)
:   The atoms of the abstraction that the check reads, declared by `glue/1` and passed as assumptions. [Chapter 2](#c02).

Refinement
:   What the abstraction learns from a counterexample: a clause, a rule, a copy of part of the problem. [Chapter 3](#c03), [chapter 9](#c09).

Blocking
:   The weakest refinement: exclude exactly the refuted candidate. Always sound; the baseline of every chapter. [Chapter 2](#c02).

relevant/1
:   The interface atoms a counterexample depends on; `G.clause` turns them into a clause. [Chapter 3](#c03).

Sound and complete
:   A refinement is sound when it removes no solution; a loop is complete when it ends with every solution. Soundness is the property that fails in practice. [Chapter 4](#c04).

Audit
:   A test of every refinement against every candidate and counterexample of an instance. [Chapter 4](#c04); how-to.

Symbolic audit
:   The audit's question answered by one search for a candidate, a counterexample and a solution its clause removes, instead of a list: also for instances too large to enumerate. [Chapter 4](#c04-symbolic).

Instance space
:   Every instance up to a bound k, written as choice rules over the instance's predicates (a project's `spaces`). How-to.

Bounded-sound
:   Sound on every instance of a space up to the bound k ("sound up to k"); it says nothing about larger instances. [Chapter 4](#c04-bounded).

Forced atom
:   An interface atom that every sound clause for a candidate must contain: some solution differs from the candidate only in that atom. The Refinement lab names them, with that solution. How-to.

Idealised run
:   A run in which each step refines one candidate that is still alive with one of the clauses its loop could make. The Refinement lab computes the shortest and longest such runs and compares a real run with them; Shape 1 runs can be longer, because clasp keeps clauses only weakly. [Chapter 5](#c05-lab).

Witness check
:   A check whose answer set means the candidate is *good*; a failed witness check is refined by its unsat core. [Chapter 10](#c10).

Core
:   A subset of the assumptions of a failed solve that is unsatisfiable on its own; a minimal core has no smaller such subset. [Chapter 10](#c10), [chapter 14](#c14).

Expansion
:   A refinement that adds a copy of part of the problem, instantiated with the counterexample. [Chapter 9](#c09), [chapter 13](#c13).

Shape
:   The control structure of a loop: one search with the check inside (Shape 1), solve-check-refine (Shape 2), rules per counterexample (Shape 3), batches (Shape 4). [Chapter 8](#c08).

Hitting set
:   A set that meets every set of a family; an abstraction refined by cores computes one. [Chapter 14](#c14).

Instance
:   One input of a project: facts and constants, with an expected count or optimum. How-to.

Variant
:   The same project with other fragments, another loop or other constants; the `reference` variant is the blocking loop. How-to.

Campaign
:   A suite of instances × variants × seeds, run cell by cell, read as a matrix and plots. How-to.

Every term is used in the first library example. [Playground: tutorial-first-run]{.play}

## Bibliography {#bibliography}

::: lead
The papers behind the loops of Part II and of the manual's table "Loops from the literature", grouped by loop. Each group names the library examples that implement it.
:::

### CEGAR {#bibliography-cegar}

- E. Clarke, O. Grumberg, S. Jha, Y. Lu and H. Veith. Counterexample-guided abstraction refinement. *CAV 2000*.

### 2QBF and QBF {#bibliography-qbf}

Examples: `qbf`, `qbf-expansion`, `qbf-deep`, `qbf-three-blocks`, `qbf-caqe`; chapter [13](#c13).

- M. Janota and J. Marques-Silva. Abstraction-based algorithm for 2QBF. *SAT 2011*.
- M. Janota, W. Klieber, J. Marques-Silva and E. Clarke. Solving QBF with counterexample guided refinement. *SAT 2012*; journal version in *Artificial Intelligence* 234 (2016). (AReQS and RAReQS.)
- M. N. Rabe and L. Tentrup. CAQE: a certifying QBF solver. *FMCAD 2015*.
- M. Janota and J. Marques-Silva. Solving QBF by clause selection. *IJCAI 2015*. (QESTO.)

### Other ∃∀ problems in ASP {#bibliography-exists-forall}

Examples: `af-preferred`, `af-semi-stable`, `stable-models`, `robust-facilities` (2-ASP(Q) with a weak constraint).

- B. Bogaerts, T. Janhunen and S. Tasharrofi. Stable-unstable semantics: beyond NP with normal logic programs. *Theory and Practice of Logic Programming* 16(5–6) (2016).
- G. Amendola, F. Ricca and M. Truszczynski. Beyond NP: quantifying over answer sets. *Theory and Practice of Logic Programming* 19(5–6) (2019). (ASP(Q).)
- T. Lehtonen, J. P. Wallner and M. Järvisalo. Declarative algorithms and complexity results for assumption-based argumentation. *Journal of Artificial Intelligence Research* 71 (2021).

### CEGIS {#bibliography-cegis}

Examples: `cegis-circuit`, `min-dnf`.

- A. Solar-Lezama, L. Tancau, R. Bodík, S. Seshia and V. Saraswat. Combinatorial sketching for finite programs. *ASPLOS 2006*.

### Implicit hitting sets {#bibliography-ihs}

Examples: `maxsat-ihs`, `smallest-mus`, `abduction-ihs` (AbHS), `kemeny-winners` (majority cycles as cores); chapter [14](#c14).

- J. Davies and F. Bacchus. Solving MAXSAT by solving a sequence of simpler SAT instances. *CP 2011*.
- J. Davies and F. Bacchus. Exploiting the power of MIP solvers in MAXSAT. *SAT 2013*.
- E. Moreno-Centeno and R. M. Karp. The implicit hitting set approach to solve combinatorial optimization problems with an application to multigenome alignment. *Operations Research* 61(2) (2013).
- P. Saikko, J. P. Wallner and M. Järvisalo. Implicit hitting set algorithms for reasoning beyond NP. *KR 2016*.
- A. Baharev, H. Schichl, A. Neumaier and T. Achterberg. An exact method for the minimum feedback arc set problem. *ACM Journal of Experimental Algorithmics* 26 (2021). Cycles generated lazily, as in `kemeny-winners`.

### MUS and MSS enumeration {#bibliography-marco}

Examples: `marco`, `reasons-by-shrinking`; chapter [15](#c15).

- M. H. Liffiton and A. Malik. Enumerating infeasibility: finding multiple MUSes quickly. *CPAIOR 2013*.
- M. H. Liffiton, A. Previti, A. Malik and J. Marques-Silva. Fast, flexible MUS enumeration. *Constraints* 21(2) (2016).
- A. Previti and J. Marques-Silva. Partial MUS enumeration. *AAAI 2013*.

### Core-guided optimisation {#bibliography-core-guided}

Examples: `maxsat-oll`, `maxsat-oll-weighted`, `slater-winners`.

- Z. Fu and S. Malik. On solving the partial MAX-SAT problem. *SAT 2006*.
- B. Andres, B. Kaufmann, O. Matheis and T. Schaub. Unsatisfiability-based optimization in clasp. *ICLP 2012 (Technical Communications)*.
- A. Morgado, C. Dodaro and J. Marques-Silva. Core-guided MaxSAT with soft cardinality constraints. *CP 2014*.

### Benders decomposition and branch-and-check {#bibliography-benders}

Examples: `benders-tardiness`, `knapsack-bounds`, `colourable-partial`, `triangle-free-lazy`; lazy constraints: `young-winners`, the variant `lazy-transitivity` of `kemeny-winners`.

- J. N. Hooker and G. Ottosson. Logic-based Benders decomposition. *Mathematical Programming* 96(1) (2003).
- E. S. Thorsteinsson. Branch-and-check: a hybrid framework integrating mixed integer programming and constraint logic programming. *CP 2001*.
- V. Conitzer, A. Davenport and J. Kalagnanam. Improved bounds for computing Kemeny rankings. *AAAI 2006*. The ordering formulation whose 3-cycle constraints `lazy-transitivity` adds lazily.

### Omission-based abstraction {#bibliography-omission}

Examples: `queens-omission`, `conformant-growing`.

- Z. G. Saribatur and T. Eiter. Omission-based abstraction for answer set programs. *KR 2018*; journal version in *Theory and Practice of Logic Programming* 21(2) (2021).

### Voting rules and the complexity of their winners {#bibliography-winners}

Examples: `kemeny-winners`, `slater-winners`, `dodgson-winners`, `young-winners`, with data from PrefLib.

- C. L. Dodgson. *A method of taking votes on more than two issues*. Pamphlet, Oxford, 1876.
- J. G. Kemeny. Mathematics without numbers. *Daedalus* 88(4) (1959).
- P. Slater. Inconsistencies in a schedule of paired comparisons. *Biometrika* 48(3/4) (1961).
- H. P. Young. Extending Condorcet's rule. *Journal of Economic Theory* 16(2) (1977).
- J. Bartholdi III, C. A. Tovey and M. A. Trick. Voting schemes for which it can be difficult to tell who won the election. *Social Choice and Welfare* 6(2) (1989).
- K. W. Wagner. Bounded query classes. *SIAM Journal on Computing* 19(5) (1990). Theta-2: polynomial time with logarithmically many NP queries.
- E. Hemaspaandra, L. A. Hemaspaandra and J. Rothe. Exact analysis of Dodgson elections: Lewis Carroll's 1876 voting system is complete for parallel access to NP. *Journal of the ACM* 44(6) (1997).
- J. Rothe, H. Spakowski and J. Vogel. Exact complexity of the winner problem for Young elections. *Theory of Computing Systems* 36(4) (2003).
- E. Hemaspaandra, H. Spakowski and J. Vogel. The complexity of Kemeny elections. *Theoretical Computer Science* 349(3) (2005).
- M. Lampis. Determining a Slater winner is complete for parallel access to NP. *STACS 2022*.
- N. Mattei and T. Walsh. PrefLib: a library for preferences. *ADT 2013*.

### Justifying collective decisions {#bibliography-voting}

Example: `voting-justification` (a project kit; see its readme).

- A. Boixel and U. Endriss. Automated justification of collective decisions via constraint solving. *AAMAS 2020*.
- O. Nardi, A. Boixel and U. Endriss. A graph-based algorithm for the automated justification of collective decisions. *AAMAS 2022*.

The examples are in the playground's library. [Playground: qbf]{.play}

# Part II: The playground {#part-2}

The playground (CegarPlay) is the browser application in which every example of this book runs. A project has **fragments** of ASP text, a **loop script** that says how the solvers call each other, and **instances** (the input of the problem). Its tabs follow the work: a project is written in the Programs, Loop and Instances tabs, run, and looked at in the Output, Statistics and Observatory tabs; the Campaign tab compares many runs. Each lesson below names the library example it uses, as in \[Playground: tutorial-first-run\], and describes what a run of it shows. The Observatory and the Campaign tab belong to the playground's Advanced mode; the Lab tab (the Refinement lab, lesson 6) has a switch of its own.

## What CEGAR is {#t01}

CEGAR (counterexample-guided abstraction refinement) splits a hard problem into a solver that proposes candidates and a solver that checks them. When the check finds a counterexample, the loop adds a refinement to the first solver that rules out the candidate, and usually many similar ones. The loop ends when the first solver has no candidates left; every candidate that passed the check is a solution.

CegarPlay runs such loops in your browser. The problem is written in answer set programming, the loop is a short script, and both run in clingo (https://potassco.org) compiled to WebAssembly.

## Your first run {#t02}

A set of numbers is *sum-free* if no two members (possibly the same one twice) add up to a third member. The first example lists all sum-free subsets of 1..8. Solver `A` guesses any set; solver `C` looks for a sum inside it. On a first visit the page opens with it already loaded.

[Playground: tutorial-first-run]{.play}

A run takes a fraction of a second and counts **107 candidates, 46 counterexamples, 46 refinements, 61 solutions**. The **Output** tab then has:

- **Solutions** lists the 61 sets (the first one is the empty set).
- **Trace** shows the run one step at a time. Step 1: the candidate is `pick(2) pick(4)`; the check finds the counterexample `sum(2,2)`, because 2 + 2 = 4; the refinement is the clause `-pick(2) ∨ -pick(4)`: from now on, 2 and 4 are never picked together.

One clause rules out every set that contains both 2 and 4, not only this candidate. That is why 46 refinements are enough for a search over 256 sets. (Step 2 may show a candidate that the clause of step 1 already rules out. The check then refutes it a second time, and the result is the same.)

::: side-note
Why can that happen? In this loop shape (Shape 1) the whole run is one enumeration of clasp, the solver inside clingo, and the check runs each time clasp reports an answer set. To list answer sets, clasp by default enumerates by *backtracking* (its option `--enum-mode=bt`): after an answer set it jumps back and flips its last decision, and it keeps clauses added during the enumeration only weakly, so a later candidate may still violate a refinement clause. Nothing is lost, because every candidate is checked anyway; the clause just prunes less than it could. With `options "--enum-mode=record"` on solver `A`, clasp records every clause for good: refinements then prune as much as they can, at the price of a growing clause store (the variant `record` of `voting-justification` compares the two).
:::

## Fragments, solvers and links {#t03}

The **Programs** tab holds the problem. The problem is split into four **fragments**, named pieces of ASP text:

- **shared**: `num(1..n).` Every solver needs it. `n` is set in the Constants table of the Loop tab (here `n = 8`), which overrides a `#const` in the text.
- **abstraction**: `{ pick(X) : num(X) }.` The candidates: any set.
- **glue**: `glue(pick(X)) :- num(X).` Each derived `glue(T)` makes `T` an **interface atom**: an atom both solvers talk about. When the check runs, these atoms are fixed to their values in the candidate.
- **check**: has an answer set exactly when the candidate is wrong, and marks with `relevant(T)` the interface atoms the counterexample depends on:

```asp
1 { sum(X,Y) : num(X), num(Y), X <= Y, X + Y <= n } 1.
:- sum(X,Y), not pick(X).
:- sum(X,Y), not pick(Y).
:- sum(X,Y), not pick(X+Y).
relevant(pick(X)) :- sum(X,Y).
relevant(pick(Y)) :- sum(X,Y).
relevant(pick(X+Y)) :- sum(X,Y).
```

(The project has a fifth fragment, **view**, which draws the run as a picture. It is not part of the loop, so it is not listed here: it is edited with its view in the Observatory. Lesson 5 uses it.)

The **Loop** tab holds the loop script. The loop script first declares the **solvers** (clingo instances, each grounding a list of fragments) and a **link** between them:

```loop
solver A = shared + abstraction
solver C = shared + check
link   G = A -> C via shared + glue

search A:
    on candidate M:
        X = C.solve(assume G(M))
        if X:
            reject M with G.clause(M, X)
```

- `search A:` runs `A`'s search and calls the `on candidate` block for each candidate `M`.
- `G(M)` turns the candidate into assumptions for `C`: the values of the interface atoms in `M`.
- `C.solve(...)` returns a counterexample, or `none` if the check is unsatisfiable.
- `G.clause(M, X)` is the refinement: at least one atom marked `relevant` in `X` must change its value. A candidate that is not rejected is a solution.

The same structure, at a larger scale: the graph colouring example looks for connected graphs on `n` nodes with a colouring of the leaves that no proper 3-colouring of the whole graph extends. Guessing a graph is easy; checking that *no* colouring exists is the hard part, so it goes to the check solver, and a counterexample is a colouring. Its fragments have comments; read them in the Programs tab.

[Playground: graph-coloring]{.play}

With Solutions set to `all`, a run takes a few seconds: 31,776 candidates, 21,078 counterexamples and refinements, 10,698 solutions.

## Reading the trace and the statistics {#t04}

The line **Shown:** under the run bar says which run the Output, Statistics and Observatory tabs show: a run or an audit, on which instance, how it ended and how much of it was recorded. It turns amber when you edit the project afterwards: the results on screen are then of the earlier version.

The trace (Output tab) records the first steps of a run (Trace steps in the Loop tab, default 200); its label counts them: "traced step 3 of 46". Each step shows the candidate, the counterexample and the refinement; candidate atoms that occur in the refinement are highlighted. If a run stops with an error about a candidate, the trace jumps to that step. An audit does not run the loop, so after an audit the trace and the list of solutions are empty, and say so.

The **Statistics** tab, after a run:

- **Candidates**, **Counterexamples**, **Refinements** (clauses + expansions), **Solutions**. "exhausted" after the outcome means the search ran to the end, so the count of solutions is complete.
- A table per solver: solve calls and how they ended, time spent solving and grounding, clasp's counters. For a check, Sat is the number of counterexamples found.
- The Refinements table: number of clauses and their lengths. Short clauses are strong refinements: each removes many candidates.
- Charts of candidates and refinements over time, where the time went, and the clause lengths.
- The **run history**: one row per finished run in this session. Use it to compare loops on the same problem. The row marked ▶ is the run the tabs show; the others are kept as numbers only.
- After an audit the Summary shows the audit's own figures (its verdict, candidates, refinements checked, solutions); the solver tables are the audit's solving, not the loop's.

## Watching a run: the Observatory {#t05}

The **Observatory** tab shows a run as pictures. Here it shows a run of the sum-free sets:

[Playground: tutorial-first-run]{.play}

- **Loop anatomy**: one box per solver, one arrow per link. Here `A` made 1 search call, and `C` 107 calls: 46 found a counterexample (sat), 61 did not (unsat, a solution). The arrow `G · 8 atoms` says the link has eight interface atoms, `pick(1)` to `pick(8)`.
- **Domain view**: the step in the problem's own terms. The numbers 1..8 stand in a circle; the candidate's numbers are filled, and the ringed ones are those of the counterexample, which cannot all stay. The view is the fragment **view**: ASP that turns a step into drawing marks (see Writing views); **Edit this view** opens its rules beside the drawing, which follows as you type. For a project without one, **New view** starts from a commented skeleton and **Suggest a view** writes a first draft.
- **The cursor**: the bar at the top moves one step through the run, and every picture follows it, the trace in the Output tab too. With Recording set to every step it counts recorded steps, which include the solutions ("recorded step 16"); otherwise it counts the trace's steps ("traced step 13"). The trace names both numbers when they differ. In the domain view, **Show** switches between **steps** and the run's **solutions**: a solution is not a step of the trace, and its label says when it was found, as far as the recording knows. The arrow keys move it; **follow the run** keeps it on the last step. **Export view** and **Storyboard** save pictures for slides; `?lecture=1` in the address shows the view alone, with its notes as captions.
- **Timeline** and **Cost per line**: they need a run with **Record calls** on. Every solve call becomes a bar on its solver's lane, and the table says which line of the loop script spent the time. After such a run the Loop tab shows the same figures beside the lines.

The fourth picture, the **candidate space**, shows every candidate at once. It belongs to the next lesson.

## When relevant/1 is too weak {#t06}

A clause from `G.clause` removes every candidate that agrees with the counterexample on the relevant atoms. If the `relevant/1` rules miss an atom, the clause also removes real solutions, and nothing warns you. This example marks only the sum `X + Y`, not `X` and `Y`:

```asp
% Too weak: X and Y are not marked.
relevant(pick(X+Y)) :- sum(X,Y).
```

[Playground: tutorial-weak-relevant]{.play}

The run finds **11 solutions** instead of 61. After the counterexample `sum(2,2)`, the refinement says "never pick 4", also for sets without 2. (This example uses Shape 2, explained in lesson 9: with Shape 1 the loss may not show at this size, for the reason mentioned in lesson 2.)

### The audit {#t06-tut-audit}

The **Audit** is the second way to run a project. Instead of the pairs of candidate and counterexample that one run happens to meet, the audit takes *every* candidate and every counterexample of the instance, and asks of each refinement whether it removes a solution. Here: 256 candidates, 61 solutions, 499 different refinements, and every one of them removes a solution. The Output tab shows a witness:

- the candidate `{pick(2) pick(4)}` with the counterexample `sum(2,2)` and the relevant set `{pick(4)}`;
- the lost solution `{pick(4)}`, which agrees with the candidate on every relevant atom, so the clause removes it too;
- the atoms on which they differ, `{pick(2)}`: one of them should have been relevant.

The audit of the first example is sound. Make the audit a habit on a small instance of every new problem. It needs no change to the project, and it works for rule refinements too (lesson 9).

### The symbolic audit and spaces {#t06-tut-symbolic}

The audit lists every candidate, so it stops being practical when there are millions. The **symbolic audit** asks the same question in one search: is there a candidate, a counterexample and a solution that the counterexample's clause removes? It is the Audit by **symbolic search**. On the too weak sum-free sets it says unsound at once, with a witness of the same kind: here the candidate `{pick(1) pick(2)}`, the counterexample `sum(1,1)`, the relevant set `{pick(2)}` and the lost solution `{pick(2)}`. Like the audit, it shows a witness on which the candidate and the lost solution differ in as few atoms as possible (here one, `pick(1)`; the audit happened to show another witness with one atom).

A verdict, of either audit, is about one instance. A **space** describes many: the sum-free examples have a space `n` that is just the constant `n` = 1, 2, 3, … The Audit by **space** takes a space and a bound k. The first example is *sound up to* `n` = 10: no refinement it can make loses a solution on any of these ten instances. The too weak variant breaks at `n` = 2, the smallest instance where it loses a solution, and the witness names the instance. Sound up to 10 says nothing about `n` = 11; the design guide's chapter on soundness says what such a bound is worth.

[Playground: tutorial-first-run]{.play}

### The reference run {#t06-tut-reference}

A second way to find out, which works for any loop: `G.block(M)` removes only the candidate itself, so a loop that refines with `G.block` is always sound (the design guide calls it the *blocking loop*). In the Loop tab, the template **Reference run** is this loop, and its run finds 61 solutions (and 256 candidates, one per set). Both runs are in the run history of the Statistics tab, and since both ran to the end with different counts, they are marked ⚠.

### Which refinement went wrong {#t06-tut-space}

The Observatory's **Candidate space** draws the project's own loop as a map, from a run with every step recorded. Each square is one of the 256 sets, marked by what the run's refinements have done to it so far (alive, removed, a lost solution), step by step through the run. The summary names the first unsound refinement: number 6, which removes 13 solutions at once.  Under the map, a box shows the refinement at the cursor: its step, the candidate it refined, the counterexample, and its clause ("at least one of …"). For refinement 6 the clause names only the sum, not the two numbers that add up to it, so it also removes sets that contain the sum without those numbers: among them, solutions.  The line above the map names the run it is of; another run, an audit or a replay clears it. The blame matrix below shows which atoms the refinements relied on.

### What the loop could have done: the Refinement lab {#t06-tut-lab}

The candidate space shows what one run did. The **Lab** tab (the Refinement lab) shows what the loop *could* have done, from the same enumeration as the audit. Its **step inspector**, on the audit's witness, shows the following. The candidate `{pick(2) pick(4)}` has one counterexample, `sum(2,2)`. Its clause names one atom, `pick(4)`, removes 128 of the 256 candidates and is unsound: 13 of them are solutions. The smallest sound clause names two atoms and removes 64. Both atoms are **forced**: the solution `{pick(4)}` differs from the candidate only in `pick(2)`, and `{pick(2)}` only in `pick(4)`, so every sound clause must name both. That is what the first example's `relevant/1` rules do. The **option map** draws every clause the loop could have made there by its length and the candidates it removes, unsound ones apart; the **atom table** says what dropping or adding one atom would change.

[Playground: tutorial-first-run]{.play}

For the sound loop, **Run bounds** asks how long a run of these refinements can be. Each of the 195 bad candidates costs a refinement unless an earlier clause removed it. The shortest possible run makes 14 refinements (proven: there are 14 bad candidates of which no single clause removes two), and runs that take the candidates in random order make 14 to 16. The project's own run, recorded with every step (Loop tab, Recording), makes 46. **This run against the bounds** says why: 32 of its refinements refine a candidate that an earlier clause had already removed. That is the weak clause retention of Shape 1 from lesson 2. The same loop written in Shape 2 (lesson 9) makes 14 refinements, the shortest possible. The lab computes everything in its own engine, so runs and audits go on while it works; see Refinement lab tab in the manual.

## One project, many instances {#t07}

An **instance** is a set of facts and constant values that a run puts on top of the project: the input of the problem, kept apart from its encoding. The graph colouring example has three, for `n` = 4, 5 and 6.

[Playground: graph-coloring]{.play}

- The **Instance** picker in the run bar chooses the instance of the next run; the run history names it.
- The **Instances** tab lists them with their tags, the expected solution count and the count of the last run, and edits their facts and constants. **Run all instances** runs each one (with the run bar's variant) and marks a count other than the expected one with ✗. (The instance `n6` is tagged `slow`.)
- **Import file** turns a file into an instance: facts, DIMACS graphs, QDIMACS formulas, argumentation frameworks, PrefLib elections.

Most examples of the library keep their input in instances. The voting example has fourteen: each is one question, a set of axioms with a target profile and its outcome, from two axioms up to five. One of them has no justification at all; its run ends with 0 solutions.

[Playground: voting-justification]{.play}

### Generators {#t07-tut-generators}

A **generator** is an ASP program whose shown atoms are an instance, with seeded random draws such as `@flip(500, X, Y)` (1 with probability 1/2). The QBF example has one, in the **Generators** part of the Instances tab, which draws instances from seeds; an instance kept from it with its facts as text you can read and edit (and the recipe it came from: generator, parameters, seed; the same recipe always gives the same facts). A generator's **Constants of its instances** (`n=n` passes its parameter `n` on) are added to each instance it makes.

[Playground: qbf]{.play}

### Fuzz {#t07-tut-fuzz}

**Fuzz** (Instances tab), run on the too weak sum-free sets, It audits the project on ever larger instances (here `n` = 1, 2, …), stops at the first unsound one (`n` = 2), makes it as small as it can, and shows the lost solution with the audit's witness. It can be kept as a regression instance, with its true count as the expected one.

[Playground: tutorial-weak-relevant]{.play}

## Campaigns: many runs at once {#t08}

A **suite** is a grid of runs: instances × variants × solver seeds, each with all solutions. A **variant** changes the project for a run, for example its loop. The too weak sum-free sets have a suite `scaling`: `n` from 4 to 8, with the project's loop (`default`) and with the Reference run (`reference`).

The **Campaign** tab runs the suite. The ten runs share several engines and take under a second. Then:

- the summary: per variant, the median time and candidates, and how fast they grow with `n`;
- marked ✗, every instance where two variants ran to the end with different counts: all five here, from `n4` (6 against 9) to `n8` (11 against 61). The tab label says **Campaign (5 ✗)**;
- plots: time against `n`, one variant against the other, and how many runs finish within a time.

The results are kept in this browser: a second start runs nothing; change a fragment and only the runs it affects run again. The suite is JSON in the editor; `tools/bench.mjs` runs the same suite from the command line, and **Import rows** reads its output.

### Comparing encodings: variants {#t08-tut-variants}

The voting example has five refinement strategies for its check: which axiom instances a counterexample marks as relevant. The fragment `relevant` holds strategy 2; `relevant_s1` … `relevant_s5` hold the others. Each is a **variant**, listed under **Variants** at the foot of the Loop tab: `s3` swaps `relevant_s3` in for `relevant`; `shape2` and `reference` have a loop script of their own. The **Variant** picker in the run bar runs one of them; the suite `strategies` runs all seven on the questions that finish, so the Campaign tab compares them side by side (strategy 1 needs the fewest candidates). To try a strategy of your own: add a fragment, then a variant that swaps it in.

[Playground: voting-justification]{.play}

## Choosing a loop shape {#t09}

The Loop tab has five templates. They use the same declarations and differ in how the solvers call each other. The examples below are graph colouring at `n = 5`; all five find the same 101 solutions.

| Example | Candidates | Counterexamples | Refinements |
|---|---|---|---|
| Shape 1 | 1,421 | 1,320 | 1,320 clauses |
| Shape 2 | 1,259 | 1,158 | 1,259 clauses (1,158 + 101 blocks) |
| Shape 3 | 222 | 121 | 121 expansions + 101 blocks |
| Shape 4 | 327 | 226 | 226 blocks + 226 expansions |
| Reference run | 3,373 | 3,272 | 3,272 blocks |

Two of them, run with **Record calls**, can be compared by their loop anatomies and timelines in the Observatory: the picture shows where each shape spends its time.

### Shape 1: check inside the search {#t09-tut-shape1}

One search of `A` for the whole run; the check runs inside it, and a counterexample rejects the candidate at once with a clause. Usually the fastest. Use it first.

[Playground: gc-shape1]{.play}

### Shape 2: solve, check, refine, solve again {#t09-tut-shape2}

The classic loop: each round solves `A` from the start, with the new clauses added. A solution must be blocked by hand (`A.add(G.block(M))`), or the next round finds it again. Easier to follow and to change than Shape 1; slower, because every round is a new solve call.

[Playground: gc-shape2]{.play}

```loop
loop:
    M = A.solve()
    if not M: stop
    X = C.solve(assume G(M))
    if X:
        A.add(G.clause(M, X))
    else:
        accept M
        A.add(G.block(M))
```

### Shape 3: ground new rules per counterexample {#t09-tut-shape3}

Instead of a clause, each counterexample is handed to the part `#program refine(k).` of the abstraction, which grounds new rules: `A.expand(refine, cex = X.atoms(color/2))` adds the facts `cex(k, T)` and grounds `refine(k)`. Rules can say more than one clause: here, that the next graph must break the colouring found (an edge between two nodes of the same colour, or a different leaf colour). Few candidates, but grounding costs time. Look at the end of the abstraction fragment.

[Playground: gc-shape3]{.play}

### Shape 4: search, collect, ground in batches {#t09-tut-shape4}

As Shape 3, but the search goes on: each failed candidate is blocked and its counterexample kept; after 20, the search restarts and grounds them all at once. Fewer, larger grounding steps.

[Playground: gc-shape4]{.play}

### Reference run {#t09-tut-shape-reference}

Shape 1 with `G.block(M)`: rejects exactly one candidate at a time. Slow, but always sound: its count is the truth to compare with (lesson 6).

[Playground: gc-reference]{.play}

## Writing loop scripts {#t10}

A loop script is indented like Python: 4 spaces per level, no tabs; `#` starts a comment. Declarations (`solver`, `link`) come first, then statements. The examples in this lesson are small (most are sum-free sets again); each shows one feature, with comments in the Loop tab. The manual has the full grammar, every statement and expression, and the error messages.

### The basics {#t10-tut-lang-basics}

Shape 2 written out with most statements: variables, `loop`, `if`/`elif`/`else`, `break`, `stop "message"`, `accept`, lists (`[]`, `push`, `size`), `for`, `count` and `log`. After a run, the `log` lines are under Messages in the Output tab, and the counters (`refinements`, `largest`) in the Statistics tab.

[Playground: lang-basics]{.play}

```loop
X = C.solve(assume G(M))       # look for a counterexample to M
if X:
    count refinements          # a counter, shown in the Statistics tab
    A.add(G.clause(M, X))      # one relevant atom must change
elif found >= 1000:
    stop "enough solutions"    # ends the whole run, with a message
else:
    accept M                   # M is a solution
```

### Several counterexamples per candidate {#t10-tut-lang-several}

`C.models(..., limit 3)` returns a list of up to three counterexamples; each one refines `A`. The same 61 solutions with 100 candidates instead of 107.

[Playground: lang-several-cex]{.play}

```loop
for X in C.models(assume G(M), limit 3):
    reject M with G.clause(M, X)
```

### The smallest refinement {#t10-tut-lang-optimal}

With `optimal`, `C.solve` returns an optimal model of a `#minimize` statement. The check gets `#minimize { 1,T : relevant(T) }.`, so it prefers counterexamples that mark few atoms, which give shorter clauses.

[Playground: lang-optimal]{.play}

```loop
X = C.solve(assume G(M), optimal)
```

### Two checks {#t10-tut-lang-two-stage}

Sum-free sets without two consecutive numbers, with one check solver per condition. Each check has its own fragment and link; `C2` runs only when `C1` finds nothing.

[Playground: lang-two-stage]{.play}

```loop
X = C1.solve(assume G1(M))
if X:
    reject M with G1.clause(M, X)
else:
    Y = C2.solve(assume G2(M))
    if Y: reject M with G2.clause(M, Y)
```

### Refinements written in ASP {#t10-tut-lang-clauses}

The check can state the refinement itself with atoms `clause(Id, T, Value)`: the atoms with one `Id` form one clause, `true` adds the literal `T`, `false` adds `not T`. `T` must be an interface atom. The loop reads them with `G.clauses(X)`.

[Playground: lang-clauses]{.play}

```asp
clause(1, pick(X), false) :- sum(X,Y).
clause(1, pick(Y), false) :- sum(X,Y).
clause(1, pick(X+Y), false) :- sum(X,Y).
```

### Unsat cores, when the check looks for a witness {#t10-tut-lang-core}

Sometimes the check confirms a candidate instead of refuting it: here, a graph is a solution when it can be 3-coloured. A candidate is rejected when the check is *unsatisfiable*, and `G.core(C)` builds the clause from the unsatisfiable core: the edges that together make a colouring impossible. 41 clauses suffice for 999 candidates. (In this example every satisfiable check counts as a counterexample in the statistics.)

[Playground: lang-core]{.play}

```loop
if not C.solve(assume G(M)):
    reject M with G.core(C)
```

### A refinement computed by its own solver {#t10-tut-lang-second}

A third solver `R` computes the refinement from the candidate and the counterexample together. A solve call can take several assumption lists, here one per link.

[Playground: lang-second-solver]{.play}

```loop
X = C.solve(assume G(M))
if X:
    Y = R.solve(assume GA(M), GC(X))
    reject M with GA.clause(M, Y)
```

### Reading and building values {#t10-tut-lang-values}

Clauses, lists and models are values the script can take apart. `G.above(M)` removes `M` and all its supersets at once; `G.clause(X)` builds a clause from the counterexample alone; `X.value(bound/1)` reads the argument of an atom; `for a in E:`, `E.flip(a)` and `E.without(a)` walk and edit an assumption list. The reasons example shrinks a candidate feature by feature with them, and then removes all supersets of what is left: See Values in the manual.

[Playground: reasons-by-shrinking]{.play}

```loop
E = G(M)
for a in E:
    if a.true and not C.solve(assume E.flip(a)):
        E = E.flip(a)               # this feature is not needed
accept A.solve(assume E)
A.add(G.above(E))                   # no superset of E again
```

### Cores as lists, and bounds over time {#t10-tut-lang-ihs}

A core is a list too: `for a in C.core:` walks the assumptions that the failed check needed. The MaxSAT example uses this the way the implicit hitting set solver MaxHS does: an optimal solver picks the soft clauses to give up, a SAT check tests the rest, and each core is relaxed with `E.without(a)` so that one round can find several disjoint cores. `C.core.minimal` first shrinks each core until no clause can be left out: a short core is a strong clause, and the example needs 5 rounds instead of 57. `track` records a number per round; the Statistics tab draws the lower and the upper bound until they meet at the optimum, 8. The manual's Loops from the literature lists the other algorithms written this way (MARCO, OLL, Benders, CEGIS, RAReQS, ...), each with an example.

[Playground: maxsat-ihs]{.play}

```loop
M = A.solve(optimal)                 # the cheapest set of clauses to give up
track lower = M.cost
E = G(M)
loop:
    X = C.solve(assume E)
    if X: break                      # the rest is satisfiable
    K = C.core.minimal               # no clause of it can be left out
    A.add(K.on(G))                   # give up at least one clause of the core
    for a in K:
        E = E.without(a)             # relax it, look for a disjoint core
```

### Searches inside searches {#t10-tut-lang-search}

A `search` can run inside the `on candidate` block of another solver's search, restricted by `assume`; `keep Y` stops it at its first surviving candidate, and `search A optimal:` reports only proven optimal models. The QBF with three quantifier blocks checks each candidate with an inner search (see Inner and optimal searches).

[Playground: qbf-three-blocks]{.play}

```loop
search B assume GX(M) keep Y:
    on candidate Y:
        W = C.solve(assume GXY(Y))
        if W: reject Y with GXY.clause(Y, W)
if Y: reject M with GXC.core(C)
```

### Checks at partial assignments {#t10-tut-lang-partial}

An `on partial P:` block, before `on candidate`, runs the check while the search of A is still deciding, as branch-and-check does. `G(P)` lists the atoms decided so far; `G(P, false)` takes the open ones as false. Only refinements that hold for every completion are allowed there: a core, or `G.clause(X)` from a counterexample. In the triangle-free graphs a triangle among the edges chosen so far cuts the subtree at once: 136 total candidates instead of 218 (the variant `total-only`), at the price of more check calls; `every n` makes them rarer (see Checks on partial candidates).

[Playground: triangle-free-lazy]{.play}

```loop
search A:
    on partial P every 8:
        X = C.solve(assume G(P, false))
        if X: reject P with G.clause(X)
    on candidate M:
        X = C.solve(assume G(M))
        if X: reject M with G.clause(M, X)
```

### Growing programs {#t10-tut-lang-growing}

`A.ground(step, t)` grounds the part `#program step(t).` while the loop runs, and `G.extend(step, t)` adds the new interface atoms to a link. The planning example grows the horizon until plans exist: at 8 steps it finds the same 3 plans as its fixed-horizon twin, without being told the length (see Growing programs).

[Playground: conformant-growing]{.play}

### Procedures and solver families {#t10-tut-lang-families}

`solver S[i in 1..depth]` declares one solver per level, `link G[i in 1..depth-1] = S[i] -> S[i+1]` links them in a chain, and `def refute(i, M):` defines a procedure that may call itself. Together they solve quantified Boolean formulas with any number of blocks (see Procedures and solver families).

[Playground: qbf-deep]{.play}

### Files from cegar.py {#t10-tut-lang-legacy}

The Python prototype's files list the interface atoms in the glue directly (`pick(X) :- num(X).`). The keyword `legacy` on the link reads them that way.

[Playground: lang-legacy]{.play}

### Raw Lua {#t10-tut-lang-lua}

The loop script is compiled to Lua (the Internals tab shows it, with `?internals=true`). If the language lacks something, **Edit as Lua** in the Loop tab turns the script into Lua that you can change freely. The manual lists the runtime API and the rules raw Lua must follow.

[Playground: lang-raw-lua]{.play}

### Mistakes in a script {#t10-tut-lang-errors}

The script is compiled while you type. If one changes `C.solve` into `D.solve` in any of the scripts above, then after a moment the line is marked, the Loop tab label shows the error, and the message says `'D' is not a declared solver`. Other errors found before a run: unknown fragments, wrong indentation, `reject` outside `on candidate`, `A.add` inside the search of `A`. A run does not start while there are errors.

## Certificates, proofs and recordings {#t11}

The audit of lesson 6 checks one instance completely. Three more tools say how far to trust a single run.

- **Certificates** (Loop tab): every refinement gets the cheapest proof that it removes no solution, whatever the other candidates are: a block, an unsat core, an evaluation of the check's ground program, or one unsatisfiable solver call. The Statistics tab counts them per level. Uncertified does not mean wrong; the third choice, **exact**, searches for a lost solution where the cheap levels fail. With Certificates set to **report**, the first example certifies all 46 clauses (level 2). In the too weak example its 6 clauses get none; only the blocks of its 11 solutions are certified.
- **Lifted refinements**: write `lift` after a link (`link G = A -> C via shared + glue lift`) and `G.clause(M, X)` computes its own relevant set from the ground programs, keeping only atoms it can prove necessary. Slower, never unsound, and a good check of hand-written `relevant/1` rules (see Refinement variants).
- **Proofs**: with **proof** on next to Recording, the run writes a proof log. `tools/certcheck.py`, which shares no code with the playground, confirms the solution count from it.

A **recording** keeps the steps of a run (Recording in the Loop tab). **Download recording** in the Control tab saves it; **Open recording** replays it in the Output tab and the Observatory without running anything. Every fast library example comes with one in `examples/replays/`; a link such as `?replay=examples/replays/gc-shape1.cprec&tab=11` opens it in the Observatory.

## Your own problem {#t12}

Start from the starter project (also **New project** in the Control tab). Its four fragments run as they are: the abstraction guesses a non-empty set of items, and the check looks for an item that is picked while a smaller one is not. With `n = 4` it finds 4 solutions.

[Playground: starter]{.play}

Replace the fragments step by step, running after each change:

1. Put the encoding's domains in **shared** and the guess of a candidate in **abstraction**. Put the input of the problem (a graph, a formula, an election) in an **instance** (Instances tab, New instance), so that the encoding stays the same for every input. Make the check `#false.` for a moment: it then never finds a counterexample, so the run lists all candidates. (An empty check is different: it has an answer set for every candidate, so every candidate has a counterexample.)
2. List the atoms the check needs in **glue**, wrapped as `glue(T)`.
3. Write the **check**: rules that have an answer set exactly when the candidate is wrong. Add `relevant(T)` rules for the interface atoms each counterexample depends on.
4. Audit a small instance (lesson 6). Unsound? Look at the witness and at the candidate space.
5. Add a few instances with their expected counts and check them with **Run all instances**; let **Fuzz** look for an instance that breaks the loop; write a suite to see how the run time grows (lessons 7 and 8).
6. Let **Suggest a view** (Observatory) write a first picture of your problem, and adapt it.

If a counterexample has no relevant atom, its clause is empty: the run ends there, with the solutions found so far. That is right only when no solution is left; the **Audit** tells you, and names a solution it would cut. Your project is kept in this browser and comes back after a reload; download it (Control tab) to keep it for good, or **Copy share link** to send it.

### Exercises that check themselves {#t12-tut-exercises}

An exercise is a project with a task and its own checks. **Check exercise** (Instances tab) runs every instance with all solutions and compares the counts, audits where the task asks for it, and compares the number of candidates with a budget, which a blocking loop cannot meet. Each item is marked ✓ or ✗, and an item that could not be checked counts as ✗.

[Playground: exercise-sum-free]{.play} [Playground: exercise-triangles]{.play}

Teachers can grade a folder of submissions with `node tools/grade.mjs submissions/ --exercise exercise-triangles`: the exercise and its instances come from the reference, the fragments and the loop from each submission.

## Where next {#t13}

The **technical manual** is the complete reference: the loop language (grammar, every statement and expression, the error messages), the ASP conventions, instances, campaigns and generators, the audit and certificates, the Observatory, the refinement variants, settings and limits, the Lua runtime, and a troubleshooting table. It has a tab of its own in the playground (Manual). It is written to be read by AI agents as well: they can fetch manual.md directly.

The tutorial shows how the tool works. How to **design** a loop (what goes in the abstraction, how a counterexample becomes a refinement, how a refinement goes wrong, which loop shape to choose) is the subject of the design guide, twelve chapters with an example for every step.

Algorithms you may know from the literature (implicit hitting sets, MARCO, core-guided MaxSAT, Benders decomposition, CEGIS, RAReQS, clausal abstraction, omission-based abstraction) are mapped to loop patterns and examples in Loops from the literature; the Library filter finds them by tag (`ihs`, `marco`, `oll`, `benders`, ...).

The Library in the Control tab has the larger problems: games, argumentation, knapsacks, QBFs, planning, voting. Every example can be linked to directly: **Copy link** in the Library gives a link such as `?example=gc-shape3`.
