// Help for the loop script: what a word of the script means where it stands (the tooltip of the
// Loop tab's editor), and what the statement on a line does (the hint line under the editor).
// The texts follow manual.md, "The loop language". No DOM: the tests run it in Node.
//
//   scriptNames(text)                 -> { solvers, links, vars, procs }: the names the script declares
//   wordAt(line, col)                 -> { word, start, end } | null
//   wordHelp(text, row, col, frags)   -> { title, text } | null   (frags: [{ name, description }])
//   lineHint(text, row, frags)        -> string ('' for a blank or comment line)

const KEYWORDS = {
  solver: ['solver S = f1 + f2 [options "..."]', 'Declares a solver: a clingo instance that grounds these fragments, in this order. The options are clingo options, such as "--heuristic=Domain".'],
  link: ['link G = A -> C via f1 + f2', 'Declares a link from solver A to solver C. Its interface atoms are the T of the glue(T) atoms derived in these fragments: the atoms both solvers talk about.'],
  via: ['link G = A -> C via f1 + f2', 'The fragments in which the link\'s glue(T) atoms are derived.'],
  options: ['solver S = ... options "..."', 'clingo options for this solver, split on white space (e.g. "--heuristic=Domain", "--enum-mode=record", "-t 2").'],
  legacy: ['link G = ... legacy', 'Shown atoms that are not glue/1 are interface atoms too (the files of cegar.py).'],
  compat: ['link G = ... compat', 'relevant(T) is a free choice in the check (the Python prototype\'s behaviour).'],
  lift: ['link G = ... lift', 'G.clause(M, X) is computed from the ground programs of both ends, no relevant/1 needed: atoms are dropped while the smaller clause stays certified. Slower, often shorter clauses.'],
  keep: ['keep', 'A keyword of solver families (manual: Procedures and solver families).'],
  def: ['def name(a, b):', 'Defines a procedure (between the declarations and the first statement). It may call itself; return gives its value.'],
  return: ['return [e]', 'Leaves the procedure, with the value e (or none). Only inside def.'],
  if: ['if e: ... elif e: ... else: ...', 'Runs the first block whose condition holds. Only false and none are false: 0 and [] are true.'],
  elif: ['elif e:', 'Another condition of the if above, tried when the earlier ones do not hold.'],
  else: ['else:', 'Runs when no condition of the if above holds.'],
  loop: ['loop:', 'Repeats the block forever; leave it with break or stop.'],
  while: ['while e:', 'Repeats the block while e holds.'],
  repeat: ['repeat: ... until e', 'Runs the block, again and again, until e holds (checked after each round).'],
  until: ['repeat: ... until e', 'Ends the repeat once e holds.'],
  for: ['for x in e:', 'Runs the block for each element of the list e: a list, G(M), a clause, a core or X.atoms(p/n).'],
  in: ['for x in e:', 'The list the for loop walks through.'],
  search: ['search A:', 'Runs solver A\'s own search. Its on candidate block is called for every candidate (a total assignment); a candidate that is not rejected is a solution.'],
  candidate: ['on candidate M:', 'Called for every candidate M of the search. Check M here, and reject it with a refinement if it is wrong. M is valid only during this call: store G(M) or a counterexample instead.'],
  partial: ['on partial P every n:', 'Also called at partial assignments of the search (every n-th propagation fixpoint). Reject P with a clause to prune early.'],
  every: ['on partial P every n:', 'Call the on partial block at every n-th propagation fixpoint only (default 1).'],
  reject: ['reject M with e', 'Rejects the candidate M: adds the clause (or list of clauses) e to the searching solver. Only inside on candidate (or on partial).'],
  with: ['reject M with e', 'The refinement: a clause, such as G.clause(M, X), G.block(M) or G.core(C), or a list of clauses.'],
  accept: ['accept M [as NAME]', 'Counts the model M as a solution and prints it (for models from solve or models). Inside a search it is not needed: not rejecting accepts. With "as NAME": a second kind of answer, counted apart.'],
  as: ['accept M as NAME', 'Lists M as a second kind of answer (such as mss), counted apart from the solutions.'],
  restart: ['restart', 'Ends the current search early (only inside on candidate); the next search starts afresh.'],
  stop: ['stop ["message"]', 'Ends the run: outcome finished, or with a message, stopped.'],
  break: ['break', 'Leaves the innermost loop.'],
  continue: ['continue', 'Goes to the next round of the innermost loop.'],
  count: ['count n [by e]', 'Adds e (default 1) to the custom counter n (Statistics tab, Custom counters).'],
  by: ['count n by e', 'The amount added to the counter.'],
  track: ['track n = e', 'Records the number e as the next value of the series n; the Statistics tab draws it over its rounds (for bounds that should meet).'],
  log: ['log a, b', 'Prints the values to the Messages (Output tab).'],
  assume: ['S.solve(assume E)', 'Solves under the assumption list E, usually G(M): the values of G\'s interface atoms in the candidate M. More lists may follow, separated by commas.'],
  limit: ['S.models(..., limit n)', 'At most n models.'],
  optimal: ['S.solve(..., optimal)', 'With a #minimize in the solver: the optimal model.'],
  and: ['a and b', 'Both hold.'], or: ['a or b', 'One of them holds.'], not: ['not e', 'e does not hold (e is false or none): "if not X" means "if there was no model".'],
  true: ['true', 'The value true.'], false: ['false', 'The value false.'],
  none: ['none', 'No value: what solve returns when the solver has no model (unsatisfiable).'],
};

const SOLVER = {
  solve: ['S.solve([assume E, ...] [, optimal])', 'One solve of S: a model, or none if S is unsatisfiable. With a check solver: a counterexample, or none when the candidate is right.'],
  models: ['S.models([assume E] [, limit n])', 'A list of up to n models of S (all without limit; empty if unsatisfiable).'],
  add: ['S.add(c)', 'Adds a clause or a list of clauses to S before its next solve. Not inside on candidate of S (use reject there).'],
  expand: ['S.expand(part, cex = L)', 'Adds the facts cex(k, T) for the atoms T in L, then grounds #program part(k) with the next k: a refinement as rules.'],
  exhausted: ['S.exhausted', 'Whether the last search of S ran to the end (so its count of solutions is complete).'],
  step: ['S.step', 'The number of expansions of S so far (the last k).'],
  core: ['S.core', 'The unsat core of S\'s last solve (the assumptions it used); .on(G) keeps G\'s atoms, .minimal makes it subset-minimal.'],
  atom: ['S.atom("p", n)', 'The atom p(n) of S as a one-element assumption list.'],
  ground: ['S.ground(part, t)', 'Grounds #program part(t) of S with the number t.'],
  set: ['S.set(a, v)', 'Assigns the #external atom a the value v.'],
  release: ['S.release(a)', 'Releases the #external atom a (false for good).'],
  size: ['S.size', 'The number of members of the solver family S.'],
};

const LINK = {
  clause: ['G.clause(M, X)', 'The refinement: one interface atom marked relevant(T) in the counterexample X must change its value from the candidate M. Rules out M and every candidate that agrees with it on these atoms.'],
  block: ['G.block(M)', 'A clause that rules out exactly M\'s values of the interface atoms (at least one must change).'],
  core: ['G.core(C)', 'A clause from the unsat core of C\'s last solve (C must have been unsatisfiable): one of the assumed values in the core must change.'],
  clauses: ['G.clauses(X)', 'The clauses that the clause/3 atoms of X state.'],
  lift: ['G.lift(M, X)', 'A clause lifted from the ground programs of both ends (as on a link with the keyword lift).'],
  above: ['G.above(M)', 'A clause that removes M and all its supersets on G\'s atoms.'],
  below: ['G.below(M)', 'A clause that removes M and all its subsets on G\'s atoms.'],
  extend: ['G.extend(part, t)', 'Grounds the same part in G\'s glue; new glue(T) atoms become interface atoms.'],
};

const VALUE = {
  atoms: ['X.atoms(p/n)', 'The list of true atoms of predicate p/n in the model X (also of a candidate M).'],
  push: ['l.push(e)', 'Appends e to the list l.'],
  clear: ['l.clear()', 'Empties the list l.'],
  size: ['l.size', 'The length of the list l.'],
  on: ['core.on(G)', 'Keeps the atoms of the core that link G knows: a clause for G\'s source.'],
  minimal: ['core.minimal', 'A subset-minimal core (costs up to one solve per assumption).'],
  flip: ['E.flip(a)', 'A new assumption list with the value of a flipped.'],
  without: ['E.without(a)', 'A new assumption list without a.'],
  true: ['a.true', 'Whether the assumption a is "true" (else "false").'],
  value: ['X.value(p/1)', 'The argument of the one true p atom of X (an error when there are none or several).'],
  count: ['X.count(p/n)', 'The number of true atoms of p/n in X.'],
  cost: ['X.cost', 'The cost of the model X (with a #minimize).'],
  arg: ['a.arg(i)', 'The i-th argument of the atom a.'],
};

const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;

// the names declared or bound in the script (a light scan, line by line; the compiler checks)
export function scriptNames(text) {
  const solvers = new Map(), links = new Map(), vars = new Map(), procs = new Map(), searched = new Set();
  const lines = String(text || '').split('\n');
  lines.forEach((raw, row) => {
    const line = raw.replace(/#.*$/, '');
    let m;
    const s = /^\s*search\s+([A-Za-z_]\w*)/.exec(line);
    if (s) searched.add(s[1]);
    if ((m = /^\s*solver\s+([A-Za-z_]\w*)(\s*\[[^\]]*\])?\s*=\s*([^"]*?)\s*(?:options\s+("(?:\\.|[^"\\])*"))?\s*$/.exec(line))) {
      solvers.set(m[1], { frags: m[3].split('+').map((s) => s.trim()).filter(Boolean), options: m[4] ? m[4].slice(1, -1) : '', family: !!m[2], row });
    } else if ((m = /^\s*link\s+([A-Za-z_]\w*)(\s*\[[^\]]*\])?\s*=\s*([A-Za-z_]\w*)(?:\[[^\]]*\])?\s*->\s*([A-Za-z_]\w*)(?:\[[^\]]*\])?\s+via\s+(.*?)\s*$/.exec(line))) {
      const words = m[5].split(/\s+/);
      const flags = [];
      while (words.length && /^(legacy|compat|lift)$/.test(words[words.length - 1])) flags.unshift(words.pop());
      links.set(m[1], { from: m[3], to: m[4], frags: words.join(' ').split('+').map((s) => s.trim()).filter(Boolean), flags, family: !!m[2], row });
    } else if ((m = /^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(line))) {
      procs.set(m[1], { args: m[2].split(',').map((s) => s.trim()).filter(Boolean), row });
      for (const a of procs.get(m[1]).args) if (!vars.has(a)) vars.set(a, { kind: 'param', proc: m[1], row });
    } else if ((m = /^\s*on\s+candidate\s+([A-Za-z_]\w*)/.exec(line))) {
      vars.set(m[1], { kind: 'candidate', row, search: searchAbove(lines, row) });
    } else if ((m = /^\s*on\s+partial\s+([A-Za-z_]\w*)/.exec(line))) {
      vars.set(m[1], { kind: 'partial', row, search: searchAbove(lines, row) });
    } else if ((m = /^\s*for\s+([A-Za-z_]\w*)\s+in\s+(.*?):/.exec(line))) {
      if (!vars.has(m[1])) vars.set(m[1], { kind: 'loopvar', expr: m[2].trim(), row });
    } else if ((m = /^\s*(?:track\s+)?([A-Za-z_]\w*)\s*=(?!=)\s*(.*?)\s*$/.exec(line)) && !/^\s*track\b/.test(line)) {
      if (!vars.has(m[1])) vars.set(m[1], { kind: 'var', expr: m[2], row });
    }
  });
  return { solvers, links, vars, procs, searched };
}

function searchAbove(lines, row) {
  for (let r = row - 1; r >= 0; r--) {
    const m = /^\s*search\s+([A-Za-z_]\w*)/.exec(lines[r]);
    if (m) return m[1];
  }
  return '';
}

export function wordAt(line, col) {
  for (let i = 0; i < line.length;) {
    NAME.lastIndex = i;
    const m = NAME.exec(line);
    if (m && m.index === i) {
      const end = i + m[0].length;
      if (col >= i && col <= end && !(col === end && end === i)) return { word: m[0], start: i, end };
      i = end;
    } else i++;
  }
  return null;
}

const entry = ([syntax, text]) => ({ title: syntax, text });
const fragText = (name, frags) => {
  const f = (frags || []).find((x) => x.name === name);
  return f ? (f.description ? `Fragment ${name}: ${f.description}` : `Fragment ${name} (Programs tab).`) : `There is no fragment ${name} (Programs tab).`;
};
function solverText(name, s, names) {
  const roles = [];
  if (names.searched.has(name)) roles.push(`it proposes the candidates (search ${name})`);
  for (const [g, l] of names.links) if (l.to === name) roles.push(`it checks ${l.from}'s candidates over link ${g}`);
  return `Solver ${name}${s.family ? ' (a family: one member per index)' : ''}: grounds ${s.frags.join(' + ') || '(no fragment)'}${s.options ? `, with the clingo options ${s.options}` : ''}${roles.length ? `; ${roles.join('; ')}` : ''}.`;
}
const linkText = (name, l) => `Link ${name}${l.family ? ' (a family)' : ''}: from solver ${l.from} to solver ${l.to}, its interface atoms from the glue in ${l.frags.join(' + ')}${l.flags.length ? ` (${l.flags.join(', ')})` : ''}. ${name}(M) gives the values of these atoms in M, as assumptions for ${l.to}.`;

// The receiver of ".member" before position `start` on the line: a name (also S[i]), or ''.
function receiver(line, start) {
  let j = start - 1;
  while (j >= 0 && line[j] === ' ') j--;
  if (line[j] !== '.') return null;
  j--;
  if (line[j] === ']') { let d = 0; for (; j >= 0; j--) { if (line[j] === ']') d++; else if (line[j] === '[' && --d === 0) { j--; break; } } }
  else if (line[j] === ')') return '';
  let k = j;
  while (k >= 0 && /\w/.test(line[k])) k--;
  return line.slice(k + 1, j + 1);
}

function varText(name, v, names) {
  if (v.kind === 'candidate') return `The candidate of the search${v.search ? ` of ${v.search}` : ''}: a total assignment, valid only during this on candidate call. Not rejected, it is a solution.`;
  if (v.kind === 'partial') return `A partial assignment of the search${v.search ? ` of ${v.search}` : ''}: some atoms are not decided yet.`;
  if (v.kind === 'param') return `A parameter of the procedure ${v.proc}.`;
  if (v.kind === 'loopvar') return `The loop variable: each element of ${v.expr} in turn.`;
  const m = /^([A-Za-z_]\w*)(?:\[[^\]]*\])?\.(solve|models)\(/.exec(v.expr);
  if (m && names.solvers.has(m[1])) {
    const isCheck = [...names.links.values()].some((l) => l.to === m[1]);
    return m[2] === 'solve'
      ? `A model of solver ${m[1]}, or none if it has none${isCheck ? `: a counterexample, or none when the candidate passes the check` : ''}. Set by ${name} = ${v.expr}.`
      : `A list of models of solver ${m[1]}. Set by ${name} = ${v.expr}.`;
  }
  return `A variable, set by ${name} = ${v.expr}.`;
}

export function wordHelp(text, row, col, frags = []) {
  const lines = String(text || '').split('\n');
  const line = lines[row] || '';
  const hash = commentStart(line);
  if (hash >= 0 && col >= hash) return null;
  const w = wordAt(line, col);
  if (!w || inString(line, w.start)) return null;
  const names = scriptNames(text);
  const { word } = w;
  const before = line.slice(0, w.start), after = line.slice(w.end);
  // a member: .name
  const recv = receiver(line, w.start);
  if (recv !== null) {
    if (names.solvers.has(recv) && SOLVER[word]) return entry(SOLVER[word]);
    if (names.links.has(recv) && LINK[word]) return entry(LINK[word]);
    if (VALUE[word]) return entry(VALUE[word]);
    if (SOLVER[word]) return entry(SOLVER[word]);
    if (LINK[word]) return entry(LINK[word]);
    return { title: `.${word}`, text: 'Not a known member: the compiler lists the valid ones.' };
  }
  // fragment names in a declaration
  const decl = /^\s*(solver|link)\b/.exec(line);
  if (decl && (/=\s*[^=]*$/.test(before) && !/->\s*$/.test(before)) && !/\boptions\b/.test(before)) {
    const isFrag = decl[1] === 'solver' ? true : /\bvia\b/.test(before);
    if (isFrag && !KEYWORDS[word]) return { title: word, text: fragText(word, frags) };
  }
  // names that are labels, not variables
  if (/\.(expand|ground|extend)\(\s*$/.test(before)) return { title: `#program ${word}(k)`, text: `The program part ${word} of the solver's fragments, grounded with the next number k.` };
  if (/\.expand\(.*,\s*$/.test(before) && /^\s*=(?!=)/.test(after)) return { title: `${word} = L`, text: `Adds the facts ${word}(k, T) for each atom T in the list L before the part is grounded.` };
  if (/^\s*count\s+$/.test(before)) return { title: `count ${word}`, text: `The custom counter ${word} (Statistics tab, Custom counters).` };
  if (/^\s*track\s+$/.test(before)) return { title: `track ${word}`, text: `The series ${word}: one value per round, drawn in the Statistics tab.` };
  if (/\baccept\s+\w+\s+as\s+$/.test(before)) return { title: `as ${word}`, text: `A second kind of answer, listed as "${word} n" and counted apart from the solutions.` };
  if (names.solvers.has(word)) return { title: word, text: solverText(word, names.solvers.get(word), names) };
  if (names.links.has(word)) return { title: `${word}${/^\s*\(/.test(after) ? '(M)' : ''}`, text: linkText(word, names.links.get(word)) };
  if (names.procs.has(word)) return { title: `${word}(${names.procs.get(word).args.join(', ')})`, text: `A procedure defined in this script (def ${word}).` };
  // keywords that depend on their place
  if (word === 'on' && /^\s*$/.test(before)) return entry(/^\s*partial\b/.test(after) ? KEYWORDS.partial : KEYWORDS.candidate);
  if (word === 'lift' && !decl) return entry(LINK.lift);
  if (KEYWORDS[word]) return entry(KEYWORDS[word]);
  if (names.vars.has(word)) return { title: word, text: varText(word, names.vars.get(word), names) };
  if (/\/\s*\d/.test(after.slice(0, 3))) return { title: `${word}/${/\/\s*(\d+)/.exec(after)[1]}`, text: `The predicate ${word} with this many arguments.` };
  return null;
}

function commentStart(line) {
  let inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; } else if (c === '"') inStr = true; else if (c === '#') return i;
  }
  return -1;
}
function inString(line, pos) {
  let inStr = false;
  for (let i = 0; i < pos; i++) { const c = line[i]; if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; } else if (c === '"') inStr = true; }
  return inStr;
}

// What the statement on a line does, in the script's own names.
export function lineHint(text, row, frags = []) {
  const lines = String(text || '').split('\n');
  const raw = lines[row] || '';
  const hash = commentStart(raw);
  const line = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
  if (!line) return '';
  const names = scriptNames(text);
  let m;
  if ((m = /^solver\s+(\w+)/.exec(line)) && names.solvers.has(m[1])) return solverText(m[1], names.solvers.get(m[1]), names);
  if ((m = /^link\s+(\w+)/.exec(line)) && names.links.has(m[1])) return linkText(m[1], names.links.get(m[1]));
  if ((m = /^search\s+(\w+)/.exec(line))) return `Runs the search of solver ${m[1]}: its on candidate block checks every candidate; a candidate that is not rejected is a solution.`;
  if ((m = /^on\s+candidate\s+(\w+)/.exec(line))) return `For every candidate ${m[1]} of the search: the block below checks it (and rejects it if it is wrong).`;
  if ((m = /^on\s+partial\s+(\w+)/.exec(line))) return `At partial assignments ${m[1]} of the search: the block below may reject early.`;
  if ((m = /^reject\s+(\w+)\s+with\s+(.*)$/.exec(line))) return `Rejects the candidate ${m[1]}: adds ${describe(m[2], names) || m[2]} to the searching solver.`;
  if ((m = /^accept\s+(\w+)(?:\s+as\s+(\w+))?/.exec(line))) return m[2] ? `Lists ${m[1]} as a ${m[2]} (counted apart from the solutions).` : `Counts ${m[1]} as a solution and prints it.`;
  if ((m = /^(if|elif|while)\s+(.*):\s*(.*)$/.exec(line))) {
    const cond = condText(m[2], names);
    const verb = m[1] === 'while' ? 'Repeats the block while' : m[1] === 'elif' ? 'Otherwise, if' : 'If';
    return `${verb} ${cond}${m[3] ? `: ${lineHint(m[3], 0, frags).replace(/^./, (c) => c.toLowerCase()) || m[3]}` : ', the block below runs'}.`.replace(/\.\.$/, '.');
  }
  if (/^else\s*:/.test(line)) return 'Otherwise: the block below runs.';
  if (/^loop\s*:/.test(line)) return 'Repeats the block below forever (leave it with break or stop).';
  if (/^repeat\s*:/.test(line)) return 'Runs the block below until the condition of its until holds.';
  if ((m = /^until\s+(.*)$/.exec(line))) return `Ends the repeat once ${condText(m[1], names)}.`;
  if ((m = /^for\s+(\w+)\s+in\s+(.*?):/.exec(line))) return `For each ${m[1]} in ${describe(m[2], names) || m[2]}: the block below runs.`;
  if ((m = /^def\s+(\w+)/.exec(line))) return `Defines the procedure ${m[1]}.`;
  if ((m = /^return\b\s*(.*)$/.exec(line))) return m[1] ? `Returns ${describe(m[1], names) || m[1]} from the procedure.` : 'Returns from the procedure (with none).';
  if (/^restart\b/.test(line)) return 'Ends the current search early; the next search starts afresh.';
  if ((m = /^stop\b\s*(.*)$/.exec(line))) return m[1] ? `Ends the run with the message ${m[1]} (outcome stopped).` : 'Ends the run (outcome finished).';
  if (/^break\b/.test(line)) return 'Leaves the innermost loop.';
  if (/^continue\b/.test(line)) return 'Goes to the next round of the innermost loop.';
  if ((m = /^count\s+(\w+)(?:\s+by\s+(.*))?$/.exec(line))) return `Adds ${m[2] || 1} to the counter ${m[1]} (Statistics tab).`;
  if ((m = /^track\s+(\w+)\s*=\s*(.*)$/.exec(line))) return `Records ${m[2]} as the next value of the series ${m[1]} (Statistics tab).`;
  if (/^log\b/.test(line)) return 'Prints the values to the Messages (Output tab).';
  if ((m = /^(\w+)\s*=(?!=)\s*(.*)$/.exec(line))) {
    const d = describe(m[2], names);
    return d ? `${m[1]} = ${d}.` : `Assigns ${m[2]} to ${m[1]}.`;
  }
  const d = describe(line, names);
  return d ? `${d.replace(/^./, (c) => c.toUpperCase())}.` : '';
}

const atomsOf = (l) => (l ? `${l.from}'s values of the interface atoms of ${l.to}` : '');
function condText(e, names) {
  const s = e.trim();
  let m;
  if ((m = /^not\s+(\w+)$/.exec(s))) return `${m[1]} is none (no model${checkOf(m[1], names) ? ': no counterexample' : ''})`;
  if ((m = /^(\w+)$/.exec(s)) && names.vars.has(m[1])) return `${m[1]} is not none${checkOf(m[1], names) ? ` (a counterexample was found)` : ''}`;
  return s;
}
// whether a variable holds the result of a check solver's solve
function checkOf(v, names) {
  const x = names.vars.get(v);
  const m = x && /^(\w+)\.solve\(/.exec(x.expr || '');
  return !!(m && [...names.links.values()].some((l) => l.to === m[1]));
}

// a phrase for the main call of an expression, or ''
function describe(e, names) {
  const s = e.trim();
  let m;
  if ((m = /^(\w+)(?:\[[^\]]*\])?\.solve\((.*)\)$/.exec(s))) {
    const S = m[1];
    const assume = /assume\s+(\w+)(?:\[[^\]]*\])?\((\w+)\)/.exec(m[2]);
    const isCheck = [...names.links.values()].some((l) => l.to === S);
    const what = isCheck ? 'a counterexample from' : 'a model of';
    const opt = /\boptimal\b/.test(m[2]) ? ' (an optimal one)' : '';
    return assume
      ? `${what} solver ${S}${opt} under the values of ${assume[1]}'s interface atoms in ${assume[2]}, or none if there is none${isCheck ? ' (the candidate passes)' : ''}`
      : `${what} solver ${S}${opt}, or none if it is unsatisfiable`;
  }
  if ((m = /^(\w+)(?:\[[^\]]*\])?\.models\((.*)\)$/.exec(s))) {
    const lim = /limit\s+([^,)]+)/.exec(m[2]);
    return `a list of ${lim ? `up to ${lim[1].trim()}` : 'all'} models of solver ${m[1]}`;
  }
  if ((m = /^(\w+)(?:\[[^\]]*\])?\.clause\((\w+),\s*(\w+)\)$/.exec(s))) return `the clause "one atom marked relevant in ${m[3]} must change its value from ${m[2]}" (link ${m[1]})`;
  if ((m = /^(\w+)(?:\[[^\]]*\])?\.block\((\w+)\)$/.exec(s))) return `the clause that rules out exactly ${m[2]}'s values of ${m[1]}'s interface atoms`;
  if ((m = /^(\w+)(?:\[[^\]]*\])?\.core\((\w+)\)$/.exec(s))) return `the clause from the unsat core of ${m[2]}'s last solve (link ${m[1]})`;
  if ((m = /^(\w+)(?:\[[^\]]*\])?\.clauses\((\w+)\)$/.exec(s))) return `the clauses stated by the clause/3 atoms of ${m[2]}`;
  if ((m = /^(\w+)\.add\((.*)\)$/.exec(s))) return `add ${describe(m[2], names) || m[2]} to solver ${m[1]} before its next solve`;
  if ((m = /^(\w+)\.expand\((\w+)/.exec(s))) return `ground the part ${m[2]}(k) of solver ${m[1]} with the next k, after adding the given facts`;
  if ((m = /^(\w+)\.atoms\((\w+)\/(\d+)\)$/.exec(s))) return `the true atoms of ${m[2]}/${m[3]} in ${m[1]}`;
  if ((m = /^(\w+)(?:\[[^\]]*\])?\((\w+)\)$/.exec(s)) && names.links.has(m[1])) return `${atomsOf(names.links.get(m[1])).replace(/^\w+'s/, `${m[2]}'s`)} (a list of assumptions)`;
  if (s === '[]') return 'a new empty list';
  return '';
}
