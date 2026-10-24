/**
 * The types a Definition carries, and why it carries so few.
 *
 * The code is untyped: operators, indexing and conversions are already resolved calls, and
 * generics are compiled once per concrete set of type arguments (docs/arch/definition.md,
 * Decisions), so no instruction needs a type to run. Types are kept only where a value's shape
 * must be known without code:
 * - field and variant names and order, for construction, the host boundary, `json` and messages
 * - annotations on fields (`@JsonName`, `@JsonSkip`)
 * - the declared parameter and result types of externs, which drive the boundary conversion
 * - extern types, and how an instantiation is disposed
 *
 * Every entry is fully instantiated: `Pair<int, string>` and `Pair<int, int>` are two entries,
 * and a reference never contains a type parameter. An entry is identified by its module-qualified
 * declared `name` and its `arguments`, so the runtime recognizes `time.Time` or `prelude.Optional`
 * whatever they are instantiated with. An anonymous struct has no name and an entry of its own,
 * since two of them are always different types (spec §3.1).
 *
 * Only extern types can be disposable (spec §7), and each says how: not at all, by the runtime
 * itself (futures, slots, revertible messages), or by calling a declared `dispose`, as
 * `fn dispose(self: Shared<Lease>)` makes every `Shared<Lease>` disposable.
 */

import { z } from 'zod';
import { functionId, typeId } from './operands.ts';
import { value } from './values.ts';

const primitiveNames = ['int', 'float', 'bool', 'string', 'unit', 'never'] as const;

const primitive = z.strictObject({ kind: z.literal('primitive'), name: z.enum(primitiveNames) });

const named = z.strictObject({ kind: z.literal('named'), type: typeId });

const tuple = z.strictObject({
  kind: z.literal('tuple'),
  get elements() {
    return z.array(typeReference);
  },
});

const functionType = z.strictObject({
  kind: z.literal('function'),
  async: z.boolean(),
  get parameters() {
    return z.array(typeReference);
  },
  get result() {
    return typeReference;
  },
});

/** A use of a type: a primitive, an entry in the Definition's type table, or a structural type. */
export const typeReference = z.discriminatedUnion('kind', [primitive, named, tuple, functionType]);

export type TypeReference = z.output<typeof typeReference>;

/** The type-table entries a reference names, at any depth. */
export function typesIn(reference: TypeReference): readonly number[] {
  switch (reference.kind) {
    case 'primitive':
      return [];
    case 'named':
      return [reference.type];
    case 'tuple':
      return reference.elements.flatMap(typesIn);
    case 'function':
      return [...reference.parameters, reference.result].flatMap(typesIn);
    default: {
      const unhandled: never = reference;
      return unhandled;
    }
  }
}

const field = z.strictObject({
  name: z.string(),
  type: typeReference,
  /** Annotation values in source order, each a struct value of the annotation's type. */
  annotations: z.array(value),
});

/** The module-qualified declared name, `time.Duration`, and the instantiation's type arguments. */
const identity = { name: z.string(), arguments: z.array(typeReference) };

const struct = z.strictObject({
  kind: z.literal('struct'),
  /** Absent for an anonymous struct. */
  name: z.string().optional(),
  arguments: identity.arguments,
  fields: z.array(field),
});

const enumeration = z.strictObject({
  kind: z.literal('enum'),
  ...identity,
  variants: z.array(z.strictObject({ name: z.string(), fields: z.array(field) })),
});

const disposal = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('runtime') }),
  z.strictObject({ kind: z.literal('function'), function: functionId }),
]);

/** A type the runtime or host implements, such as `prelude.Array<int>` or a host `Queue<T>`. */
const external = z.strictObject({
  kind: z.literal('extern'),
  ...identity,
  sendable: z.boolean(),
  disposal,
});

export const typeDefinition = z.discriminatedUnion('kind', [struct, enumeration, external]);

export type TypeDefinition = z.output<typeof typeDefinition>;
