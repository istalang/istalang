/**
 * Writing into values in place: what a program sees is a value's, whatever the runtime changes in
 * place. Every value a write starts from is frozen, as a constant or a restored value is shared
 * with other instances, so a change in place of anything but this instance's own copy throws. A
 * model running the same writes over immutable values says what every holder must hold.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { valueArbitrary } from '../../definition/values/values.test-kit.ts';
import {
  childValues,
  elementsOf,
  isComposite,
  type Value,
  withChildValues,
} from '../../definition/values/values.ts';
import { Unreachable } from '../../foundation/structures/unreachable.ts';
import { partAt } from '../interpreter/parts.ts';
import { nothingHeld } from '../snapshot/holdings.ts';
import { Counts } from './counts.ts';
import { frozen } from './in-place.test-kit.ts';
import { InPlace } from './in-place.ts';

/** The parts a field position reaches in `value`, as the `field` instruction reads them. */
function fieldsOf(value: Value): readonly Value[] {
  return isComposite(value) ? childValues(value) : [];
}

/** Every field path into `value`, the empty path first. */
function fieldPaths(value: Value): number[][] {
  return [
    [],
    ...fieldsOf(value).flatMap((part, index) => fieldPaths(part).map((rest) => [index, ...rest])),
  ];
}

/** Whether `inner` starts with every position of `outer`. */
function startsWith(inner: readonly number[], outer: readonly number[]): boolean {
  return outer.every((index, at) => inner[at] === index);
}

/** `value` with its part at `path` replaced, rebuilt along the path: what a write means. */
function modelWithPart(value: Value, path: readonly number[], part: Value): Value {
  const [index, ...rest] = path;
  if (index === undefined || !isComposite(value)) {
    return part;
  }
  const parts = childValues(value);
  return withChildValues(value, parts.with(index, modelWithPart(parts[index] ?? null, rest, part)));
}

const valueWithPath = valueArbitrary({ typed: true }).chain((value) =>
  fc.record({
    value: fc.constant(frozen(value)),
    path: fc.constantFrom(...fieldPaths(value)),
    part: valueArbitrary({ typed: true }),
  }),
);

describe('a write into a value not its own', () => {
  const values = new InPlace(new Counts());

  it('reads back the part written at a path', () => {
    fc.assert(
      fc.property(valueWithPath, ({ value, path, part }) => {
        expect(partAt(values.withPart(value, path, part), path)).toBe(part);
      }),
    );
  });

  it('never changes the value it writes into', () => {
    fc.assert(
      fc.property(valueWithPath, ({ value, path, part }) => {
        const before = structuredClone(value);
        values.withPart(value, path, part);
        expect(value).toEqual(before);
      }),
    );
  });

  it('leaves every part neither on nor below the path as it was', () => {
    fc.assert(
      fc.property(valueWithPath, ({ value, path, part }) => {
        const written = values.withPart(value, path, part);
        const untouched = fieldPaths(value).filter(
          (other) => !(startsWith(path, other) || startsWith(other, path)),
        );
        for (const other of untouched) {
          expect(partAt(written, other)).toBe(partAt(value, other));
        }
      }),
    );
  });

  it('refuses a field a value lacks', () => {
    expect(() => partAt(5n, [0])).toThrow(Unreachable);
    const empty: Value = { kind: 'tuple', elements: [] };
    expect(() => partAt(empty, [0])).toThrow(Unreachable);
  });
});

/** A write over registers holding values: what a frame's instructions do to them. */
type Step =
  | { readonly kind: 'copy'; readonly from: number; readonly to: number }
  | { readonly kind: 'push'; readonly into: number; readonly item: number | 'scalar' }
  | { readonly kind: 'pop'; readonly from: number }
  | { readonly kind: 'pair'; readonly into: number; readonly with: number }
  | { readonly kind: 'store'; readonly into: number; readonly path: number; readonly item: number };

const registerCount = 3;
const register = fc.nat({ max: registerCount - 1 });

const anyStep: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('copy' as const), from: register, to: register }),
  fc.record({
    kind: fc.constant('push' as const),
    into: register,
    item: fc.oneof(register, fc.constant('scalar' as const)),
  }),
  fc.record({ kind: fc.constant('pop' as const), from: register }),
  fc.record({ kind: fc.constant('pair' as const), into: register, with: register }),
  fc.record({
    kind: fc.constant('store' as const),
    into: register,
    path: fc.nat({ max: 3 }),
    item: register,
  }),
);

/** An array of `n` small arrays, shared by every register at first, as a constant would be. */
function constantOf(n: number): Value {
  return frozen({
    kind: 'array',
    elements: Array.from({ length: n }, (_, index) => ({
      kind: 'array',
      elements: [BigInt(index)],
    })),
  });
}

/** Registers that report their writes to `counts`, as interpreter/registers.ts does. */
class Registers {
  readonly values: Value[];
  readonly #counts: Counts;

  constructor(counts: Counts, start: Value) {
    this.#counts = counts;
    this.values = Array.from({ length: registerCount }, () => start);
    for (const value of this.values) {
      counts.changed(nothingHeld, { values: [value], holds: [] });
    }
  }

  write(at: number, value: Value): void {
    const was = this.values[at] ?? null;
    this.values[at] = value;
    this.#counts.changed({ values: [was], holds: [] }, { values: [value], holds: [] });
  }
}

function isArray(value: Value): boolean {
  return isComposite(value) && value.kind === 'array';
}

/** Whether `value` is an array with an element at `position`. */
function hasElement(value: Value, position: number): boolean {
  return isArray(value) && position < elementsOf(value).length;
}

describe('writes in place over counted holders', () => {
  it('give every holder what the writes over immutable values give it', () => {
    fc.assert(
      fc.property(fc.nat({ max: 4 }), fc.array(anyStep, { maxLength: 40 }), (size, steps) => {
        const counts = new Counts();
        const values = new InPlace(counts);
        const start = constantOf(size);
        const live = new Registers(counts, start);
        const model: Value[] = Array.from({ length: registerCount }, () => structuredClone(start));
        for (const each of steps) {
          run(each, live, values, model);
          expect(live.values).toEqual(model);
        }
        expect(start).toEqual(constantOf(size));
      }),
    );
  });

  it('change a value held once, which this instance copied for writing, in place', () => {
    const counts = new Counts();
    const values = new InPlace(counts);
    const live = new Registers(counts, constantOf(1));
    live.write(1, null);
    live.write(2, null);
    live.write(0, values.appended(live.values[0] ?? null, [1n]));
    const [copy = null] = live.values;
    live.write(0, values.appended(copy, [2n]));
    expect(live.values[0]).toBe(copy);
    expect(elementsOf(copy)).toHaveLength(3);
  });

  it('copy a value it holds once it is held twice', () => {
    const counts = new Counts();
    const values = new InPlace(counts);
    const live = new Registers(counts, constantOf(1));
    live.write(0, values.appended(live.values[0] ?? null, [1n]));
    const own = live.values[0] ?? null;
    live.write(1, own);
    live.write(0, values.appended(own, [2n]));
    expect(live.values[0]).not.toBe(own);
    expect(elementsOf(own)).toHaveLength(2);
  });
});

/** Runs `step` over the live registers and over the model. */
function run(step: Step, live: Registers, values: InPlace, model: Value[]): void {
  const at = (registers: readonly Value[], index: number): Value => registers[index] ?? null;
  switch (step.kind) {
    case 'copy':
      live.write(step.to, at(live.values, step.from));
      model[step.to] = at(model, step.from);
      return;
    case 'push': {
      if (!isArray(at(model, step.into))) {
        return;
      }
      const item = (registers: readonly Value[]): Value =>
        step.item === 'scalar' ? 7n : at(registers, step.item);
      live.write(step.into, values.appended(at(live.values, step.into), [item(live.values)]));
      model[step.into] = {
        kind: 'array',
        elements: [...elementsOf(at(model, step.into)), item(model)],
      };
      return;
    }
    case 'pop': {
      if (!hasElement(at(model, step.from), 0)) {
        return;
      }
      const { whole } = values.changed(at(live.values, step.from), [], [], values.pop);
      live.write(step.from, whole);
      model[step.from] = { kind: 'array', elements: elementsOf(at(model, step.from)).slice(0, -1) };
      return;
    }
    case 'pair': {
      const pair = (registers: readonly Value[]): Value => ({
        kind: 'array',
        elements: [at(registers, step.into), at(registers, step.with)],
      });
      live.write(step.into, pair(live.values));
      model[step.into] = pair(model);
      return;
    }
    case 'store': {
      if (!hasElement(at(model, step.into), step.path)) {
        return;
      }
      const item = at(live.values, step.item);
      live.write(step.into, values.withPart(at(live.values, step.into), [step.path], item));
      model[step.into] = modelWithPart(at(model, step.into), [step.path], at(model, step.item));
      return;
    }
    default: {
      const unhandled: never = step;
      throw new Error(`An unknown step ${String(unhandled)}.`);
    }
  }
}
