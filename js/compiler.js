// The loop language: script in, Lua out (manual: The loop language).
// No DOM, no Node APIs: used by the page and by the tests.

export const KEYWORDS = new Set(('solver link via options legacy compat lift keep def return if elif else loop while repeat until for in ' +
  'search on candidate partial every reject with accept restart stop break continue count by track log assume limit optimal and or not ' +
  'true false none as').split(' '));
const LUA_RESERVED = new Set(('and break do else elseif end false for function goto if in local nil not or repeat return ' +
  'then true until while').split(' '));
const RESERVED = new Set([...LUA_RESERVED, 'rt', 'clingo', 'FRAGMENTS', 'CONSTS', 'SETTINGS', 'main', 'LOOP_LINES', 'ipairs', '_']);
const COMPOUND = new Set(['if', 'elif', 'else', 'loop', 'while', 'repeat', 'for', 'search', 'on']);

export const SOLVER_MEMBERS = ['solve', 'models', 'add', 'expand', 'exhausted', 'step', 'core', 'atom', 'ground', 'set', 'release'];
export const LINK_MEMBERS = ['clause', 'block', 'core', 'clauses', 'lift', 'above', 'below', 'extend'];
export const VALUE_MEMBERS = ['atoms', 'push', 'clear', 'size', 'on', 'flip', 'without', 'true', 'value', 'count', 'cost', 'arg', 'minimal'];

class CompileError extends Error {
  constructor(line, col, message) { super(message); this.line = line; this.col = col; }
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------
const OPS = ['->', '==', '!=', '<=', '>=', '=', '<', '>', '+', '-', '*', '//', '/', '(', ')', '[', ']', ',', '..', '.', ':'];

export function lex(source) {
  const toks = [], errors = [];
  const stack = [0];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const tok = (type, value, line, col) => toks.push({ type, value, line, col });
  for (let li = 0; li < lines.length; li++) {
    const text = lines[li], line = li + 1;
    const tab = text.indexOf('\t');
    if (tab >= 0) errors.push({ line, col: tab + 1, message: 'tabs are not allowed; indent with spaces' });
    const t = text.replace(/\t/g, ' ');
    let i = 0;
    while (i < t.length && t[i] === ' ') i++;
    if (i === t.length || t[i] === '#') continue;            // blank or comment-only line
    const width = i;
    if (width > stack.at(-1)) { stack.push(width); tok('INDENT', '', line, 1); }
    else if (width < stack.at(-1)) {
      while (width < stack.at(-1)) { stack.pop(); tok('DEDENT', '', line, 1); }
      if (width !== stack.at(-1)) {
        errors.push({ line, col: width + 1, message: 'inconsistent indentation: this line matches no enclosing block' });
        stack.push(width);
      }
    }
    while (i < t.length) {
      const c = t[i], col = i + 1;
      if (c === ' ') { i++; continue; }
      if (c === '#') break;
      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1;
        while (j < t.length && /[A-Za-z0-9_]/.test(t[j])) j++;
        const w = t.slice(i, j);
        tok(KEYWORDS.has(w) ? 'kw' : 'name', w, line, col);
        i = j; continue;
      }
      if (/[0-9]/.test(c)) {
        let j = i + 1;
        while (j < t.length && /[0-9]/.test(t[j])) j++;
        if (t[j] === '.' && /[0-9]/.test(t[j + 1] || '')) { j++; while (j < t.length && /[0-9]/.test(t[j])) j++; }
        tok('num', t.slice(i, j), line, col);
        i = j; continue;
      }
      if (c === '"') {
        let j = i + 1, s = '', closed = false;
        while (j < t.length) {
          if (t[j] === '\\' && (t[j + 1] === '"' || t[j + 1] === '\\')) { s += t[j + 1]; j += 2; continue; }
          if (t[j] === '"') { closed = true; j++; break; }
          s += t[j]; j++;
        }
        if (!closed) errors.push({ line, col, message: 'unterminated string' });
        tok('str', s, line, col);
        i = j; continue;
      }
      const op = OPS.find((o) => t.startsWith(o, i));
      if (op) { tok('op', op, line, col); i += op.length; continue; }
      errors.push({ line, col, message: `unexpected character '${c}'` });
      i++;
    }
    tok('NEWLINE', '', line, t.length + 1);
  }
  const end = lines.length + 1;
  while (stack.length > 1) { stack.pop(); tok('DEDENT', '', end, 1); }
  tok('EOF', '', end, 1);
  return { toks, errors };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------
function describe(t) {
  if (t.type === 'NEWLINE') return 'end of line';
  if (t.type === 'INDENT') return 'an indented block';
  if (t.type === 'DEDENT') return 'the end of a block';
  if (t.type === 'EOF') return 'end of script';
  if (t.type === 'str') return 'a string';
  return `'${t.value}'`;
}

class Parser {
  constructor(toks) { this.toks = toks; this.i = 0; }
  peek(k = 0) { return this.toks[this.i + k]; }
  next() { return this.toks[this.i++]; }
  is(type, value) { const t = this.peek(); return t.type === type && (value === undefined || t.value === value); }
  isKw(v) { return this.is('kw', v); }
  isOp(v) { return this.is('op', v); }
  fail(t, msg) { throw new CompileError(t.line, t.col, msg); }
  expect(type, value, what) {
    const t = this.peek();
    if (t.type !== type || (value !== undefined && t.value !== value)) {
      this.fail(t, `expected ${what || (value ? `'${value}'` : type)}, found ${describe(t)}`);
    }
    return this.next();
  }
  name(what = 'a name') { return this.expect('name', undefined, what); }

  script() {
    const decls = [], stmts = [];
    while (this.is('NEWLINE')) this.next();
    while (this.isKw('solver') || this.isKw('link')) decls.push(this.decl());
    const defs = [];
    while (this.isKw('def')) defs.push(this.def());
    while (!this.is('EOF')) {
      if (this.isKw('solver') || this.isKw('link')) this.fail(this.peek(), 'declarations must come before the first statement');
      if (this.isKw('def')) this.fail(this.peek(), "'def' must come before the first statement");
      if (this.is('INDENT')) this.fail(this.peek(), 'unexpected indentation');
      stmts.push(this.stmt());
    }
    return { decls, defs, stmts };
  }

  // def NAME(a, b): block (phase L4)
  def() {
    const kw = this.next();
    const name = this.name('a procedure name');
    this.expect('op', '(');
    const params = [];
    if (!this.isOp(')')) {
      params.push(this.name('a parameter name'));
      while (this.isOp(',')) { this.next(); params.push(this.name('a parameter name')); }
    }
    this.expect('op', ')');
    return { t: 'def', line: kw.line, col: kw.col, name, params, body: this.block() };
  }

  // [i in lo..hi] after a family name (phase L4)
  family() {
    if (!this.isOp('[')) return null;
    const open = this.next();
    const v = this.name('the index variable of a family');
    this.expect('kw', 'in');
    const lo = this.sum();
    this.expect('op', '..', "'..'");
    const hi = this.sum();
    this.expect('op', ']');
    return { v, lo, hi, line: open.line, col: open.col };
  }
  member() {
    const name = this.name('a solver name');
    if (this.isOp('[')) { this.next(); const idx = this.expr(); this.expect('op', ']'); return { name, idx }; }
    return { name, idx: null };
  }

  frags() {
    const out = [this.name('a fragment name')];
    while (this.isOp('+')) { this.next(); out.push(this.name('a fragment name')); }
    return out;
  }

  decl() {
    const kw = this.next();
    const name = this.name(`a ${kw.value} name`);
    const family = this.family();
    this.expect('op', '=');
    if (kw.value === 'solver') {
      const frags = this.frags();
      let options = null;
      if (this.isKw('options')) { this.next(); options = this.expect('str', undefined, 'an option string'); }
      this.expect('NEWLINE', undefined, 'end of line');
      return { t: 'solver', line: kw.line, col: kw.col, name, frags, options, family };
    }
    const fromM = this.member();
    this.expect('op', '->');
    const toM = this.member();
    const from = fromM.name, to = toM.name;
    this.expect('kw', 'via');
    const frags = this.frags();
    let legacy = false, compat = false, lift = false, liftTok = null;
    while (this.isKw('legacy') || this.isKw('compat') || this.isKw('lift')) {
      const t = this.next();
      if (t.value === 'legacy') legacy = true; else if (t.value === 'compat') compat = true; else { lift = true; liftTok = t; }
    }
    this.expect('NEWLINE', undefined, 'end of line');
    return { t: 'link', line: kw.line, col: kw.col, name, from, to, frags, legacy, compat, lift, liftTok, family, fromIdx: fromM.idx, toIdx: toM.idx };
  }

  block() {
    this.expect('op', ':');
    if (this.is('NEWLINE')) {
      this.next();
      this.expect('INDENT', undefined, 'an indented block');
      const body = [];
      while (!this.is('DEDENT') && !this.is('EOF')) body.push(this.stmt());
      this.expect('DEDENT', undefined, 'the end of the block');
      return body;
    }
    const t = this.peek();
    if (t.type === 'kw' && COMPOUND.has(t.value)) {
      this.fail(t, `a compound statement ('${t.value}') cannot follow ':' on the same line; start a new indented line`);
    }
    return [this.stmt()];
  }

  endLine() { this.expect('NEWLINE', undefined, 'end of line'); }

  stmt() {
    const t = this.peek();
    const at = { line: t.line, col: t.col };
    if (t.type === 'kw') {
      switch (t.value) {
        case 'if': {
          this.next();
          const branches = [{ cond: this.expr(), body: this.block(), ...at }];
          let orelse = null;
          while (this.isKw('elif')) { const e = this.next(); branches.push({ cond: this.expr(), body: this.block(), line: e.line, col: e.col }); }
          if (this.isKw('else')) { const e = this.next(); orelse = { body: this.block(), line: e.line, col: e.col }; }
          return { t: 'if', ...at, branches, orelse };
        }
        case 'loop': this.next(); return { t: 'loop', ...at, body: this.block() };
        case 'while': { this.next(); const cond = this.expr(); return { t: 'while', ...at, cond, body: this.block() }; }
        case 'repeat': {
          this.next();
          const body = this.block();
          const u = this.expect('kw', 'until', "'until'");
          const cond = this.expr();
          this.endLine();
          return { t: 'repeat', ...at, body, cond, untilLine: u.line };
        }
        case 'for': {
          this.next();
          const v = this.name('a loop variable');
          this.expect('kw', 'in');
          const iter = this.expr();
          return { t: 'for', ...at, v, iter, body: this.block() };
        }
        case 'search': {
          this.next();
          const s = this.name('a solver name');
          let sidx = null;
          if (this.isOp('[')) { this.next(); sidx = this.expr(); this.expect('op', ']'); }
          // phase L2: search S [assume e, ...] [optimal] [keep Y]:
          const assume = [];
          let optimal = false, keep = null;
          if (this.isKw('assume')) { this.next(); assume.push(this.expr()); while (this.isOp(',')) { this.next(); assume.push(this.expr()); } }
          if (this.isKw('optimal')) { this.next(); optimal = true; }
          if (this.isKw('keep')) {
            const kt = this.next();
            if (!this.is('name')) this.fail(kt, "'keep' needs a name, as in: search B assume E keep Y:");
            keep = this.name('a name');
          }
          this.expect('op', ':');
          this.expect('NEWLINE', undefined, "end of line after 'search S:'");
          this.expect('INDENT', undefined, "an indented 'on candidate M:' line");
          // G5: on partial P [every n]: before on candidate
          let partial = null;
          const onPartial = () => this.isKw('on') && this.toks[this.i + 1] && this.toks[this.i + 1].type === 'kw' && this.toks[this.i + 1].value === 'partial';
          if (onPartial()) {
            const pt = this.next();
            this.next();
            const pv = this.name('a candidate variable');
            let every = null;
            if (this.isKw('every')) { this.next(); every = this.expr(); }
            const pbody = this.block();
            partial = { v: pv, every, body: pbody, line: pt.line };
          }
          const on = this.expect('kw', 'on', "'on candidate M:'");
          if (this.isKw('partial')) this.fail(this.peek(), partial ? "only one 'on partial' block is allowed inside 'search'" : "'on partial' must come before 'on candidate'");
          this.expect('kw', 'candidate', "'candidate'");
          const v = this.name('a candidate variable');
          const body = this.block();
          if (onPartial()) this.fail(this.peek(), "'on partial' must come before 'on candidate'");
          if (!this.is('DEDENT')) this.fail(this.peek(), "only one 'on candidate' block is allowed inside 'search'");
          this.next();
          return { t: 'search', ...at, solver: s, sidx, v, body, onLine: on.line, assume, optimal, keep, partial };
        }
        case 'return': {
          this.next();
          const e = this.is('NEWLINE') ? null : this.expr();
          this.endLine();
          return { t: 'return', ...at, e };
        }
        case 'reject': {
          this.next();
          const v = this.name('the candidate variable');
          this.expect('kw', 'with');
          const e = this.expr();
          this.endLine();
          return { t: 'reject', ...at, v, e };
        }
        case 'accept': {
          this.next();
          const e = this.expr();
          // accept M as NAME: a second kind of solution, reported and counted under its own name
          let label = null;
          if (this.peek().type === 'kw' && this.peek().value === 'as') { this.next(); label = this.name('a name for this kind of solution'); }
          this.endLine();
          return { t: 'accept', ...at, e, label };
        }
        case 'restart': case 'break': case 'continue':
          this.next(); this.endLine(); return { t: t.value, ...at };
        case 'stop': {
          this.next();
          let msg = null;
          if (this.is('str')) msg = this.next().value;
          this.endLine();
          return { t: 'stop', ...at, msg };
        }
        case 'count': {
          this.next();
          const n = this.name('a counter name');
          let by = null;
          if (this.isKw('by')) { this.next(); by = this.expr(); }
          this.endLine();
          return { t: 'count', ...at, n, by };
        }
        case 'track': {
          this.next();
          const n = this.name('a value name');
          if (!this.isOp('=')) this.fail(this.peek(), `track needs a value, as in track ${n.value} = e`);
          this.next();
          const v = this.expr();
          this.endLine();
          return { t: 'track', ...at, n, v };
        }
        case 'log': {
          this.next();
          const args = [this.expr()];
          while (this.isOp(',')) { this.next(); args.push(this.expr()); }
          this.endLine();
          return { t: 'log', ...at, args };
        }
        case 'elif': case 'else': this.fail(t, `'${t.value}' without a matching 'if'`); break;
        case 'until': this.fail(t, "'until' without a matching 'repeat'"); break;
        case 'on': this.fail(t, "'on candidate' must be the only line inside 'search S:'"); break;
        default: break;
      }
    }
    if (t.type === 'name' && this.peek(1).type === 'op' && this.peek(1).value === '=') {
      this.next(); this.next();
      const e = this.expr();
      this.endLine();
      return { t: 'assign', ...at, target: t, e };
    }
    const e = this.expr();
    this.endLine();
    return { t: 'expr', ...at, e };
  }

  // expressions
  expr() { return this.disj(); }
  disj() { let a = this.conj(); while (this.isKw('or')) { const o = this.next(); a = { t: 'bin', op: 'or', a, b: this.conj(), line: o.line, col: o.col }; } return a; }
  conj() { let a = this.neg(); while (this.isKw('and')) { const o = this.next(); a = { t: 'bin', op: 'and', a, b: this.neg(), line: o.line, col: o.col }; } return a; }
  neg() {
    if (this.isKw('not')) { const o = this.next(); return { t: 'not', e: this.cmp(), line: o.line, col: o.col }; }
    return this.cmp();
  }
  cmp() {
    const a = this.sum();
    const t = this.peek();
    if (t.type === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.value)) {
      this.next();
      const b = this.sum();
      return { t: 'bin', op: t.value, a, b, line: t.line, col: t.col };
    }
    return a;
  }
  sum() {
    let a = this.term();
    while (this.isOp('+') || this.isOp('-')) { const o = this.next(); a = { t: 'bin', op: o.value, a, b: this.term(), line: o.line, col: o.col }; }
    return a;
  }
  term() {
    let a = this.unary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('//')) { const o = this.next(); a = { t: 'bin', op: o.value, a, b: this.unary(), line: o.line, col: o.col }; }
    return a;
  }
  unary() {
    if (this.isOp('-')) { const o = this.next(); return { t: 'neg', e: this.post(), line: o.line, col: o.col }; }
    return this.post();
  }
  post() {
    let e = this.atom();
    for (;;) {
      if (this.isOp('.')) {
        this.next();
        // a keyword that is also a member name (G.lift) reads as a name after the dot
        const n = this.peek().type === 'kw' ? { ...this.next(), type: 'name' } : this.name('a member name');
        if (this.isOp('(')) { const args = this.args(); e = { t: 'method', obj: e, name: n.value, args, line: n.line, col: n.col }; }
        else e = { t: 'attr', obj: e, name: n.value, line: n.line, col: n.col };
      } else if (this.isOp('(')) {
        const p = this.peek();
        const args = this.args();
        e = { t: 'call', fn: e, args, line: p.line, col: p.col };
      } else if (this.isOp('[') && e.t === 'name') {
        const p = this.next();
        const idx = this.expr();
        this.expect('op', ']');
        e = { t: 'index', obj: e, idx, line: p.line, col: p.col };
      } else return e;
    }
  }
  args() {
    this.expect('op', '(');
    const out = [];
    if (this.isOp(')')) { this.next(); return out; }
    for (;;) {
      out.push(this.arg());
      if (this.isOp(',')) { this.next(); continue; }
      this.expect('op', ')', "',' or ')'");
      return out;
    }
  }
  arg() {
    const t = this.peek();
    const at = { line: t.line, col: t.col };
    if (this.isKw('assume')) { this.next(); return { k: 'assume', e: this.expr(), ...at }; }
    if (this.isKw('limit')) { this.next(); return { k: 'limit', e: this.expr(), ...at }; }
    if (this.isKw('optimal')) { this.next(); return { k: 'optimal', ...at }; }
    if (this.isKw('while')) { this.next(); return { k: 'while', e: this.expr(), ...at }; }
    const n1 = this.peek(1), n2 = this.peek(2), n3 = this.peek(3);
    if (t.type === 'name' && n1.type === 'op' && n1.value === '=') {
      this.next(); this.next();
      return { k: 'named', name: t.value, e: this.expr(), ...at };
    }
    if (t.type === 'name' && n1.type === 'op' && n1.value === '/' && n2.type === 'num' && /^\d+$/.test(n2.value) &&
        n3.type === 'op' && (n3.value === ')' || n3.value === ',')) {
      this.next(); this.next(); this.next();
      return { k: 'pred', name: t.value, arity: Number(n2.value), ...at };
    }
    return { k: 'pos', e: this.expr(), ...at };
  }
  atom() {
    const t = this.next();
    if (t.type === 'name') return { t: 'name', name: t.value, line: t.line, col: t.col };
    if (t.type === 'num') return { t: 'num', v: t.value, line: t.line, col: t.col };
    if (t.type === 'str') return { t: 'str', v: t.value, line: t.line, col: t.col };
    if (t.type === 'kw' && (t.value === 'true' || t.value === 'false')) return { t: 'bool', v: t.value, line: t.line, col: t.col };
    if (t.type === 'kw' && t.value === 'none') return { t: 'none', line: t.line, col: t.col };
    if (t.type === 'op' && t.value === '[') { this.expect('op', ']', "']' (only the empty list [] can be written)"); return { t: 'list', line: t.line, col: t.col }; }
    if (t.type === 'op' && t.value === '(') { const e = this.expr(); this.expect('op', ')'); return { t: 'paren', e, line: t.line, col: t.col }; }
    this.fail(t, `expected an expression, found ${describe(t)}`);
  }
}

// ---------------------------------------------------------------------------
// Code generation and static checks
// ---------------------------------------------------------------------------
export function luaString(s) {
  return '"' + String(s).replace(/[\\"\x00-\x1f]/g, (c) => {
    if (c === '\\') return '\\\\';
    if (c === '"') return '\\"';
    if (c === '\n') return '\\n';
    return '\\' + String(c.charCodeAt(0)).padStart(3, '0');
  }) + '"';
}

const PREC = { or: 1, and: 2, '==': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, '+': 4, '-': 4, '*': 5, '/': 5, '//': 5 };
const LUA_OP = { '!=': '~=' };

function collectAssigned(stmts, out, { intoCandidates }) {
  for (const s of stmts) {
    if (s.t === 'assign') out.add(s.target.value);
    if (s.t === 'search' && s.keep) out.add(s.keep.value);
    const kids = [];
    if (s.t === 'if') { for (const b of s.branches) kids.push(b.body); if (s.orelse) kids.push(s.orelse.body); }
    if (['loop', 'while', 'repeat', 'for'].includes(s.t)) kids.push(s.body);
    if (s.t === 'search' && intoCandidates) { kids.push(s.body); if (s.partial) kids.push(s.partial.body); }
    for (const k of kids) collectAssigned(k, out, { intoCandidates });
  }
}

export function compile(source, { fragments = [] } = {}) {
  const { toks, errors } = lex(source);
  let ast = null;
  try { ast = new Parser(toks).script(); } catch (e) {
    if (!(e instanceof CompileError)) throw e;
    errors.push({ line: e.line, col: e.col, message: e.message });
  }
  if (!ast) return finishErrors(errors);

  const err = (node, message) => errors.push({ line: node.line, col: node.col, message });
  const fragSet = new Set(fragments);
  const solvers = new Map(), links = new Map();
  const outSolvers = [], outLinks = [], parts = [], captures = [];
  const capSeen = new Set();
  const out = [];                       // { text, line }
  const emit = (text, line, depth) => out.push({ text: '    ' + '  '.repeat(depth) + text, line });

  const checkName = (tok, what) => {
    if (RESERVED.has(tok.value) || tok.value.startsWith('__')) err(tok, `'${tok.value}' is a reserved name and cannot be used as ${what}`);
  };

  // declarations
  // the range of a family and the indices of its link ends: numbers, project constants (rt.const)
  // and the family's index variable
  function rangeEx(e, v) {
    switch (e.t) {
      case 'num': return String(e.v);
      case 'name': return e.name === v ? v : `rt.const(${luaString(e.name)})`;
      case 'paren': return `(${rangeEx(e.e, v)})`;
      case 'neg': return `(-${rangeEx(e.e, v)})`;
      case 'bin': if (['+', '-', '*', '/', '//'].includes(e.op)) return `(${rangeEx(e.a, v)} ${e.op === '/' ? '//' : e.op} ${rangeEx(e.b, v)})`; break;
      default: break;
    }
    err(e, 'the range of a family must be made of numbers and project constants');
    return '0';
  }
  for (const d of ast.decls) {
    checkName(d.name, `a ${d.t} name`);
    if (solvers.has(d.name.value) || links.has(d.name.value)) err(d.name, `duplicate declaration of '${d.name.value}'`);
    for (const f of d.frags) if (!fragSet.has(f.value)) err(f, `unknown fragment '${f.value}'` + (fragments.length ? ` (fragments: ${fragments.join(', ')})` : ''));
    const fr = d.frags.map((f) => luaString(f.value)).join(', ');
    const fam = d.family;
    if (fam) checkName(fam.v, 'an index variable');
    if (d.t === 'solver') {
      const opts = d.options ? d.options.value.split(/\s+/).filter(Boolean) : [];
      solvers.set(d.name.value, d);
      outSolvers.push({ name: d.name.value, fragments: d.frags.map((f) => f.value), options: opts, ...(fam ? { family: true } : {}) });
      if (fam) {
        // solver S[i in lo..hi]: members S1, S2, ... each grounded with -c level=i
        const v = fam.v.value;
        emit(`local ${d.name.value} = {}; for ${v} = ${rangeEx(fam.lo, null)}, ${rangeEx(fam.hi, null)} do ${d.name.value}[${v}] = rt.solver(${luaString(d.name.value)} .. ${v}, {${fr}}, {${[...opts.map(luaString), '"-c"'].join(', ')}, "level=" .. ${v}}) end; ${d.name.value}.size = math.max(0, ${rangeEx(fam.hi, null)} - ${rangeEx(fam.lo, null)} + 1)`, d.line, 0);
      } else emit(`local ${d.name.value} = rt.solver(${luaString(d.name.value)}, {${fr}}, {${opts.map(luaString).join(', ')}})`, d.line, 0);
    } else {
      for (const end of [d.from, d.to]) if (!solvers.has(end.value)) err(end, `'${end.value}' is not a declared solver`);
      const famOf = (n) => solvers.get(n.value) && solvers.get(n.value).family;
      if (!fam && d.from.value === d.to.value) err(d.to, 'a link needs two different solvers');
      if (famOf(d.from) && !d.fromIdx) err(d.from, `'${d.from.value}' is a solver family: write ${d.from.value}[i]`);
      if (famOf(d.to) && !d.toIdx) err(d.to, `'${d.to.value}' is a solver family: write ${d.to.value}[i]`);
      if (d.fromIdx && solvers.has(d.from.value) && !famOf(d.from)) err(d.from, `'${d.from.value}' is not a solver family`);
      if (d.toIdx && solvers.has(d.to.value) && !famOf(d.to)) err(d.to, `'${d.to.value}' is not a solver family`);
      links.set(d.name.value, d);
      if (d.lift && d.compat) err(d.liftTok, "'lift' and 'compat' cannot be combined");
      outLinks.push({ name: d.name.value, from: d.from.value, to: d.to.value, fragments: d.frags.map((f) => f.value), legacy: d.legacy, compat: d.compat,
        ...(d.lift ? { lift: true } : {}), ...(fam ? { family: true } : {}) });
      const o = [d.legacy && 'legacy = true', d.compat && 'compat = true', d.lift && 'lift = true'].filter(Boolean);
      if (fam) {
        const v = fam.v.value;
        const end = (n, idx) => (idx ? `${n.value}[${rangeEx(idx, v)}]` : n.value);
        emit(`local ${d.name.value} = {}; ${d.name.value}.size = math.max(0, ${rangeEx(fam.hi, null)} - ${rangeEx(fam.lo, null)} + 1); for ${v} = ${rangeEx(fam.lo, null)}, ${rangeEx(fam.hi, null)} do ${d.name.value}[${v}] = rt.link(${luaString(d.name.value)} .. ${v}, ${end(d.from, d.fromIdx)}, ${end(d.to, d.toIdx)}, {${fr}}, {${[...o, `consts = { "level=" .. ${v} }`].join(', ')}}) end`, d.line, 0);
      } else emit(`local ${d.name.value} = rt.link(${luaString(d.name.value)}, ${d.from.value}, ${d.to.value}, {${fr}}, {${o.join(', ')}})`, d.line, 0);
    }
  }
  const isDecl = (n) => solvers.has(n) || links.has(n);

  // known names: everything assigned anywhere, loop and candidate variables
  const known = new Set();
  collectAssigned(ast.stmts, known, { intoCandidates: true });
  (function walk(stmts) {
    for (const s of stmts) {
      if (s.t === 'for') known.add(s.v.value);
      if (s.t === 'search') { known.add(s.v.value); if (s.partial) { known.add(s.partial.v.value); walk(s.partial.body); } }
      if (s.t === 'if') { for (const b of s.branches) walk(b.body); if (s.orelse) walk(s.orelse.body); }
      if (['loop', 'while', 'repeat', 'for', 'search'].includes(s.t)) walk(s.body);
    }
  })(ast.stmts);

  // context
  let labelN = 0;
  const ctx = { cand: null, loops: [], def: null };
  // procedures: name -> number of parameters; their parameters and locals are known names
  const procs = new Map();
  for (const df of ast.defs || []) {
    checkName(df.name, 'a procedure name');
    if (isDecl(df.name.value) || procs.has(df.name.value)) err(df.name, `duplicate declaration of '${df.name.value}'`);
    procs.set(df.name.value, df.params.length);
    known.add(df.name.value);
    for (const x of df.params) { checkName(x, 'a parameter name'); known.add(x.value); }
    collectAssigned(df.body, known, { intoCandidates: true });
    (function walk(list) {
      for (const st of list) {
        if (st.t === 'for' || st.t === 'search') known.add(st.v.value);
        if (st.t === 'search' && st.partial) { known.add(st.partial.v.value); walk(st.partial.body); }
        if (st.t === 'if') { for (const b of st.branches) walk(b.body); if (st.orelse) walk(st.orelse.body); }
        if (['loop', 'while', 'repeat', 'for', 'search'].includes(st.t)) walk(st.body);
      }
    })(df.body);
  }

  // which members of each link the script uses (the audit decides what to audit from it)
  const linkUses = {};
  let minimalCore = false;          // C.core.minimal somewhere (the audit of a core loop shrinks its cores too)
  function use(G, name) { (linkUses[G] = linkUses[G] || new Set()).add(name); }
  // the solver a variable's model comes from, when the script says so directly
  const varSolver = new Map();
  (function walkVars(list) {
    for (const s of list) {
      if (s.t === 'search') {
        varSolver.set(s.v.value, s.solver.value); walkVars(s.body);
        if (s.partial) { varSolver.set(s.partial.v.value, s.solver.value); walkVars(s.partial.body); }
        continue;
      }
      if (s.t === 'assign' && s.e.t === 'method' && s.e.obj.t === 'name' && solvers.has(s.e.obj.name) && ['solve', 'models'].includes(s.e.name)) {
        const prev = varSolver.get(s.target.value);
        varSolver.set(s.target.value, prev && prev !== s.e.obj.name ? '?' : s.e.obj.name);
      }
      if (s.t === 'if') { for (const b of s.branches) walkVars(b.body); if (s.orelse) walkVars(s.orelse.body); }
      if (['loop', 'while', 'repeat', 'for'].includes(s.t)) walkVars(s.body);
    }
  })(ast.stmts);

  function capture(p, n) {
    const k = `${p}/${n}`;
    if (!capSeen.has(k)) { capSeen.add(k); captures.push({ pred: p, arity: n }); }
  }

  function ex(e, parentPrec = 0) {
    switch (e.t) {
      case 'name': {
        const n = e.name;
        if (!isDecl(n) && !known.has(n)) err(e, `unknown name '${n}'`);
        return n;
      }
      case 'num': return e.v;
      case 'str': return luaString(e.v);
      case 'bool': return e.v;
      case 'none': return 'nil';
      case 'list': return '{}';
      case 'paren': return `(${ex(e.e)})`;
      case 'not': {
        const inner = e.e.t === 'bin' ? `(${ex(e.e)})` : ex(e.e, 6);
        const s = `not ${inner}`;
        return parentPrec > 2 ? `(${s})` : s;
      }
      case 'neg': {
        const s = `-${ex(e.e, 6)}`;
        return s;
      }
      case 'bin': {
        // c + d joins two clauses of one link; on numbers it stays addition (rt.plus)
        if (e.op === '+') return `rt.plus(${ex(e.a)}, ${ex(e.b)})`;
        const p = PREC[e.op];
        const s = `${ex(e.a, p)} ${LUA_OP[e.op] || e.op} ${ex(e.b, p + 1)}`;
        return p < parentPrec ? `(${s})` : s;
      }
      case 'index': {
        if (e.obj.t === 'name' && ((solvers.get(e.obj.name) || {}).family || (links.get(e.obj.name) || {}).family)) return `${e.obj.name}[${ex(e.idx)}]`;
        err(e, 'only a solver or link family can be indexed, as in S[i]');
        return 'nil';
      }
      case 'attr': return member(e, null);
      case 'method': return member(e, e.args);
      case 'call': {
        if (e.fn.t === 'index' && e.fn.obj.t === 'name' && links.has(e.fn.obj.name)) {
          const G = e.fn.obj.name;
          if (!links.get(G).family) err(e.fn, `'${G}' is not a link family`);
          use(G, 'of');
          const pos = positional(e.args, e, `${G}[i](M)`);
          if (pos.length !== 1 && pos.length !== 2) err(e, `${G}[i](M) takes a model, and for a partial candidate a value for its open atoms: ${G}[i](P, false)`);
          return `${G}[${ex(e.fn.idx)}]:of(${pos.map((a) => ex(a)).join(', ')})`;
        }
        if (e.fn.t === 'name' && procs.has(e.fn.name)) {
          const pos = positional(e.args, e, `${e.fn.name}(...)`);
          const want = procs.get(e.fn.name);
          if (pos.length !== want) err(e, `${e.fn.name} takes ${want} argument${want === 1 ? '' : 's'}`);
          return `${e.fn.name}(${pos.map((a) => ex(a)).join(', ')})`;
        }
        // pool(name): the items of a stored pool (lists of atoms), as rt.pool("name")
        if (e.fn.t === 'name' && e.fn.name === 'pool' && !links.has('pool') && !solvers.has('pool')) {
          const pos = positional(e.args, e, 'pool(name)');
          if (pos.length !== 1 || pos[0].t !== 'name') { err(e, 'pool takes the name of a pool, as in pool(cex)'); return 'nil'; }
          return `rt.pool(${luaString(pos[0].name)})`;
        }
        if (e.fn.t === 'name' && links.has(e.fn.name)) {
          use(e.fn.name, 'of');
          const pos = positional(e.args, e, `${e.fn.name}(M)`);
          if (pos.length !== 1 && pos.length !== 2) err(e, `${e.fn.name}(M) takes a model, and for a partial candidate a value for its open atoms: ${e.fn.name}(P, false)`);
          return `${e.fn.name}:of(${pos.map((a) => ex(a)).join(', ')})`;
        }
        const what = e.fn.t === 'name' ? `'${e.fn.name}'` : 'this expression';
        err(e, `${what} cannot be called; only a link can be called, as in G(M)`);
        return 'nil';
      }
      default: err(e, 'unsupported expression'); return 'nil';
    }
  }

  function positional(args, at, what) {
    const out = [];
    for (const a of args) {
      if (a.k === 'pos') out.push(a.e);
      else err(a, `${what}: unexpected ${a.k === 'pred' ? 'predicate' : `'${a.k === 'named' ? a.name + ' =' : a.k}'`} argument`);
    }
    return out;
  }

  function receiverText(obj) {
    if (obj.t === 'name') return ex(obj);
    if (obj.t === 'paren') return ex(obj);
    return `(${ex(obj)})`;
  }

  function member(e, args) {
    const obj = e.obj, name = e.name;
    let recvName = obj.t === 'name' ? obj.name : null;
    let recvLua = recvName;
    // a member of a family: S[i].solve(...), G[i-1].clause(...) (phase L4)
    if (obj.t === 'index' && obj.obj.t === 'name' && (solvers.has(obj.obj.name) || links.has(obj.obj.name))) {
      recvName = obj.obj.name;
      const d = solvers.get(recvName) || links.get(recvName);
      if (!d.family) err(obj, `'${recvName}' is not a ${solvers.has(recvName) ? 'solver' : 'link'} family`);
      recvLua = `${recvName}[${ex(obj.idx)}]`;
    } else if (recvName && ((solvers.get(recvName) || {}).family || (links.get(recvName) || {}).family)) {
      if (name === 'size' && !args) return `${recvName}.size`;
      err(obj, `'${recvName}' is a ${solvers.has(recvName) ? 'solver' : 'link'} family: write ${recvName}[i]`);
      return 'nil';
    }
    // solver
    if (recvName && solvers.has(recvName)) {
      const S = recvName, SR = recvLua;
      switch (name) {
        case 'exhausted': if (args) err(e, `${S}.exhausted is not a method`); return `${SR}.exhausted`;
        case 'step': if (args) err(e, `${S}.step is not a method`); return `${SR}.k`;
        case 'core': if (args) err(e, `${S}.core is not a method: write ${S}.core.on(G)`); return `${SR}:core()`;
        case 'ground': {
          const pos = args ? positional(args, e, `${S}.ground`) : [];
          if (!args || pos.length !== 2 || pos[0].t !== 'name') { err(e, `${S}.ground takes a program part and a number, as in ${S}.ground(step, t)`); return 'nil'; }
          return `${SR}:ground_part(${luaString(pos[0].name)}, ${ex(pos[1])})`;
        }
        case 'set': case 'release': {
          const pos = args ? positional(args, e, `${S}.${name}`) : [];
          const want = name === 'set' ? 2 : 1;
          if (!args || pos.length !== want) { err(e, name === 'set' ? `${S}.set takes an atom and true or false, as in ${S}.set(${S}.atom("frame", t), false)` : `${S}.release takes an atom`); return 'nil'; }
          return `${SR}:${name}(${pos.map((a) => ex(a)).join(', ')})`;
        }
        case 'atom': {
          const pos = args ? positional(args, e, `${S}.atom`) : [];
          if (!args || !pos.length) { err(e, `${S}.atom takes a predicate name and its arguments, as in ${S}.atom("bound", n)`); return 'nil'; }
          return `${SR}:atom(${pos.map((a) => ex(a)).join(', ')})`;
        }
        case 'solve': case 'models': {
          if (!args) { err(e, `${S}.${name} must be called: ${S}.${name}(...)`); return 'nil'; }
          let assume = null, limit = null, optimal = false;
          const extra = [];
          for (const a of args) {
            if (a.k === 'assume') { if (assume) err(a, "'assume' given twice"); assume = a.e; }
            else if (a.k === 'pos') { if (!assume) err(a, `${S}.${name}: write 'assume' before the first assumption list`); extra.push(a.e); }
            else if (a.k === 'limit' && name === 'models') limit = a.e;
            else if (a.k === 'optimal' && name === 'solve') optimal = true;
            else err(a, `${S}.${name}: unexpected argument${a.k === 'limit' ? " 'limit' (only models takes a limit)" : a.k === 'optimal' ? " 'optimal' (only solve can be optimal)" : ''}`);
          }
          const f = [];
          if (assume) f.push(`assume = ${extra.length ? `rt.concat(${[assume, ...extra].map((x) => ex(x)).join(', ')})` : ex(assume)}`);
          if (limit) f.push(`limit = ${ex(limit)}`);
          if (optimal) f.push('optimal = true');
          return `${SR}:${name}{${f.length ? ' ' + f.join(', ') + ' ' : ''}}`;
        }
        case 'add': {
          if (!args) { err(e, `${S}.add must be called: ${S}.add(clause)`); return 'nil'; }
          if (ctx.cand && ctx.cand.solver === S) err(e, `${S}.add cannot be used inside 'on candidate' of ${S}; use reject`);
          const guard = args.find((a) => a.k === 'while');
          const pos = positional(args.filter((a) => a.k !== 'while'), e, `${S}.add`);
          if (pos.length !== 1) err(e, `${S}.add takes one clause or a list of clauses`);
          return `${SR}:add(${pos.map((a) => ex(a)).join(', ')}${guard ? `, { guard = ${ex(guard.e)} }` : ''})`;
        }
        case 'expand': {
          if (!args) { err(e, `${S}.expand must be called: ${S}.expand(part, name = atoms)`); return 'nil'; }
          if (ctx.cand && ctx.cand.solver === S) err(e, `${S}.expand cannot be used inside 'on candidate' of ${S}; collect the counterexamples and expand after the search`);
          const [first, ...rest] = args;
          let part = null, partRec = null;
          if (!first || first.k !== 'pos' || first.e.t !== 'name') err(first || e, `${S}.expand: the first argument is the name of a program part, as in ${S}.expand(refine, cex = X.atoms(color/2))`);
          else { part = first.e.name; parts.push(partRec = { solver: S, part, line: first.line, col: first.col, facts: [] }); }
          const facts = [], factInfo = [];
          for (const a of rest) {
            if (a.k === 'named' && a.e.t === 'method' && a.e.name === 'atoms' && a.e.args && a.e.args.length === 1 && a.e.args[0].k === 'pred') {
              const rv = a.e.obj.t === 'name' ? varSolver.get(a.e.obj.name) : undefined;
              factInfo.push({ name: a.name, pred: a.e.args[0].name, arity: a.e.args[0].arity, receiver: rv === S ? 'abstraction' : rv ? 'other' : 'unknown' });
            }
            if (a.k === 'named') facts.push(`${a.name} = ${ex(a.e)}`);
            else err(a, `${S}.expand: facts are given as name = atoms`);
          }
          if (partRec) partRec.facts = factInfo;
          return `${SR}:expand(${luaString(part || '')}, { ${facts.join(', ')} })`.replace('{  }', '{}');
        }
        default:
          err(e, `unknown member '${name}' of solver ${S}; valid: ${SOLVER_MEMBERS.join(', ')}`);
          return 'nil';
      }
    }
    // link
    if (recvName && links.has(recvName)) {
      const G = recvName, GR = recvLua;
      if (!LINK_MEMBERS.includes(name)) { err(e, `unknown member '${name}' of link ${G}; valid: ${LINK_MEMBERS.join(', ')}, and ${G}(M)`); return 'nil'; }
      if (!args) { err(e, `${G}.${name} must be called`); return 'nil'; }
      const pos = positional(args, e, `${G}.${name}`);
      const want = { clause: 2, block: 1, core: 1, clauses: 1, lift: 2, above: 1, below: 1 }[name];
      if (name === 'extend') {
        if (pos.length !== 2 || pos[0].t !== 'name') { err(e, `${G}.extend takes a program part and a number, as in ${G}.extend(step, t)`); return 'nil'; }
        use(G, name);
        return `${GR}:extend(${luaString(pos[0].name)}, ${ex(pos[1])})`;
      }
      // G.clause(X): the clause from the counterexample alone (its own interface values)
      if (name === 'clause' && pos.length === 1) { use(G, name); return `${GR}:clause(nil, ${ex(pos[0])})`; }
      if (pos.length !== want) err(e, `${G}.${name} takes ${want === 1 ? 'one argument' : 'two arguments'}`);
      if (name === 'core' && pos[0] && !(pos[0].t === 'name' && solvers.has(pos[0].name))) err(pos[0], `${G}.core takes the check solver, as in ${G}.core(C)`);
      use(G, name);
      return `${GR}:${name}(${pos.map((a) => ex(a)).join(', ')})`;
    }
    // a value: model or list
    if (SOLVER_MEMBERS.includes(name) && !VALUE_MEMBERS.includes(name) && recvName && !known.has(recvName)) {
      err(obj, `'${recvName}' is not a declared solver`);
      return 'nil';
    }
    if (LINK_MEMBERS.includes(name) && recvName && !known.has(recvName)) {
      err(obj, `'${recvName}' is not a declared link`);
      return 'nil';
    }
    const r = receiverText(obj);
    switch (name) {
      case 'size': if (args) err(e, "'size' is not a method: write l.size"); return `rt.size(${ex(obj)})`;
      case 'atoms': {
        if (!args) { err(e, "'atoms' must be called: X.atoms(p/n)"); return 'nil'; }
        if (args.length !== 1 || args[0].k !== 'pred') { err(e, 'atoms takes one predicate, as in X.atoms(color/2)'); return 'nil'; }
        capture(args[0].name, args[0].arity);
        return `${r}:atoms(${luaString(args[0].name)}, ${args[0].arity})`;
      }
      case 'push': {
        if (!args) { err(e, "'push' must be called: l.push(x)"); return 'nil'; }
        const pos = positional(args, e, 'push');
        if (pos.length !== 1) err(e, 'push takes one value');
        return `rt.push(${ex(obj)}, ${pos.map((a) => ex(a)).join(', ')})`;
      }
      case 'clear': {
        if (!args || args.length) err(e, "'clear' takes no arguments: l.clear()");
        return `rt.clear(${ex(obj)})`;
      }
      case 'on': {
        const pos = args ? positional(args, e, 'on') : [];
        const L = pos[0] && (pos[0].t === 'name' ? pos[0].name : pos[0].t === 'index' && pos[0].obj.t === 'name' ? pos[0].obj.name : null);
        if (!args || pos.length !== 1 || !L || !links.has(L)) { err(e, 'on takes a link, as in C.core.on(G)'); return 'nil'; }
        use(L, 'core');
        return `${r}:on(${ex(pos[0])})`;
      }
      case 'flip': case 'without': {
        const pos = args ? positional(args, e, name) : [];
        if (!args || pos.length !== 1) { err(e, `${name} takes one atom of the list, as in E.${name}(a)`); return 'nil'; }
        return `rt.${name}(${ex(obj)}, ${ex(pos[0])})`;
      }
      case 'true': if (args) err(e, "'true' is not a method: write a.true"); return `rt.atrue(${ex(obj)})`;
      case 'cost': if (args) err(e, "'cost' is not a method: write X.cost"); return `rt.cost(${ex(obj)})`;
      case 'minimal': if (args) err(e, "'minimal' is not a method: write C.core.minimal"); minimalCore = true; return `rt.minimal(${ex(obj)})`;
      case 'value': case 'count': {
        if (!args || args.length !== 1 || args[0].k !== 'pred') { err(e, `${name} takes one predicate, as in X.${name}(gain/1)`); return 'nil'; }
        capture(args[0].name, args[0].arity);
        return `${r}:${name}(${luaString(args[0].name)}, ${args[0].arity})`;
      }
      case 'arg': {
        const pos = args ? positional(args, e, 'arg') : [];
        if (!args || pos.length !== 1) { err(e, 'arg takes a position, as in a.arg(1)'); return 'nil'; }
        return `rt.arg(${ex(obj)}, ${ex(pos[0])})`;
      }
      default:
        err(e, `unknown member '${name}'; valid for models and lists: ${VALUE_MEMBERS.join(', ')}`);
        return 'nil';
    }
  }

  function assignTarget(tok) {
    if (isDecl(tok.value)) err(tok, `'${tok.value}' is a ${solvers.has(tok.value) ? 'solver' : 'link'} and cannot be assigned`);
    checkName(tok, 'a variable');
  }

  function stmts(list, depth) { for (const s of list) stmt(s, depth); }

  function loopBody(body, depth, line) {
    const rec = { id: ++labelN, used: false };
    ctx.loops.push(rec);
    stmts(body, depth + 1);
    ctx.loops.pop();
    if (rec.used) emit(`::__continue_${rec.id}::`, null, depth + 1);
  }

  function stmt(s, depth) {
    switch (s.t) {
      case 'assign': assignTarget(s.target); emit(`${s.target.value} = ${ex(s.e)}`, s.line, depth); break;
      case 'expr': {
        const e = s.e;
        const isCall = e.t === 'method' || e.t === 'call' || (e.t === 'attr' && e.name === 'size');
        if (!isCall) err(s, 'this expression does nothing; a statement must be an assignment, a call or a command');
        let text = ex(e);
        if (text.startsWith('(')) text = ';' + text;
        emit(text, s.line, depth);
        break;
      }
      case 'if': {
        s.branches.forEach((b, i) => {
          emit(`${i === 0 ? 'if' : 'elseif'} ${ex(b.cond)} then`, b.line, depth);
          stmts(b.body, depth + 1);
        });
        if (s.orelse) { emit('else', s.orelse.line, depth); stmts(s.orelse.body, depth + 1); }
        emit('end', null, depth);
        break;
      }
      // rt.tick() on the header line: the time limit also holds in a loop without solver calls
      case 'loop': emit('while true do rt.tick()', s.line, depth); loopBody(s.body, depth, s.line); emit('end', null, depth); break;
      case 'while': emit(`while ${ex(s.cond)} do rt.tick()`, s.line, depth); loopBody(s.body, depth, s.line); emit('end', null, depth); break;
      case 'repeat': emit('repeat rt.tick()', s.line, depth); loopBody(s.body, depth, s.line); emit(`until ${ex(s.cond)}`, s.untilLine, depth); break;
      case 'for': {
        checkName(s.v, 'a loop variable');
        if (isDecl(s.v.value)) err(s.v, `'${s.v.value}' is a solver or link and cannot be a loop variable`);
        emit(`for _, ${s.v.value} in rt.each(${ex(s.iter)}) do rt.tick()`, s.line, depth);
        loopBody(s.body, depth, s.line);
        emit('end', null, depth);
        break;
      }
      case 'search': {
        const S = s.solver.value;
        if (!solvers.has(S)) err(s.solver, `'${S}' is not a declared solver`);
        const fam = (solvers.get(S) || {}).family;
        if (fam && !s.sidx) err(s.solver, `'${S}' is a solver family: write search ${S}[i]:`);
        if (!fam && s.sidx) err(s.solver, `'${S}' is not a solver family`);
        const SR = s.sidx ? `${S}[${ex(s.sidx)}]` : S;
        // a search may run inside 'on candidate' of another solver's search (phase L2)
        for (let c = ctx.cand; c; c = c.outer) if (c.solver === S) err(s, `search ${S}: solver ${S} is already searching`);
        if (ctx.cand && ctx.cand.partial) err(s, "'search' cannot stand inside 'on partial'");
        checkName(s.v, 'a candidate variable');
        if (isDecl(s.v.value)) err(s.v, `'${s.v.value}' is a solver or link and cannot be the candidate variable`);
        if (s.keep) { checkName(s.keep, 'a variable'); if (isDecl(s.keep.value)) err(s.keep, `'${s.keep.value}' is a solver or link`); }
        const opts = [];
        if (s.assume && s.assume.length) opts.push(`assume = ${s.assume.length > 1 ? `rt.concat(${s.assume.map((x) => ex(x)).join(', ')})` : ex(s.assume[0])}`);
        if (s.optimal) opts.push('optimal = true');
        if (s.keep) opts.push('keep = true');
        const head = `${s.keep ? `${s.keep.value} = ` : ''}${SR}:search{ ${opts.map((o) => o + ', ').join('')}`;
        if (s.partial) {
          // on partial P every n: (G5) a callback of its own, before on_candidate in the same table
          const P = s.partial;
          checkName(P.v, 'a candidate variable');
          if (isDecl(P.v.value)) err(P.v, `'${P.v.value}' is a solver or link and cannot be the candidate variable`);
          emit(`${head}on_partial = function(${P.v.value})`, s.line, depth);
          const sv = { cand: ctx.cand, loops: ctx.loops, def: ctx.def };
          ctx.cand = { solver: S, v: P.v.value, outer: sv.cand, partial: true };
          ctx.loops = [];
          ctx.def = null;
          const pl = new Set();
          collectAssigned(P.body, pl, { intoCandidates: false });
          for (const n of mainLocals) pl.delete(n);
          pl.delete(P.v.value);
          emit(pl.size ? `local ${[...pl].join(', ')}` : '', P.line, depth + 1);
          stmts(P.body, depth + 1);
          ctx.cand = sv.cand; ctx.loops = sv.loops; ctx.def = sv.def;
          emit(`end, ${P.every ? `every = ${ex(P.every)}, ` : ''}on_candidate = function(${s.v.value})`, s.onLine, depth);
        } else {
          emit(`${head}on_candidate = function(${s.v.value})`, s.line, depth);
        }
        const saved = { cand: ctx.cand, loops: ctx.loops };
        ctx.cand = { solver: S, v: s.v.value, outer: saved.cand };
        ctx.loops = [];
        // 'return' inside 'on candidate' would return from the callback, not from the procedure
        saved.def = ctx.def;
        ctx.def = null;
        const locals = new Set();
        collectAssigned(s.body, locals, { intoCandidates: false });
        for (const n of mainLocals) locals.delete(n);
        locals.delete(s.v.value);
        emit(locals.size ? `local ${[...locals].join(', ')}` : '', s.onLine, depth + 1);
        stmts(s.body, depth + 1);
        ctx.cand = saved.cand; ctx.loops = saved.loops; ctx.def = saved.def;
        emit('end }', null, depth);
        break;
      }
      case 'return': {
        if (!ctx.def) err(s, ctx.cand ? "'return' cannot stand inside 'on candidate'" : "'return' outside 'def'");
        emit(`do return${s.e ? ' ' + ex(s.e) : ''} end`, s.line, depth);
        break;
      }
      case 'reject': {
        if (!ctx.cand) err(s, "'reject' works only inside 'on candidate'");
        else if (s.v.value !== ctx.cand.v) err(s.v, `'reject' must name the candidate variable '${ctx.cand.v}'`);
        emit(`${s.v.value}:reject(${ex(s.e)})`, s.line, depth);
        break;
      }
      case 'accept': emit(s.label ? `rt.accept(${ex(s.e)}, ${JSON.stringify(s.label.value)})` : `rt.accept(${ex(s.e)})`, s.line, depth); break;
      case 'restart':
        if (!ctx.cand) err(s, "'restart' works only inside 'on candidate'");
        emit('rt.restart()', s.line, depth);
        break;
      case 'break':
        if (!ctx.loops.length) err(s, "'break' outside a loop");
        emit('break', s.line, depth);
        break;
      case 'continue': {
        const rec = ctx.loops.at(-1);
        if (!rec) { err(s, "'continue' outside a loop"); emit('', s.line, depth); break; }
        rec.used = true;
        emit(`goto __continue_${rec.id}`, s.line, depth);
        break;
      }
      case 'stop': emit(s.msg === null ? 'rt.stop()' : `rt.stop(${luaString(s.msg)})`, s.line, depth); break;
      case 'count': emit(`rt.count(${luaString(s.n.value)}${s.by ? ', ' + ex(s.by) : ''})`, s.line, depth); break;
      case 'track': emit(`rt.track(${luaString(s.n.value)}, ${ex(s.v)})`, s.line, depth); break;
      case 'log': emit(`rt.log(${s.args.map((a) => ex(a)).join(', ')})`, s.line, depth); break;
      default: err(s, `unsupported statement '${s.t}'`);
    }
  }

  const mainLocals = new Set();
  collectAssigned(ast.stmts, mainLocals, { intoCandidates: false });
  for (const n of mainLocals) if (isDecl(n)) mainLocals.delete(n);

  // body first (to collect captures), then splice the prepare line in front of it
  const declCount = out.length;
  // procedures (phase L4): local functions after the prepare line, before the statements
  for (const df of ast.defs || []) {
    const params = df.params.map((x) => x.value);
    emit(`local function ${df.name.value}(${params.join(', ')})`, df.line, 0);
    const locals = new Set();
    collectAssigned(df.body, locals, { intoCandidates: false });
    for (const x of params) locals.delete(x);
    if (locals.size) emit(`local ${[...locals].join(', ')}`, null, 1);
    const saved = { cand: ctx.cand, loops: ctx.loops, def: ctx.def };
    ctx.cand = null; ctx.loops = []; ctx.def = df.name.value;
    stmts(df.body, 1);
    ctx.cand = saved.cand; ctx.loops = saved.loops; ctx.def = saved.def;
    emit('end', null, 0);
  }
  stmts(ast.stmts, 0);
  const lastDeclLine = ast.decls.length ? ast.decls.at(-1).line : null;
  const prep = [...captures.map((c) => `rt.capture(${luaString(c.pred)}, ${c.arity})`), 'rt.prepare()'];
  if (mainLocals.size) prep.push(`local ${[...mainLocals].join(', ')}`);
  out.splice(declCount, 0, { text: '    ' + prep.join('; '), line: lastDeclLine });

  if (errors.length) return finishErrors(errors);
  const map = [null, ...out.map((o) => o.line)];
  return { ok: true, lua: out.map((o) => o.text).join('\n') + '\n', map, solvers: outSolvers, links: outLinks, parts, captures,
    linkUses: Object.fromEntries(Object.entries(linkUses).map(([k, v]) => [k, [...v].sort()])), minimalCore };
}

function finishErrors(errors) {
  const seen = new Set();
  const list = errors
    .filter((e) => { const k = `${e.line}:${e.col}:${e.message}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.line - b.line || a.col - b.col);
  return { ok: false, errors: list };
}
