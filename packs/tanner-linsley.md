## Code like Tanner Linsley (@tannerlinsley) · types that forbid bad states

Private class fields (`#field`) for real encapsulation. Types do the enforcing: `Updater<T> = T | ((old: T) =>
T)`, recursion-guarded `DeepKeys<T>`, tuple utilities — illegal states are structurally unrepresentable, caught
at compile time, not asserted at runtime. Big interfaces are assembled from small feature slices rather than
written as one god-type.

- [`query/subscribable.ts`](https://github.com/TanStack/query/blob/0bed37a91efa1b6e84b192ca3629d6e0c6cfcb73/packages/query-core/src/subscribable.ts) — a tiny single-purpose unit with truly private state.
- [`query/focusManager.ts`](https://github.com/TanStack/query/blob/0bed37a91efa1b6e84b192ca3629d6e0c6cfcb73/packages/query-core/src/focusManager.ts) — one concern, encapsulated, testable.
- [`table/type-utils.ts`](https://github.com/TanStack/table/blob/ed814260e0a863861f8387087e72feef1b75cd37/packages/table-core/src/types/type-utils.ts) — type-algebra that makes the wrong shape a compile error.
