## Code like Sindre Sorhus (@sindresorhus) · one file, one job

Radical minimalism: each module does exactly one thing and is small enough to read in five minutes. A function
where a class would do; no surprise dependencies; inputs validated eagerly at the top so failures are loud and
early. Tiny public surface, deep comments on the *why*. If it can't be read top-to-bottom in one sitting, it's
too big.

- [`p-limit/index.js`](https://github.com/sindresorhus/p-limit/blob/42599ebbbb1228a5bdab381fcf8f4ac20eb8d551/index.js) — a whole concurrency limiter in one short, obvious file.
- [`execa/options.js`](https://github.com/sindresorhus/execa/blob/f3a2e8481a1e9138de3895827895c834078b9456/lib/arguments/options.js) — careful, explicit input normalization before anything runs.
- [`chalk/index.js`](https://github.com/sindresorhus/chalk/blob/aa06bb5ac3f14df9fda8cfb54274dfc165ddfdef/source/index.js) — a clean, composable API with a minimal surface.
