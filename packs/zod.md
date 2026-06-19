## Code like Colin McDonnell (@colinhacks) · parse, don't validate

Colin builds schemas as immutable value objects: every schema method returns a new instance, every parse call either returns a typed value or pushes structured issues onto a mutable payload — it never throws mid-flight. His type system is structural rather than nominal: `_zod.output` and `_zod.input` are phantom slots on every object so callers get narrowed types without runtime overhead. He avoids class hierarchies in favor of a single `$constructor` factory that installs traits on instances and supports `instanceof` through a `traits` Set, keeping all three flavors of Zod (classic, mini, core) running on the same runtime shape. Errors are discriminated unions keyed on a string `code` so every branch in a `switch` narrows exhaustively without a cast. Async and sync are always separate code paths; encountering a `Promise` in a sync context throws immediately rather than silently coercing.

### `core.ts` — the `$constructor` factory: traits over inheritance
[source](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/core.ts)
```ts
export /*@__NO_SIDE_EFFECTS__*/ function $constructor<T extends ZodTrait, D = T["_zod"]["def"]>(
  name: string,
  initializer: (inst: T, def: D) => void,
  params?: { Parent?: typeof Class }
): $constructor<T, D> {
  function init(inst: T, def: D) {
    if (!inst._zod) {
      Object.defineProperty(inst, "_zod", {
        value: {
          def,
          constr: _,
          traits: new Set(),
        },
        enumerable: false,
      });
    }

    if (inst._zod.traits.has(name)) {
      return;
    }

    inst._zod.traits.add(name);

    initializer(inst, def);

    // support prototype modifications
    const proto = _.prototype;
    const keys = Object.keys(proto);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      if (!(k in inst)) {
        (inst as any)[k] = proto[k].bind(inst);
      }
    }
  }

  // doesn't work if Parent has a constructor with arguments
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {}
  Object.defineProperty(Definition, "name", { value: name });

  function _(this: any, def: D) {
    const inst = params?.Parent ? new Definition() : this;
    init(inst, def);
    inst._zod.deferred ??= [];
    for (const fn of inst._zod.deferred) {
      fn();
    }
    return inst;
  }

  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst: any) => {
      if (params?.Parent && inst instanceof params.Parent) return true;
      return inst?._zod?.traits?.has(name);
    },
  });
  Object.defineProperty(_, "name", { value: name });
  return _ as any;
```
Instead of a class hierarchy, every schema type is defined via this single factory: `init` stamps a `traits` Set onto each instance and the `initializer` callback does all the work. `instanceof` is overridden to check `traits.has(name)`, so the three Zod flavors can share runtime identity checks without sharing a prototype chain.

### `checks.ts` — a check implementation: push an issue, return, done
[source](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/checks.ts)
```ts
export const $ZodCheckLessThan: core.$constructor<$ZodCheckLessThan> = /*@__PURE__*/ core.$constructor(
  "$ZodCheckLessThan",
  (inst, def) => {
    $ZodCheck.init(inst, def);
    const origin = numericOriginMap[typeof def.value as "number" | "bigint" | "object"];

    inst._zod.onattach.push((inst) => {
      const bag = inst._zod.bag;
      const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
      if (def.value < curr) {
        if (def.inclusive) bag.maximum = def.value;
        else bag.exclusiveMaximum = def.value;
      }
    });

    inst._zod.check = (payload) => {
      if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
        return;
      }

      payload.issues.push({
        origin,
        code: "too_big",
        maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
        input: payload.value,
        inclusive: def.inclusive,
        inst,
        continue: !def.abort,
      });
    };
  }
);
```
The check function either returns immediately (fast path on success) or pushes a structured issue literal onto `payload.issues` — never throws. `onattach` hooks update the schema's metadata `bag` when the check is wired to a schema, keeping bag-level summary state (e.g. `maximum`) always current without a second pass.

### `schemas.ts` — the type-check function shape: one branch per outcome
[source](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/schemas.ts)
```ts
export const $ZodString: core.$constructor<$ZodString> = /*@__PURE__*/ core.$constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = [...(inst?._zod.bag?.patterns ?? [])].pop() ?? regexes.string(inst._zod.bag);
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_) {}

    if (typeof payload.value === "string") return payload;

    payload.issues.push({
      expected: "string",
      code: "invalid_type",

      input: payload.value,
      inst,
    });
    return payload;
  };
});
```
Every primitive parser follows this pattern: try a coercion if configured, then a single type guard that returns `payload` on success, else push one issue literal and return. The payload is always returned — never thrown — so the caller controls abort logic.

### `registries.ts` — a stateful module: `WeakMap` keyed by schema identity, metadata inherited via parent chain
[source](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/registries.ts)
```ts
export class $ZodRegistry<Meta extends MetadataType = MetadataType, Schema extends $ZodType = $ZodType> {
  _meta!: Meta;
  _schema!: Schema;
  _map: WeakMap<Schema, $replace<Meta, Schema>> = new WeakMap();
  _idmap: Map<string, Schema> = new Map();

  add<S extends Schema>(
    schema: S,
    ..._meta: undefined extends Meta ? [$replace<Meta, S>?] : [$replace<Meta, S>]
  ): this {
    const meta: any = _meta[0];
    this._map.set(schema, meta!);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.set(meta.id!, schema);
    }
    return this as any;
  }

  clear(): this {
    this._map = new WeakMap();
    this._idmap = new Map();
    return this;
  }

  remove(schema: Schema): this {
    const meta: any = this._map.get(schema);
    if (meta && typeof meta === "object" && "id" in meta) {
      this._idmap.delete(meta.id!);
    }
    this._map.delete(schema);
    return this;
  }

  get<S extends Schema>(schema: S): $replace<Meta, S> | undefined {
    // return this._map.get(schema) as any;

    // inherit metadata
    const p = schema._zod.parent as Schema;
    if (p) {
      const pm: any = { ...(this.get(p) ?? {}) };
      delete pm.id; // do not inherit id
      const f = { ...pm, ...this._map.get(schema) } as any;
      return Object.keys(f).length ? f : undefined;
    }
    return this._map.get(schema) as any;
  }

  has(schema: Schema): boolean {
    return this._map.has(schema);
  }
}
```
`WeakMap` keyed by schema object lets the registry hold metadata without preventing GC. The `get` method silently merges parent metadata so cloned schemas inherit description and title without re-registering — `id` is explicitly stripped so clones never share the same JSON Schema `$defs` key.

### `util.ts` — a characteristic utility: lazy property with cycle detection via a sentinel symbol
[source](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/util.ts)
```ts
const EVALUATING = /* @__PURE__*/ Symbol("evaluating");

export function defineLazy<T, K extends keyof T>(object: T, key: K, getter: () => T[K]): void {
  let value: T[K] | typeof EVALUATING | undefined = undefined;
  Object.defineProperty(object, key, {
    get() {
      if (value === EVALUATING) {
        // Circular reference detected, return undefined to break the cycle
        return undefined as T[K];
      }
      if (value === undefined) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object, key, {
        value: v,
        // configurable: true,
      });
      // object[key] = v;
    },
    configurable: true,
  });
}
```
A private `Symbol` acts as a sentinel to break recursive access during initialization instead of blowing the stack. The `set` trap replaces the getter descriptor with a plain data descriptor on first write, eliminating the getter overhead for future accesses.

### `regexes.ts` — naming and module layout: one export per format, functions where parameterization is needed
[source](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/core/regexes.ts)
```ts
export const cuid: RegExp = /^[cC][0-9a-z]{6,}$/;
export const cuid2: RegExp = /^[0-9a-z]+$/;
export const ulid: RegExp = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
export const xid: RegExp = /^[0-9a-vA-V]{20}$/;
export const ksuid: RegExp = /^[A-Za-z0-9]{27}$/;
export const nanoid: RegExp = /^[a-zA-Z0-9_-]{21}$/;

/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
export const duration: RegExp =
  /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;

/** Implements ISO 8601-2 extensions like explicit +- prefixes, mixing weeks with other units, and fractional/negative components. */
export const extendedDuration: RegExp =
  /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;

/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
export const guid: RegExp = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

/** Returns a regex for validating an RFC 9562/4122 UUID.
 *
 * @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
export const uuid = (version?: number | undefined): RegExp => {
  if (!version)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(
    `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`
  );
};
export const uuid4: RegExp = /*@__PURE__*/ uuid(4);
export const uuid6: RegExp = /*@__PURE__*/ uuid(6);
export const uuid7: RegExp = /*@__PURE__*/ uuid(7);
```
Format constants are named after their format, typed as `RegExp`, and documented with JSDoc linking to the spec. Where a regex varies by parameter (UUID version, datetime precision) he uses a plain function that returns a `RegExp`; the common versions are pre-computed as named constants (`uuid4`, `uuid6`, `uuid7`) to avoid redundant allocation.

### `classic/tests/error.test.ts` — test shape: `safeParse` returns a tagged result, errors pinned with inline snapshots
[source](https://github.com/colinhacks/zod/blob/912f0f51b0ced654d0069741e7160834dca742ee/packages/zod/src/v4/classic/tests/error.test.ts)
```ts
test("array minimum", () => {
  let result = z.array(z.string()).min(3, "tooshort").safeParse(["asdf", "qwer"]);
  expect(result.success).toBe(false);
  expect(result.error!.issues[0].code).toEqual("too_small");
  expect(result.error!.issues[0].message).toEqual("tooshort");

  result = z.array(z.string()).min(3).safeParse(["asdf", "qwer"]);
  expect(result.success).toBe(false);
  expect(result.error!.issues[0].code).toEqual("too_small");
  expect(result.error).toMatchInlineSnapshot(`
    [ZodError: [
      {
        "origin": "array",
        "code": "too_small",
        "minimum": 3,
        "inclusive": true,
        "path": [],
        "message": "Too small: expected array to have >=3 items"
      }
    ]]
  `);
});

test("literal bigint default error message", () => {
  const result = z.literal(BigInt(12)).safeParse(BigInt(13));
  expect(result.success).toBe(false);
  expect(result.error!.issues.length).toEqual(1);
  expect(result.error).toMatchInlineSnapshot(`
    [ZodError: [
      {
        "code": "invalid_value",
        "values": [
          "12"
        ],
        "path": [],
        "message": "Invalid input: expected 12n"
      }
    ]]
  `);
});
```
Tests call `safeParse` (never `parse`) so there's no try/catch noise; the `result.success` branch narrows the type. `toMatchInlineSnapshot` pins the full serialized `ZodError` — `code`, `path`, and `message` — so regressions in any field of the discriminated union surface immediately without separate assertions for each field.
