# stupif.ai

Local-only diagnostic tooling for checking whether AI is making developers
dumber.

This repository is currently a structure-only foundation. The diagnostic engine
is not implemented yet.

## CLI

Planned package:

```sh
npx @stupify/cli
```

Current local smoke test:

```sh
bun run smoke:cli
```

## Product framing

Stupify checks recent code changes for signs of judgment offload, autocomplete
dependence, and AI-flavored slop acceptance.

Your code stays on your machine.
