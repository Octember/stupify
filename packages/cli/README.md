# @stupify/cli

Local-only diagnostic CLI for checking whether AI is making you dumber.

This package is a structure-only foundation. The diagnostic engine is not
implemented yet.

```sh
npx @stupify/cli
```

The package is prepared for the public `@stupify` npm scope. Publishing should
run the TypeScript build first so the executable points at `dist/stupify.js`.
