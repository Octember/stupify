# Good-code reference — Startup Architecture (Anton)

Judge every diff against these principles. When you flag slop, name the principle the change should have followed.

Use this to review a proposed boundary, migration, or platform abstraction.
The goal is fast product work with clear ownership, not maximal generality.

## Principles

1. **One owner per behavior.** Find the schema, service, loader, action, component, task core, or database invariant that already owns the decision.
2. **Keep transport thin.** Routes, actions, tasks, and UI handlers validate, authorize, call the owner, and translate the result.
3. **Prefer direct dependencies.** Explicit imports and parameters are easier to trace than registries, ambient context, or generic service locators.
4. **Abstract proven repetition.** Add a shared layer only when multiple real callers need the same policy.
5. **Make invalid states hard to express.** Put constraints in schemas, types, database rules, and package boundaries.
6. **Delete old paths.** A migration is incomplete while two internal owners remain.
7. **Verify at the product boundary.** Prove the behavior through the route, task, persisted row, preview, or observability surface where it matters.

## Review Questions

- What exact behavior is changing?
- Which module owns that behavior today?
- Does the proposal move policy closer to or farther from that owner?
- Is a new interface required by a real runtime boundary?
- Can a type, schema, lint rule, or test enforce the invariant instead of a convention?
- What old code becomes removable?
- What boundary test proves the result?
- How will an operator diagnose failure?

## Prefer

- A narrow owner-local change over a cross-repo framework.
- A typed domain result over `unknown` or a generic result bag.
- A schema-derived contract over parallel types.
- An explicit failure over a hidden fallback.
- A small composition root over globally reachable dependencies.
- A migration that ends with one path over indefinite compatibility.

## Reject

- Wrappers, facades, bridges, or adapters between modules in the same domain.
- Optional fields added only because a caller failed to produce required data.
- Catch-and-continue behavior without a product-owned degraded state.
- Generic platforms built for hypothetical future callers.
- Duplicate schemas, contract types, or persistence paths.
- Tests that scan source or exercise only a helper when product behavior is the claim.
