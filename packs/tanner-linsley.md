## Code like Tanner Linsley (@tannerlinsley) · types that forbid bad states

Every observable quantity that can only be in one of several mutually-exclusive states is modelled as a discriminated union, not a bag of optional booleans. Each action a state machine can take carries only the fields that action needs — no excess, no shared mutable bags. The type system is the enforcer: if a combination of fields is impossible at runtime, it is structurally unrepresentable at compile time. Recursive type algebra (`DeepKeys`, `DeepValue`) computes valid paths at the type level so a typo in a column accessor is a build error, not a runtime mystery.

### `types.ts` — discriminated observer results: each status variant locks its fields
[source](https://github.com/TanStack/query/blob/0bed37a91efa1b6e84b192ca3629d6e0c6cfcb73/packages/query-core/src/types.ts)
```ts
export interface QueryObserverSuccessResult<
  TData = unknown,
  TError = DefaultError,
> extends QueryObserverBaseResult<TData, TError> {
  data: TData
  error: null
  isError: false
  isPending: false
  isLoading: false
  isLoadingError: false
  isRefetchError: false
  isSuccess: true
  isPlaceholderData: false
  status: 'success'
}
```
When `status` is `'success'`, every other flag is pinned by the type: `data` is `TData` (never `TData | undefined`), `error` is `null`, and `isError`/`isPending`/`isLoading` are all `false` while `isSuccess` is `true`. There is no way to construct `{ isSuccess: true, isError: true }` or `{ status: 'success', data: undefined }`. The sibling result interfaces (`QueryObserverPendingResult`, `QueryObserverLoadingErrorResult`) lock the opposite combinations, so the wrong shape simply does not type-check — the discriminant narrows `data`, not a runtime assertion.

### `query.ts` — per-action interfaces: each transition carries only what it needs
[source](https://github.com/TanStack/query/blob/0bed37a91efa1b6e84b192ca3629d6e0c6cfcb73/packages/query-core/src/query.ts)
```ts
interface FailedAction<TError> {
  type: 'failed'
  failureCount: number
  error: TError
}

interface FetchAction {
  type: 'fetch'
  meta?: FetchMeta
}

interface SuccessAction<TData> {
  data: TData | undefined
  type: 'success'
  dataUpdatedAt?: number
  manual?: boolean
}

interface ErrorAction<TError> {
  type: 'error'
  error: TError
}

interface InvalidateAction {
  type: 'invalidate'
}

interface PauseAction {
  type: 'pause'
}

interface ContinueAction {
  type: 'continue'
}

interface SetStateAction<TData, TError> {
  type: 'setState'
  state: Partial<QueryState<TData, TError>>
}

export type Action<TData, TError> =
  | ContinueAction
  | ErrorAction<TError>
  | FailedAction<TError>
  | FetchAction
  | InvalidateAction
  | PauseAction
  | SetStateAction<TData, TError>
  | SuccessAction<TData>
```
No shared action shape, no optional `error?: TError` that might be set on a success — each transition is its own interface with only the payload that transition owns. The private `#dispatch` reducer then does an exhaustive `switch (action.type)` so the compiler catches any unhandled transition at build time, not at the support desk.

### `type-utils.ts` — `DeepKeys<T>`: valid dot-paths computed at compile time
[source](https://github.com/TanStack/table/blob/ed814260e0a863861f8387087e72feef1b75cd37/packages/table-core/src/types/type-utils.ts)
```ts
export type DeepKeys<
  T,
  TDepth extends Array<any> = [],
> = TDepth['length'] extends 5
  ? never
  : unknown extends T
    ? string
    : T extends ReadonlyArray<any> & IsTuple<T>
      ? AllowedIndexes<T> | DeepKeysPrefix<T, AllowedIndexes<T>, TDepth>
      : T extends Array<any>
        ? DeepKeys<T[number], [...TDepth, any]>
        : T extends Date
          ? never
          : T extends object
            ? (keyof T & string) | DeepKeysPrefix<T, keyof T, TDepth>
            : never

type DeepKeysPrefix<
  T,
  TPrefix,
  TDepth extends Array<any>,
> = TPrefix extends keyof T & (number | string)
  ? `${TPrefix}.${DeepKeys<T[TPrefix], [...TDepth, any]> & string}`
  : never

export type DeepValue<T, TProp> =
  T extends Record<string | number, any>
    ? TProp extends `${infer TBranch}.${infer TDeepProp}`
      ? DeepValue<T[TBranch], TDeepProp>
      : T[TProp & string]
    : never
```
A column accessor key like `"address.city"` is only valid if `T` actually has an `address` property with a `city` sub-property — enforced here with template-literal recursion capped at depth 5 (via `TDepth['length']`) to avoid infinite expansion. `DeepValue<T, K>` then resolves the type at that path, so the cell renderer is typed to the right leaf, not `unknown`.
