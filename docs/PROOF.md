# stupify in the wild

Slop is the code that compiles fine, passes a human skim, and quietly rots: a primitive reinvented, a helper
inlined, a config seam that does nothing. A linter cannot see it because nothing is technically wrong. Here is
stupify catching it on real PRs, each finding naming the corpus primitive to use instead.

---

### It knows the library already does this

![stupify flags a second abort race hand-built around the AWS SDK's own cancellation, which also races wrong and bails while S3 cleanup is still running.](proof/slop-sdk.png)

A second abort race hand-built around the AWS SDK's own cancellation. The reinvention also races wrong: the task
bails to failure handling while S3 cleanup is still in flight. Taste and a real bug in one finding.

---

### It spots a hand-rolled state machine

![stupify flags a WriteStream plus three boolean flags doing what fluent-ffmpeg's .output(path) already does in the same file.](proof/slop-statemachine.png)

A `WriteStream` and three boolean flags to do what `.output(path)` already does, in the same file. Bigger, with
more ways to get the finish ordering wrong, for no new behavior.

---

### It catches the config seam that does nothing

![stupify flags a 'required' flag that is accepted and rendered but ignored by validation, so it cannot change behavior.](proof/slop-seam.png)

`required` is accepted and rendered into the prompt, but validation ignores it. It looks meaningful; it cannot
change behavior. Most reviewers skim right past it.

---

### It pushes for states that can't go wrong

![stupify flags two parallel nullable fields that let the schema hold an impossible half-link, and asks for one object so the bad state is unrepresentable.](proof/slop-types.png)

Two parallel nullable fields let the schema hold an impossible half-link. One nullable object makes the malformed
state impossible to write in the first place.

---

### And it stops when the work is done

![stupify posts 'no new blocking issues, prior items addressed' with a checkmark.](proof/04-converge.png)

The whole PR thread is its memory, so once the findings are addressed it posts one line and goes quiet. The
opposite of a bot that re-nags on every push.
