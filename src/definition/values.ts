/**
 * Values as they are persisted: constants in a Definition, and the heap and registers in a
 * snapshot.
 *
 * In memory an `int` is a bigint and a `float` is a number (docs/arch/architecture.md), so the
 * decoded shapes carry no tags for them. JSON can't tell 2 from 2.0, so on disk a float is tagged
 * `{kind: 'float'}` while an integer stays a plain JSON integer: integers are far more common in
 * workflow state. A tagged float also carries what JSON numbers can't (NaN, ±Infinity, -0).
 *
 * `unit` is `null`. Composite values reference types, functions and heap objects by index into
 * the Definition's tables and the snapshot's object list (definition.md, "Values").
 *
 * A handle (a slot, future, shared cell or other heap object) exists only inside a running
 * instance. Constants never contain one; references.ts rejects any that do.
 *
 * A value persists only up to `maximumDepth` levels deep (§5): the JSON and zod codecs recurse on
 * the host's stack. Walks over values in memory keep stacks of their own, so a deeper value lives
 * within a segment; the runtime refuses to commit one (scheduler/segment/).
 */

import { z } from 'zod';
import type { MapOf } from '../language/values.ts';
import { pushAll } from '../structures/stack.ts';
import { unreachable } from '../structures/unreachable.ts';
import { encodeJson } from './codec.ts';
import { functionId, objectId, typeId, variantIndex } from './operands.ts';

const specialFloats = ['NaN', 'Infinity', '-Infinity', '-0'] as const;

type SpecialFloat = (typeof specialFloats)[number];

/** A language `int`: any JSON integer on disk, a bigint in memory. */
export const integer = z.codec(z.union([z.int(), z.bigint()]), z.bigint(), {
  decode: (onDisk) => BigInt(onDisk),
  encode: (inMemory) => inMemory,
});

/**
 * A large whole float, such as 2 ** 60, prints as integer digits, which the codec reads back as a
 * bigint. Those digits are the double's own shortest form, so converting back is exact.
 *
 * zod doesn't always run the in-memory check before `encode`: inside a discriminated union it
 * reached `encode` with an object. So `encode` passes anything that isn't a number through
 * unchanged, and the on-disk schema rejects it, which lets the union try its next branch.
 */
const float = z.codec(
  z.strictObject({
    kind: z.literal('float'),
    value: z.union([z.number(), z.bigint(), z.enum(specialFloats)]),
  }),
  z.custom<number>((inMemory) => typeof inMemory === 'number', 'Expected a float'),
  {
    decode: (onDisk) => Number(onDisk.value),
    encode: (inMemory: unknown) => ({
      kind: 'float' as const,
      value: typeof inMemory === 'number' ? floatOnDisk(inMemory) : (inMemory as number),
    }),
  },
);

const tuple = z.strictObject({
  kind: z.literal('tuple'),
  get elements() {
    return z.array(value);
  },
});

/** A struct value; `fields` follow the declaration order of its type. */
const struct = z.strictObject({
  kind: z.literal('struct'),
  type: typeId,
  get fields() {
    return z.array(value);
  },
});

/** An enum value: its variant's index in the type, and that variant's fields. */
const variant = z.strictObject({
  kind: z.literal('variant'),
  type: typeId,
  variant: variantIndex,
  get fields() {
    return z.array(value);
  },
});

const array = z.strictObject({
  kind: z.literal('array'),
  get elements() {
    return z.array(value);
  },
});

/** Entries in the map's own order, which the runtime keeps so a restore iterates the same way. */
const map = z.strictObject({
  kind: z.literal('map'),
  get entries() {
    return z.array(z.tuple([value, value]));
  },
});

/** A function value: its code, plus the captured values the closure carries (spec §3.14). */
const closure = z.strictObject({
  kind: z.literal('closure'),
  function: functionId,
  get captures() {
    return z.array(value);
  },
});

/** A value of an extern type the runtime or host implements; its payload is plain JSON (`samePayload`). */
const external = z.strictObject({
  kind: z.literal('extern'),
  type: typeId,
  payload: z.unknown(),
});

/** A reference to a heap object of the running instance. */
const handle = z.strictObject({
  kind: z.literal('handle'),
  object: objectId,
});

/*
 * The composite shapes, over a child type: `Value` in memory, `ValueOnDisk` on disk. They are
 * interfaces because a recursive type can refer to itself only through one. A map's is the
 * language's (language/values.ts), whose `==` and map keys every representation shares.
 */
interface TupleOf<Child> {
  kind: 'tuple';
  elements: Child[];
}
interface StructOf<Child> {
  kind: 'struct';
  type: number;
  fields: Child[];
}
interface VariantOf<Child> {
  kind: 'variant';
  type: number;
  variant: number;
  fields: Child[];
}
interface ArrayOf<Child> {
  kind: 'array';
  elements: Child[];
}
interface ClosureOf<Child> {
  kind: 'closure';
  function: number;
  captures: Child[];
}
interface ExternValue {
  kind: 'extern';
  type: number;
  payload: unknown;
}
interface HandleValue {
  kind: 'handle';
  object: number;
}

export type Value =
  | null
  | boolean
  | string
  | bigint
  | number
  | TupleOf<Value>
  | StructOf<Value>
  | VariantOf<Value>
  | ArrayOf<Value>
  | MapOf<Value>
  | ClosureOf<Value>
  | ExternValue
  | HandleValue;

export type ValueOnDisk =
  | null
  | boolean
  | string
  | number
  | bigint
  | { kind: 'float'; value: number | bigint | SpecialFloat }
  | TupleOf<ValueOnDisk>
  | StructOf<ValueOnDisk>
  | VariantOf<ValueOnDisk>
  | ArrayOf<ValueOnDisk>
  | MapOf<ValueOnDisk>
  | ClosureOf<ValueOnDisk>
  | ExternValue
  | HandleValue;

/**
 * Written out as a type because a recursive schema's inferred type would be spelled out again at
 * every use, which makes declarations too large to emit; the annotation keeps the schema checked
 * against it.
 */
export const value: z.ZodType<Value, ValueOnDisk> = z.union([
  z.null(),
  z.boolean(),
  z.string(),
  integer,
  float,
  tuple,
  struct,
  variant,
  array,
  map,
  closure,
  external,
  handle,
]);

/** The elements of an array value; anything else is a bug in lowering or loading. */
export function elementsOf(candidate: Value | undefined): readonly Value[] {
  if (candidate === undefined || !isComposite(candidate) || candidate.kind !== 'array') {
    unreachable('Expected an array.');
  }
  return candidate.elements;
}

/** The map `candidate` is; anything else is a bug in lowering or loading. */
export function mapValueOf(candidate: Value | undefined): MapOf<Value> {
  if (candidate === undefined || !isComposite(candidate) || candidate.kind !== 'map') {
    unreachable('Expected a map.');
  }
  return candidate;
}

/** A value that contains other values. */
export type CompositeValue = Exclude<Value, null | boolean | string | bigint | number>;

/**
 * Whether two extern payloads are one value: one canonical JSON text (codec.ts), since a snapshot
 * round trip rebuilds every object a payload holds and decodes a safe bigint as a number.
 */
export function samePayload(first: unknown, second: unknown): boolean {
  return first === second || encodeJson(first) === encodeJson(second);
}

/** The heap object a handle names; undefined for any other value. */
export function handleTarget(candidate: Value | undefined): number | undefined {
  return candidate !== undefined && isComposite(candidate) && candidate.kind === 'handle'
    ? candidate.object
    : undefined;
}

/** Whether a value has parts, so it can be walked with `childValues`. */
export function isComposite(candidate: Value): candidate is CompositeValue {
  return candidate !== null && typeof candidate === 'object';
}

/** The values directly inside a composite value; the one place that knows where they are. */
export function childValues(composite: CompositeValue): readonly Value[] {
  switch (composite.kind) {
    case 'tuple':
    case 'array':
      return composite.elements;
    case 'struct':
    case 'variant':
      return composite.fields;
    case 'map':
      return composite.entries.flat();
    case 'closure':
      return composite.captures;
    case 'extern':
    case 'handle':
      return [];
    default: {
      const unhandled: never = composite;
      return unhandled;
    }
  }
}

/**
 * `composite` with the values directly inside it replaced by `children`, given in `childValues`'
 * order: the one place that knows how to rebuild them.
 */
export function withChildValues(
  composite: CompositeValue,
  children: readonly Value[],
): CompositeValue {
  switch (composite.kind) {
    case 'tuple':
    case 'array':
      return { ...composite, elements: [...children] };
    case 'struct':
    case 'variant':
      return { ...composite, fields: [...children] };
    case 'map':
      return {
        ...composite,
        entries: composite.entries.map((_, index): [Value, Value] => [
          children[2 * index] as Value,
          children[2 * index + 1] as Value,
        ]),
      };
    case 'closure':
      return { ...composite, captures: [...children] };
    case 'extern':
    case 'handle':
      return composite;
    default: {
      const unhandled: never = composite;
      return unhandled;
    }
  }
}

/**
 * How deep a persisted value may nest: well within what the codecs read and write on the host's
 * stack (measured: past 600 levels), and deeper than workflow data needs.
 */
export const maximumDepth = 256;

/** The heap objects a value holds handles to, at any depth, each once, in the order of its parts. */
export function handlesIn(contents: Value): readonly number[] {
  return isComposite(contents) ? summaryOf(contents).handles : noHandles;
}

/** How deep `candidate` nests: 0 for a primitive, one more than its deepest part for a composite. */
export function depthOf(candidate: Value): number {
  return isComposite(candidate) ? summaryOf(candidate).depth : 0;
}

/** What one walk learns of a composite: how deep it nests, and the objects its handles name. */
interface Summary {
  readonly depth: number;
  readonly handles: readonly number[];
}

const noHandles: readonly number[] = [];

/**
 * Each composite's summary, derived once, since a value never changes. Holders are decided by
 * walking values at every release point (runtime/lifetimes/), so a value walked before is free:
 * its parts are never listed again.
 */
const summaries = new WeakMap<CompositeValue, Summary>();

function summaryOf(candidate: CompositeValue): Summary {
  const pending: CompositeValue[] = [candidate];
  for (let top = pending.at(-1); top !== undefined; top = pending.at(-1)) {
    const parts = summaries.has(top) ? [] : childValues(top).filter(isComposite);
    const unknown = parts.filter((part) => !summaries.has(part));
    if (unknown.length > 0) {
      pushAll(pending, unknown);
    } else {
      pending.pop();
      summaries.set(top, summaries.get(top) ?? summaryOver(top, parts));
    }
  }
  return summaries.get(candidate) ?? { depth: 0, handles: noHandles };
}

/** The summary of `composite`, whose composite `parts` are summarized already. */
function summaryOver(composite: CompositeValue, parts: readonly CompositeValue[]): Summary {
  if (composite.kind === 'handle') {
    return { depth: 1, handles: [composite.object] };
  }
  let deepest = 0;
  const handles = new Set<number>();
  for (const part of parts) {
    const known = summaries.get(part);
    deepest = Math.max(deepest, known?.depth ?? 0);
    for (const object of known?.handles ?? noHandles) {
      handles.add(object);
    }
  }
  return { depth: 1 + deepest, handles: handles.size === 0 ? noHandles : [...handles] };
}

function floatOnDisk(number: number): number | SpecialFloat {
  if (Object.is(number, -0)) {
    return '-0';
  }
  return Number.isFinite(number) ? number : (String(number) as SpecialFloat);
}
