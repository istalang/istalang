/**
 * The built-in `==` and map keys (§3.8, §3.9), written once for every representation of values: the
 * runtime's (definition/values/equality.ts) and compile time's constant forms
 * (checker/surface/constant-form.ts). A representation shows its values through a `ValueView`; the
 * rules live here alone, so compile time and run time can't disagree on them.
 *
 * - Primitives compare as JavaScript's `===` does, so a float NaN equals nothing (IEEE 754) and
 *   `0.0 == -0.0`. A composite compares its head (kind, type, variant, function or object), then
 *   its parts in order; a map compares by its entries, whose order is no part of its value.
 * - A map finds a key through a 32-bit hash of the key's structure, confirmed with `==`, so a
 *   lookup agrees with `==` exactly: a key holding a NaN is stored but never found again. Values
 *   never mutate once built, so each composite or map's hash and each map's hash table are derived
 *   once and kept in WeakMaps keyed by the object itself; a map built from another by setting one
 *   key takes the other's table over, so building a map key by key never hashes a key twice.
 * - Setting a key a map holds keeps its place; a new key goes last. So a map literal's later entry
 *   for an equal key replaces the earlier one's value, where the earlier one stood.
 * - Every walk keeps its own stack, so a value of any depth compares and hashes without exhausting
 *   JavaScript's, maps keyed by maps included.
 */

export type Primitive = null | boolean | string | bigint | number;

/** A map as every representation holds it: entries in the order their keys were first set. */
export interface MapOf<Value> {
  readonly kind: 'map';
  readonly entries: readonly (readonly [Value, Value])[];
}

/** What `==` sees of a value: a primitive, a map, or a composite's parts. */
type Shape<Value> =
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
  readonly #tables = new WeakMap<MapOf<Value>, ReadonlyMap<number, readonly number[]>>();
  readonly #hashes = new WeakMap<object, number>();

  constructor(view: ValueView<Value>) {
    this.#view = view;
  }

  readonly equal = (first: Value, second: Value): boolean => {
    const frames: EqualFrame<Value>[] = [{ steps: [{ kind: 'pair', left: first, right: second }] }];
    for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
      const step = frame.steps.pop();
      if (step === undefined) {
        frames.pop();
        const parent = frames.at(-1);
        const { candidates } = frame;
        const matched =
          candidates === undefined
            ? undefined
            : candidates.map.entries[candidates.positions[candidates.at] ?? -1];
        if (parent !== undefined && candidates !== undefined && matched !== undefined) {
          parent.steps.push({ kind: 'pair', left: candidates.value, right: matched[1] });
        }
      } else if (!(this.#step(step, frame.steps, frames) || backtrack(frames))) {
        return false;
      }
    }
    return true;
  };

  /** The position of `key`'s entry in `map`; undefined when `map` has no such key. */
  readonly entryPosition = (map: MapOf<Value>, key: Value): number | undefined => {
    if (map.entries.length === 0) {
      return undefined;
    }
    const candidates = this.#tableOf(map).get(this.#hashOf(key)) ?? [];
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

  /** Runs `step`, pushing any follow-up steps or candidate search frame; false when it disagrees. */
  #step(step: EqualStep<Value>, steps: EqualStep<Value>[], frames: EqualFrame<Value>[]): boolean {
    if (step.kind === 'pair') {
      return this.#agreeAtTop(step.left, step.right, steps);
    }
    const positions = this.#tableOf(step.map).get(this.#hashOf(step.key)) ?? [];
    const next = candidateFrame({
      map: step.map,
      key: step.key,
      value: step.value,
      positions,
      at: 0,
    });
    if (next === undefined) {
      return false;
    }
    frames.push(next);
    return true;
  }

  /** Whether `left` and `right` agree but for their parts, whose steps go onto `steps`. */
  #agreeAtTop(left: Value, right: Value, steps: EqualStep<Value>[]): boolean {
    const [one, other] = [this.#view.shapeOf(left), this.#view.shapeOf(right)];
    if (one.kind === 'primitive' || other.kind === 'primitive') {
      return one.kind === 'primitive' && other.kind === 'primitive' && one.value === other.value;
    }
    if (one.kind === 'map' || other.kind === 'map') {
      if (
        one.kind !== 'map' ||
        other.kind !== 'map' ||
        one.map.entries.length !== other.map.entries.length
      ) {
        return false;
      }
      for (const [key, value] of one.map.entries) {
        steps.push({ kind: 'entry', map: other.map, key, value });
      }
      return true;
    }
    if (!this.#view.sameHead(left, right) || one.parts.length !== other.parts.length) {
      return false;
    }
    one.parts.forEach((part, index) => {
      steps.push({ kind: 'pair', left: part, right: other.parts[index] as Value });
    });
    return true;
  }

  #hashOf(value: Value): number {
    const hashes: number[] = [];
    const steps: HashStep<Value>[] = [{ kind: 'visit', value }];
    for (let step = steps.pop(); step !== undefined; step = steps.pop()) {
      if (step.kind === 'join') {
        const partHashes = hashes.splice(hashes.length - step.parts, step.parts);
        const hash = partHashes.reduce(mix, mix(hashText(step.head), step.parts));
        rememberHash(this.#hashes, step.value, hash);
        hashes.push(hash);
      } else if (step.kind === 'joinMap') {
        const count = 2 * step.entries;
        const hash = mapHash(hashes.splice(hashes.length - count, count));
        rememberHash(this.#hashes, step.value, hash);
        hashes.push(hash);
      } else {
        this.#visitHashValue(step.value, hashes, steps);
      }
    }
    return hashes.pop() ?? 0;
  }

  #visitHashValue(value: Value, hashes: number[], steps: HashStep<Value>[]): void {
    const known = typeof value === 'object' && value !== null ? this.#hashes.get(value) : undefined;
    if (known !== undefined) {
      hashes.push(known);
      return;
    }
    const shape = this.#view.shapeOf(value);
    if (shape.kind === 'primitive') {
      hashes.push(primitiveHash(shape.value));
      return;
    }
    for (const next of partSteps(this.#view, value, shape)) {
      steps.push(next);
    }
  }

  /** The positions of `map`'s entries by their key's structural hash. */
  #tableOf(map: MapOf<Value>): ReadonlyMap<number, readonly number[]> {
    const known = this.#tables.get(map);
    if (known !== undefined) {
      return known;
    }
    const table = new Map<number, number[]>();
    map.entries.forEach(([key], position) => {
      const hash = this.#hashOf(key);
      const bucket = table.get(hash);
      if (bucket === undefined) {
        table.set(hash, [position]);
      } else {
        bucket.push(position);
      }
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
    const hash = this.#hashOf(key);
    const extended = new Map(table);
    extended.set(hash, [...(table.get(hash) ?? []), next.entries.length - 1]);
    this.#tables.set(next, extended);
  }
}

/** One step of comparing two values: a pair of parts, or one entry of a map to find in another. */
type EqualStep<Value> =
  | { readonly kind: 'pair'; readonly left: Value; readonly right: Value }
  | {
      readonly kind: 'entry';
      readonly map: MapOf<Value>;
      readonly key: Value;
      readonly value: Value;
    };

interface CandidateSearch<Value> {
  readonly map: MapOf<Value>;
  readonly key: Value;
  readonly value: Value;
  readonly positions: readonly number[];
  readonly at: number;
}

/**
 * One level of `==`: the steps still to check, and, when this level is testing a candidate key in
 * a map, the candidate positions and the value to compare once the key matches.
 */
interface EqualFrame<Value> {
  readonly steps: EqualStep<Value>[];
  readonly candidates?: CandidateSearch<Value>;
}

function candidateFrame<Value>(candidates: CandidateSearch<Value>): EqualFrame<Value> | undefined {
  const position = candidates.positions[candidates.at];
  const entry = position === undefined ? undefined : candidates.map.entries[position];
  if (entry === undefined) {
    return undefined;
  }
  return {
    steps: [{ kind: 'pair', left: entry[0], right: candidates.key }],
    candidates,
  };
}

/** Advances the nearest candidate search with remaining positions; false when none remains. */
function backtrack<Value>(frames: EqualFrame<Value>[]): boolean {
  for (let top = frames.pop(); top !== undefined; top = frames.pop()) {
    const next =
      top.candidates === undefined
        ? undefined
        : candidateFrame({ ...top.candidates, at: top.candidates.at + 1 });
    if (next !== undefined) {
      frames.push(next);
      return true;
    }
  }
  return false;
}

/** One step of hashing a value: visit a value, or combine the hashes of its parts once made. */
type HashStep<Value> =
  | { readonly kind: 'visit'; readonly value: Value }
  | { readonly kind: 'join'; readonly value: Value; readonly head: string; readonly parts: number }
  | { readonly kind: 'joinMap'; readonly value: Value; readonly entries: number };

function rememberHash<Value>(hashes: WeakMap<object, number>, value: Value, hash: number): void {
  if (typeof value === 'object' && value !== null) {
    hashes.set(value, hash);
  }
}

/** The steps hashing a composite or map takes: its join, after which its parts are visited. */
function partSteps<Value>(
  view: ValueView<Value>,
  value: Value,
  shape: Exclude<Shape<Value>, { kind: 'primitive' }>,
): readonly HashStep<Value>[] {
  const [join, parts]: [HashStep<Value>, readonly Value[]] =
    shape.kind === 'map'
      ? [{ kind: 'joinMap', value, entries: shape.map.entries.length }, shape.map.entries.flat()]
      : [
          { kind: 'join', value, head: view.headKey(value), parts: shape.parts.length },
          shape.parts,
        ];
  return [join, ...parts.toReversed().map((part) => ({ kind: 'visit', value: part }) as const)];
}

const fnvPrime = 0x01_00_01_93;
const fnvOffsetBasis = -0x7e_e3_62_3b;

/** Mixes a 32-bit hash with `next` (FNV-1a prime, wrapped in 32-bit signed arithmetic). */
function mix(hash: number, next: number): number {
  return Math.imul(Math.imul(hash, fnvPrime) + next, 1);
}

function hashText(text: string): number {
  let hash = fnvOffsetBasis;
  for (let index = 0; index < text.length; index += 1) {
    hash = mix(hash, text.charCodeAt(index));
  }
  return hash;
}

/** A primitive's hash; `-0 == 0`, and `String(-0)` is `'0'`. */
function primitiveHash(value: Primitive): number {
  return hashText(`${typeof value}:${String(value)}`);
}

/** A map's hash: the 32-bit sum of its entry hashes, independent of entry order. */
function mapHash(hashes: readonly number[]): number {
  let sum = 0;
  for (let at = 0; at < hashes.length; at += 2) {
    sum = Math.imul(sum + mix(hashes[at] ?? 0, hashes[at + 1] ?? 0), 1);
  }
  return mix(sum, hashes.length);
}
