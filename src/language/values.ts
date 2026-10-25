/**
 * The built-in `==` and map keys (§3.8, §3.9), written once for every representation of values:
 * the runtime's (definition/equality.ts) and compile time's constant forms (checker/constant-form.ts).
 * A representation shows its values through a `ValueView`; the rules live here alone, so compile
 * time and run time can't disagree on them.
 *
 * - Primitives compare as JavaScript's `===` does, so a float NaN equals nothing (IEEE 754) and
 *   `0.0 == -0.0`. A composite compares its head (kind, type, variant, function or object), then
 *   its parts in order; a map compares by its entries, whose order is no part of its value.
 * - A map finds a key through a hash of the key's structure (`structuralKey`), confirmed with
 *   `==`, so a lookup agrees with `==` exactly: a key holding a NaN is stored but never found
 *   again. A map's hash table is derived from it once and kept beside it, keyed by the map itself,
 *   which never changes; a map built from another by setting one key takes the other's table over,
 *   so building a map key by key never hashes a key twice.
 * - Setting a key a map holds keeps its place; a new key goes last. So a map literal's later entry
 *   for an equal key replaces the earlier one's value, where the earlier one stood.
 * - Every walk keeps its own stack, so a value of any depth compares and hashes without exhausting
 *   JavaScript's; only a map key's lookup inside `==` nests on it, as deep as maps keyed by maps
 *   nest (D100).
 */

export type Primitive = null | boolean | string | bigint | number;

/** A map as every representation holds it: entries in the order their keys were first set. */
export interface MapOf<Value> {
  readonly kind: 'map';
  readonly entries: readonly (readonly [Value, Value])[];
}

/** What `==` sees of a value: a primitive, a map, or a composite's parts. */
export type Shape<Value> =
  | { readonly kind: 'primitive'; readonly value: Primitive }
  | { readonly kind: 'map'; readonly map: MapOf<Value> }
  | { readonly kind: 'composite'; readonly parts: readonly Value[] };

/** How one representation shows its values to `==`. */
export interface ValueView<Value> {
  readonly shapeOf: (value: Value) => Shape<Value>;
  /** Whether two composites agree on everything but their parts. */
  readonly sameHead: (first: Value, second: Value) => boolean;
  /** A composite's head as text: heads `sameHead` calls equal give the same text. */
  readonly headKey: (value: Value) => string;
}

/**
 * `==` and maps over the representation a `ValueView` shows. Its operations are bound to it, so
 * a representation can export them by name.
 */
export class ValueSemantics<Value> {
  readonly #view: ValueView<Value>;
  readonly #tables = new WeakMap<MapOf<Value>, ReadonlyMap<string, readonly number[]>>();

  constructor(view: ValueView<Value>) {
    this.#view = view;
  }

  readonly equal = (first: Value, second: Value): boolean => {
    const pending: (readonly [Value, Value])[] = [[first, second]];
    for (let pair = pending.pop(); pair !== undefined; pair = pending.pop()) {
      if (!this.#agreeAtTop(pair[0], pair[1], pending)) {
        return false;
      }
    }
    return true;
  };

  /** The position of `key`'s entry in `map`; undefined when `map` has no such key. */
  readonly entryPosition = (map: MapOf<Value>, key: Value): number | undefined => {
    const candidates = this.#tableOf(map).get(structuralKey(this.#view, key)) ?? [];
    return candidates.find((position) => {
      const entry = map.entries[position];
      return entry !== undefined && this.equal(entry[0], key);
    });
  };

  /** The value `map` holds for `key`; undefined when it holds none. */
  readonly entryValue = (map: MapOf<Value>, key: Value): Value | undefined => {
    const position = this.entryPosition(map, key);
    return position === undefined ? undefined : map.entries[position]?.[1];
  };

  /** `map` with `key` set to `value`: a key it holds keeps its place, a new one goes last. */
  readonly withEntry = (map: MapOf<Value>, key: Value, value: Value): MapOf<Value> => {
    const position = this.entryPosition(map, key);
    const entry = [key, value] as const;
    const next: MapOf<Value> = {
      kind: 'map',
      entries: position === undefined ? [...map.entries, entry] : map.entries.with(position, entry),
    };
    this.#carryTable(map, next, key);
    return next;
  };

  /** `map` without `key`'s entry. */
  readonly withoutEntry = (map: MapOf<Value>, key: Value): MapOf<Value> => {
    const position = this.entryPosition(map, key);
    return position === undefined
      ? map
      : { kind: 'map', entries: map.entries.toSpliced(position, 1) };
  };

  /** A map of `entries` in order, a later entry of an equal key replacing the earlier's value. */
  readonly mapOf = (entries: readonly (readonly [Value, Value])[]): MapOf<Value> =>
    entries.reduce<MapOf<Value>>((map, [key, value]) => this.withEntry(map, key, value), {
      kind: 'map',
      entries: [],
    });

  /** Whether `left` and `right` agree but for their parts, whose pairs go onto `pending`. */
  #agreeAtTop(left: Value, right: Value, pending: (readonly [Value, Value])[]): boolean {
    const [one, other] = [this.#view.shapeOf(left), this.#view.shapeOf(right)];
    if (one.kind === 'primitive' || other.kind === 'primitive') {
      return one.kind === 'primitive' && other.kind === 'primitive' && one.value === other.value;
    }
    if (one.kind === 'map' || other.kind === 'map') {
      return (
        one.kind === 'map' && other.kind === 'map' && this.#sameKeys(one.map, other.map, pending)
      );
    }
    if (!this.#view.sameHead(left, right) || one.parts.length !== other.parts.length) {
      return false;
    }
    one.parts.forEach((part, index) => {
      pending.push([part, other.parts[index] as Value]);
    });
    return true;
  }

  /** Whether two maps hold equal keys; the pairs of their values go onto `pending`. */
  #sameKeys(one: MapOf<Value>, other: MapOf<Value>, pending: (readonly [Value, Value])[]) {
    return (
      one.entries.length === other.entries.length &&
      one.entries.every(([key, value]) => {
        const found = this.entryValue(other, key);
        if (found === undefined) {
          return false;
        }
        pending.push([value, found]);
        return true;
      })
    );
  }

  /** The positions of `map`'s entries by their key's structural key. */
  #tableOf(map: MapOf<Value>): ReadonlyMap<string, readonly number[]> {
    const known = this.#tables.get(map);
    if (known !== undefined) {
      return known;
    }
    const table = new Map<string, number[]>();
    map.entries.forEach(([key], position) => {
      const text = structuralKey(this.#view, key);
      table.set(text, [...(table.get(text) ?? []), position]);
    });
    this.#tables.set(map, table);
    return table;
  }

  /**
   * Gives `next`, built from `map` by setting `key`, a table derived from `map`'s, if `map` has
   * one: the same table when `key` replaced a value, else that table with `key` added at the end.
   */
  #carryTable(map: MapOf<Value>, next: MapOf<Value>, key: Value): void {
    const table = this.#tables.get(map);
    if (table === undefined) {
      return;
    }
    if (next.entries.length === map.entries.length) {
      this.#tables.set(next, table);
      return;
    }
    const text = structuralKey(this.#view, key);
    const extended = new Map(table);
    extended.set(text, [...(table.get(text) ?? []), next.entries.length - 1]);
    this.#tables.set(next, extended);
  }
}

/** One step of hashing a value: visit a value, or join the texts of its parts once they're made. */
type KeyStep<Value> =
  | { readonly kind: 'visit'; readonly value: Value }
  | { readonly kind: 'join'; readonly head: string; readonly parts: number }
  | { readonly kind: 'joinMap'; readonly entries: number };

/** A value's structure as text: values `==` calls equal give the same text. */
export function structuralKey<Value>(view: ValueView<Value>, value: Value): string {
  const texts: string[] = [];
  const steps: KeyStep<Value>[] = [{ kind: 'visit', value }];
  for (let step = steps.pop(); step !== undefined; step = steps.pop()) {
    if (step.kind === 'join') {
      texts.push(`${step.head}(${texts.splice(texts.length - step.parts, step.parts).join(',')})`);
    } else if (step.kind === 'joinMap') {
      const count = 2 * step.entries;
      texts.push(`map(${entryTexts(texts.splice(texts.length - count, count))})`);
    } else {
      const shape = view.shapeOf(step.value);
      if (shape.kind === 'primitive') {
        texts.push(primitiveKey(shape.value));
      } else {
        for (const next of partSteps(view, step.value, shape)) {
          steps.push(next);
        }
      }
    }
  }
  return texts.pop() ?? '';
}

/** The steps hashing a composite or map takes: its join, after which its parts are visited. */
function partSteps<Value>(
  view: ValueView<Value>,
  value: Value,
  shape: Exclude<Shape<Value>, { kind: 'primitive' }>,
): readonly KeyStep<Value>[] {
  const [join, parts]: [KeyStep<Value>, readonly Value[]] =
    shape.kind === 'map'
      ? [{ kind: 'joinMap', entries: shape.map.entries.length }, shape.map.entries.flat()]
      : [{ kind: 'join', head: view.headKey(value), parts: shape.parts.length }, shape.parts];
  return [join, ...parts.toReversed().map((part) => ({ kind: 'visit', value: part }) as const)];
}

/** A primitive's text; `-0 == 0`, and `String(-0)` is `'0'`, while a NaN's `'NaN'` `==` refuses. */
function primitiveKey(value: Primitive): string {
  return `${typeof value}:${typeof value === 'string' ? JSON.stringify(value) : String(value)}`;
}

/** A map's entries as text, `key=value`, in an order every equal map shares. */
function entryTexts(texts: readonly string[]): string {
  const entries: string[] = [];
  for (let at = 0; at < texts.length; at += 2) {
    entries.push(`${texts[at]}=${texts[at + 1]}`);
  }
  return entries.toSorted(byCodeUnits).join(',');
}

/**
 * Orders texts by their code units, so the order is the same for any two equal texts and differs
 * for any two different ones; a locale's order may call different texts equal.
 */
function byCodeUnits(first: string, second: string): number {
  if (first < second) {
    return -1;
  }
  return first > second ? 1 : 0;
}
