"""The Python twin of lua/draw.lua: the same draws from the same (seed, attempt, name, key), and
a generator runner on Python clingo (docs/spec-instances.md section 4).

    from draw import Draws, generate
    Draws(seed, attempt).flip(300, 1, 2)
    generate(text, {"n": 7, "p": 300}, seed) -> {"facts", "seed", "attempt", "exact"}

Keys are compared as text: an integer key k reads str(k), a term key is its clingo text
("voter(1)"). Arithmetic is on 64-bit masks, as Lua 5.4 integers wrap.
"""
M = (1 << 64) - 1


def _mix(z):
    z &= M
    z = ((z ^ (z >> 30)) * 0xbf58476d1ce4e5b9) & M
    z = ((z ^ (z >> 27)) * 0x94d049bb133111eb) & M
    return z ^ (z >> 31)


def _hash_str(h, s):
    for b in s.encode():
        h = _mix(h ^ b)
    return h


class DrawError(Exception):
    pass


class Draws:
    def __init__(self, seed=0, attempt=0):
        self.seed, self.attempt, self._perms, self._rank = seed, attempt, {}, {}

    def _key(self, name, keys):
        return "|".join([name] + [str(k) for k in keys])

    def draw(self, r, name, keys):
        if r < 1:
            raise DrawError(f"{name}: the range must be a positive integer")
        h = _mix((self.seed * 0x9e3779b97f4a7c15 + self.attempt) & M)
        h = _hash_str(h, name)
        for i, k in enumerate(keys, 1):
            h = _hash_str(_mix((h + i) & M), str(k))
        return (_mix(h) >> 11) % r

    def flip(self, p, *keys):
        return 1 if self.draw(1000, "flip", keys) < p else 0

    def int(self, lo, hi, *keys):
        if hi < lo:
            raise DrawError(f"int: empty range {lo}..{hi}")
        return lo + self.draw(hi - lo + 1, "int", keys)

    def weighted(self, ws, *keys):
        t = self.draw(sum(ws), "weighted", keys)
        for i, w in enumerate(ws, 1):
            if t < w:
                return i
            t -= w

    def _perm(self, n, keys):
        ident = self._key(f"perm{n}", keys)
        if ident not in self._perms:
            p = list(range(1, n + 1))
            for j in range(n, 1, -1):
                r = self.draw(j, "perm", (n, j) + tuple(keys))
                p[j - 1], p[r] = p[r], p[j - 1]
            self._perms[ident] = p
        return self._perms[ident]

    def perm(self, n, i, *keys):
        return self._perm(n, keys)[i - 1]

    def subset(self, m, n, i, *keys):
        return 1 if self._perm(n, keys)[i - 1] <= m else 0

    def mallows(self, n, phi, i, *keys):
        ident = self._key(f"mallows{n}/{phi}", keys)
        if ident not in self._rank:
            order = []
            for k in range(1, n + 1):
                w, x = [0] * (k + 1), 1 << 30
                for j in range(k, 0, -1):
                    w[j] = x
                    x = x * phi // 1000
                t, place = self.draw(sum(w), "mallows", (n, phi, k) + tuple(keys)), k
                for j in range(1, k + 1):
                    if t < w[j]:
                        place = j
                        break
                    t -= w[j]
                order.insert(place - 1, k)
            self._rank[ident] = {item: p for p, item in enumerate(order, 1)}
        return self._rank[ident][i]


class _Context:
    """The grounding context of one attempt: @flip(P, K...) etc. on clingo symbols."""

    def __init__(self, seed, attempt):
        self.d = Draws(seed, attempt)
        self.error = None

    def _call(self, name, f):
        import clingo
        try:
            return clingo.Number(f())
        except Exception as e:  # a bad argument: 0 and an error, as in lua/draw.lua
            if self.error is None:
                self.error = f"@{name}: {e}"
            return clingo.Number(0)

    @staticmethod
    def _n(s):
        import clingo
        if s.type != clingo.SymbolType.Number:
            raise DrawError(f"must be an integer, got {s}")
        return s.number

    def flip(self, p, *k): return self._call("flip", lambda: self.d.flip(self._n(p), *k))
    def int(self, lo, hi, *k): return self._call("int", lambda: self.d.int(self._n(lo), self._n(hi), *k))
    def weighted(self, ws, *k): return self._call("weighted", lambda: self.d.weighted([self._n(a) for a in ws.arguments], *k))
    def perm(self, n, i, *k): return self._call("perm", lambda: self.d.perm(self._n(n), self._n(i), *k))
    def subset(self, m, n, i, *k): return self._call("subset", lambda: self.d.subset(self._n(m), self._n(n), self._n(i), *k))
    def mallows(self, n, phi, i, *k): return self._call("mallows", lambda: self.d.mallows(self._n(n), self._n(phi), self._n(i), *k))


def generate(text, params, seed, attempts=100):
    """The first accepted attempt of a generator, as lua/generate.lua: facts sorted as text."""
    import clingo
    for attempt in range(attempts):
        args = [x for k, v in params.items() for x in ("-c", f"{k}={v}")]
        ctl = clingo.Control(args, logger=lambda c, m: None)
        ctl.add("base", [], text)
        ctx = _Context(seed, attempt)
        ctl.ground([("base", [])], context=ctx)
        if ctx.error:
            raise DrawError(ctx.error)
        models = []
        with ctl.solve(yield_=True) as h:
            for m in h:
                models.append(sorted(str(s) + "." for s in m.symbols(shown=True)))
                if len(models) == 2:
                    break
        if models:
            return {"facts": " ".join(models[0]), "seed": seed, "attempt": attempt, "exact": len(models) == 1}
    raise DrawError(f"no accepted draw in {attempts} attempts")
