# stupify in the wild

These are verbatim reviews from one real PR thread. The PR added a billing-critical feature: a free-trial
export watermark and a 720p cap. stupify reviewed it from the first push to the last, the author fixed what it
found, and it stopped once the work was done.

---

### 1 · It catches real bugs

![stupify's review: four findings, worst first. A feature flag sits in the schema but nothing reads it on the client (conf 0.98). A server path fails open to a full-res render. A reuse path returns the wrong file. Two exports can race. Each finding names the fix.](proof/01-catch.png)

Four findings, worst first. A feature flag reached the schema but nothing read it on the client, so trial users
would get clean exports instead of watermarked ones. A server path failed open to a full-res render. A reuse
path handed back the wrong file. Two exports could race. Each finding names the corpus primitive to use for the
fix.

---

### 2 · The author fixes them

![The PR author replies that all four findings are addressed, with a short explanation of each fix.](proof/02-addressed.png)

All four, addressed.

---

### 3 · It catches the incomplete fix

![stupify re-reviews the fix and flags two that remain: the reuse path is still blind to runtime settings (conf 0.94), and an error branch defaults to a clean treatment.](proof/03-caught.png)

This is the part most AI reviewers miss. stupify re-reads the fix and sees that the reuse path is still blind to
runtime settings (conf 0.94). It tracks each finding across pushes until the code is right.

---

### 4 · It stops when the work is done

![stupify posts "no new blocking issues — prior items addressed" with a checkmark.](proof/04-converge.png)

Once the findings are addressed, stupify posts one line and stops. The whole PR thread is its memory, so each new
review covers only what changed. Most teams mute review bots because the bots never shut up. This one does.
