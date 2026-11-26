// What to do about an error of the loop script: the compiler's message (js/compiler.js) or the
// validation's, matched to a short fix and the manual section that explains the rule
// (manual.md, "The loop language"). No DOM: the tests run it in Node.
//
//   explainError(message) -> { fix, section, sectionTitle } (section: a #manual-... anchor)

const S = {
  lexical: ['manual-lexical-rules', 'Lexical rules'],
  decl: ['manual-declarations', 'Declarations'],
  stmt: ['manual-statements', 'Statements'],
  expr: ['manual-expressions', 'Expressions'],
  values: ['manual-values-clauses-lists-and-model-reads', 'Values: clauses, lists and model reads'],
  families: ['manual-procedures-and-solver-families', 'Procedures and solver families'],
  refine: ['manual-program-refine-k-rules-per-counterexample', '#program refine(k)'],
  settings: ['manual-settings', 'Settings'],
  errors: ['manual-static-errors', 'Static errors'],
};

const RULES = [
  [/^tabs are not allowed/, 'Indent with spaces only; the editor turns the Tab key into spaces.', S.lexical],
  [/^inconsistent indentation/, 'Start this line in the same column as the other statements of its block (or as the line that opens the block, to end it).', S.lexical],
  [/^unterminated string/, 'Close the string with a double quote on the same line.', S.lexical],
  [/^unexpected character/, 'Only names, numbers, strings and the operators of the language can appear here; # starts a comment.', S.lexical],
  [/^unknown fragment '([^']*)'/, (m) => `Check the spelling: the fragments are listed in the Programs tab (+ Add fragment makes ${m[1]}). Typing after = or + offers the fragment names.`, S.decl],
  [/is not a declared solver/, 'Declare the solver first, at the top of the script: solver S = shared + abstraction.', S.decl],
  [/is not a declared link/, 'Declare the link first, at the top of the script: link G = A -> C via shared + glue.', S.decl],
  [/a link needs two different solvers/, 'A link goes from the searching solver to another one (its check): link G = A -> C via ... with A and C different.', S.decl],
  [/^duplicate declaration/, 'Give each solver and link its own name.', S.decl],
  [/is a reserved name/, 'Pick another name: Lua keywords and the runtime\'s names (rt, clingo, main, ...) are taken.', S.lexical],
  [/^unknown name '([^']*)'/, (m) => `Assign ${m[1]} before this line (${m[1]} = ...), or declare it. Variables of an on candidate block exist only inside that block.`, S.stmt],
  [/cannot be assigned/, 'Use another name for the variable: this one names a solver or a link.', S.stmt],
  [/cannot be (a loop variable|the candidate variable)/, 'Use a fresh name: this one is taken by a solver, a link or a keyword.', S.stmt],
  [/'reject' works only inside 'on candidate'/, 'Put it inside a search: search A: / on candidate M: / reject M with .... Outside a search, add a clause with A.add(c).', S.stmt],
  [/'reject' must name the candidate variable '([^']*)'/, (m) => `Write reject ${m[1]} with ...: the name after on candidate.`, S.stmt],
  [/'restart' works only inside 'on candidate'/, 'Use it inside on candidate, to end the current search early.', S.stmt],
  [/'search' cannot be nested/, 'Inside on candidate, ask another solver with C.solve(...) or C.models(...); a second search goes after this one.', S.stmt],
  [/'(break|continue)' outside a loop/, (m) => `${m[1]} works inside loop:, while, repeat and for.`, S.stmt],
  [/'return' outside/, 'return works only inside a def procedure.', S.families],
  [/\.add cannot be used inside 'on candidate'/, 'Inside on candidate of the searching solver, refine with reject M with c.', S.stmt],
  [/\.expand cannot be used inside 'on candidate'/, 'Collect the counterexamples in a list (L = [] before the search, L.push(X) inside it) and call S.expand(refine, cex = L) after the search.', S.expr],
  [/^unknown member '([^']*)' of solver/, 'Use one of the listed members; after the dot the editor offers them (type a letter, or Ctrl+Space).', S.expr],
  [/^unknown member '([^']*)' of link/, 'Use one of the listed members, or G(M) for the values of its atoms; after the dot the editor offers them.', S.expr],
  [/^unknown member/, 'Use one of the listed members; after the dot the editor offers them.', S.values],
  [/must be called/, 'Add the parentheses with its arguments, as the message shows.', S.expr],
  [/is not a method/, 'Leave out the parentheses: it is a value, not a call.', S.expr],
  [/write 'assume' before the first assumption list/, 'Write S.solve(assume G(M)); more assumption lists follow after commas.', S.expr],
  [/'assume' given twice/, 'Write assume once; more lists follow after commas: S.solve(assume E1, E2).', S.expr],
  [/unexpected argument 'limit'/, 'Only S.models takes limit n; S.solve finds one model.', S.expr],
  [/unexpected argument 'optimal'/, 'Only S.solve(..., optimal) can be optimal.', S.expr],
  [/clause takes two arguments/, 'G.clause(M, X): the candidate and the counterexample.', S.expr],
  [/core takes the check solver/, 'G.core(C): the solver whose last solve was unsatisfiable (the link\'s target).', S.expr],
  [/takes (one|two) arguments?|takes one (atom|predicate|value|clause)|takes a (position|link|model|program part|predicate name)/, 'See the message for the arguments it takes, and the Expressions table in the manual.', S.expr],
  [/family/, 'A family is declared with an index (solver S[i in 1..n] = ...) and used with one: S[i].', S.families],
  [/^this expression does nothing/, 'A statement must do something: assign the value (x = ...), call a method (A.add(c)), or use a command such as log x.', S.stmt],
  [/no fragment of solver (\w+) contains '#program (\w+)/, (m) => `Add "#program ${m[2]}(k)." and its rules to one of solver ${m[1]}'s fragments.`, S.refine],
  [/the option -t needs the threaded engine/, 'Remove -t from the solver\'s options, or open the page with cross-origin isolation (the default; not with ?nocoi=1) and tick threads in the Loop tab.', S.settings],
];

export function explainError(message) {
  const msg = String(message || '');
  for (const [re, fix, sec] of RULES) {
    const m = re.exec(msg);
    if (m) return { fix: typeof fix === 'function' ? fix(m) : fix, section: sec[0], sectionTitle: sec[1] };
  }
  return { fix: '', section: S.errors[0], sectionTitle: S.errors[1] };
}
