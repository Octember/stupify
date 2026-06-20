# stupify in the wild

Real reviews, verbatim from a real PR thread — one billing-critical feature (free-trial export watermark + 720p
cap), reviewed end to end. Worst-first findings, a human acting on them, and the judgment to stop when it's done.

---

### 1 · It catches real, high-stakes bugs

![stupify's review: four worst-first findings — a feature flag wired into the schema but never read client-side (conf 0.98), a server path that fails open to a clean full-res render, a reuse path that returns the wrong file, and a double-submit race — each naming the fix to apply](proof/01-catch.png)

A feature flag wired into the schema but never read client-side — so trial users would get clean exports, a
revenue leak — plus a server seam that fails *open* to a full-res render, a reuse path that hands back the wrong
file, and a double-submit race. Four findings, each naming the corpus primitive to reuse.

---

### 2 · The engineer acts on it

![the PR author replies that all four findings are addressed, with a per-finding explanation of each fix](proof/02-addressed.png)

All four, addressed.

---

### 3 · …and it catches the *incomplete* fix

![stupify re-reviews the fix and flags two remaining sharp edges — the reuse path is still blind to runtime settings (conf 0.94) and an error branch defaults to a clean treatment](proof/03-caught.png)

The part most AI reviewers miss. It re-reads the fix and catches that the reuse path is **still** blind to runtime
settings (conf 0.94). It's not a rubber stamp — it tracks the fix across pushes until it's actually right.

---

### 4 · It knows when to stop

![stupify posts 'no new blocking issues — prior items addressed' with a checkmark](proof/04-converge.png)

Once everything's addressed, it converges — instead of nagging. The whole thread is its memory, so the Nth review
only covers the delta. The #1 reason teams mute review bots is noise; this is the opposite.
