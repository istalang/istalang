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
 */

import { z } from 'zod';
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

/** A value of an extern type the runtime or host implements; the payload is opaque here. */
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
 * interfaces because a recursive type can refer to itself only through one.
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
interface MapOf<Child> {
  kind: 'map';
  entries: [Child, Child][];
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

/** A value that contains other values. */
export type CompositeValue = Exclude<Value, null | boolean | string | bigint | number>;

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

/** The heap objects a value holds handles to, at any depth. */
export function handlesIn(contents: Value): readonly number[] {
  if (!isComposite(contents)) {
    return [];
  }
  if (contents.kind === 'handle') {
    return [contents.object];
  }
  return childValues(contents).flatMap(handlesIn);
}

function floatOnDisk(number: number): number | SpecialFloat {
  if (Object.is(number, -0)) {
    return '-0';
  }
  return Number.isFinite(number) ? number : (String(number) as SpecialFloat);
}
