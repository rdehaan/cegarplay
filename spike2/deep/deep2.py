from deep import *
random.seed(77)
for depth, want in ((4, 25), (5, 20)):
    bad = 0; done = 0; t0 = time.time(); tot = [0] * (depth - 1); tried = 0
    while done < want:
        tried += 1
        sizes = [random.randint(2, 3) for _ in range(depth)]
        blocks, v = [], 1
        for s in sizes: blocks.append(list(range(v, v + s))); v += s
        nv = v - 1
        # clauses lean on the outer blocks when the last block is universal, so that some formulas are true
        def pick():
            b = random.choice(range(depth)) if depth % 2 else min(random.choice(range(depth)), random.choice(range(depth)))
            return random.choice(blocks[b])
        clauses = [[(pick(), random.randint(0, 1)) for _ in range(3)] for _ in range(random.randint(3, 3 + depth))]
        bf = brute(blocks, clauses)
        if not (0 < len(bf) < 2 ** sizes[0]): continue
        done += 1
        sols, ok, calls, r = run(project(blocks, clauses))
        if calls: tot = [a + int(b) for a, b in zip(tot, calls.split())]
        if sols != bf or not ok:
            bad += 1
            if bad <= 2: print("MISMATCH depth", depth, blocks, clauses, sorted(map(sorted, sols)), sorted(map(sorted, bf)), (r.stdout + r.stderr)[-260:])
    print(f"depth {depth}: {want} non-trivial formulas (from {tried} drawn), mismatches {bad}, solves per level 2..{depth}: {tot}, {time.time() - t0:.0f} s")
