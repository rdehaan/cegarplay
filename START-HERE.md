# Handing this to Claude Code

1. Unzip this folder where you want the repository to live, and open a
   terminal in it. You need Node 22 or newer, Python 3 and git; the browser
   tests install Playwright's Chromium on first use.
2. Start Claude Code in this folder with the model you want.
3. First message:

       Read PLAN.md and implement it, starting with phase 1.

4. At each checkpoint Claude Code stops with a line starting `CHECKPOINT`.
   Run `/clear`, then say:

       Continue with PLAN.md.

   `CLAUDE.md` is loaded automatically in the fresh context and points to
   `PROGRESS.md`, so nothing else needs repeating.
5. To run without stopping, say in the first message "do not stop at
   checkpoints". Claude Code then relies on automatic compaction, and
   `PROGRESS.md` keeps the state safe.

Phases 1 to 3 are logic tested in Node, phases 4 and 5 build the page, phase 6
(pause, step, threads) is optional. You can delete this file afterwards.
