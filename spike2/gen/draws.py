"""The Python twin of draws.lua: the same draws from the same (seed, attempt, name, key)."""
M = (1 << 64) - 1
def _mix(z):
    z &= M
    z = ((z ^ (z >> 30)) * 0xbf58476d1ce4e5b9) & M
    z = ((z ^ (z >> 27)) * 0x94d049bb133111eb) & M
    return z ^ (z >> 31)
def _hash_str(h, s):
    for b in s.encode(): h = _mix(h ^ b)
    return h
class Draws:
    def __init__(self, seed=0, attempt=0):
        self.seed, self.attempt, self._perms, self._rank = seed, attempt, {}, {}
    def _key(self, name, keys):
        return "|".join([name, str(self.seed), str(self.attempt)] + [str(k) for k in keys])
    def draw(self, r, name, keys):
        h = _mix((self.seed * 0x9e3779b97f4a7c15 + self.attempt) & M)
        h = _hash_str(h, name)
        for i, k in enumerate(keys, 1): h = _hash_str(_mix((h + i) & M), str(k))
        return (_mix(h) >> 11) % r
    def flip(self, p, *keys): return 1 if self.draw(1000, "flip", keys) < p else 0
    def int(self, lo, hi, *keys): return lo + self.draw(hi - lo + 1, "int", keys)
    def weighted(self, ws, *keys):
        t = self.draw(sum(ws), "weighted", keys)
        for i, w in enumerate(ws, 1):
            if t < w: return i
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
    def perm(self, n, i, *keys): return self._perm(n, keys)[i - 1]
    def subset(self, m, n, i, *keys): return 1 if self._perm(n, keys)[i - 1] <= m else 0
    def mallows(self, n, phi, i, *keys):
        ident = self._key(f"mallows{n}/{phi}", keys)
        if ident not in self._rank:
            order = []
            for k in range(1, n + 1):
                w, x = [0] * (k + 1), 1 << 30
                for j in range(k, 0, -1):
                    w[j] = x; x = x * phi // 1000
                t, place = self.draw(sum(w), "mallows", (n, phi, k) + tuple(keys)), k
                for j in range(1, k + 1):
                    if t < w[j]: place = j; break
                    t -= w[j]
                order.insert(place - 1, k)
            self._rank[ident] = {item: p for p, item in enumerate(order, 1)}
        return self._rank[ident][i]
