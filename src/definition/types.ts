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
 * Only extern entries can be disposable (spec §7), and each says how: not at all, by the runtime
 * itself (futures, slots), or by calling a declared `dispose`, as `fn dispose(self: Lease)` makes a
 * handle `Lease` disposable (§3.18), and the inbox module's every `Revertible<T>`.
 *
 * Where the runtime must know what an extern type's or an enum's values are beyond what its
 * natives do with them, the entry says so by its `role`, which lowering sets from the checker's
 * entities: no rule of the runtime depends on how a std module spells a name.
 */

import { z } from 'zod';
import { primitiveNames } from '../language/primitives.ts';
import { functionId, typeId } from './operands.ts';
import { value } from './values.ts';

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

/**
 * What the runtime makes of an enum's values: a `json` enum is the json module's `Json`, JSON held
 * as a value, which the json natives and the host boundary move across (spec §9). Any other enum
 * has none.
 */
const enumRole = z.enum(['json']);

const enumeration = z.strictObject({
  kind: z.literal('enum'),
  ...identity,
  variants: z.array(z.strictObject({ name: z.string(), fields: z.array(field) })),
  role: enumRole.optional(),
});

export type EnumRole = z.output<typeof enumRole>;

const disposal = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('runtime') }),
  z.strictObject({ kind: z.literal('function'), function: functionId }),
]);

/**
 * What the runtime makes of an extern type's values: a `cell` type is every handle's (spec §3.18),
 * `Shared<T>` the one variables live in (§3.7, §3.14); a `future` type is every `Future<T>`, which
 * a host's extern returning one gives back pending (§9). Any other extern type has none.
 */
const externRole = z.enum(['cell', 'future']);

/** A type the runtime or host implements, such as `prelude.Array<int>` or a host `Queue<T>`. */
const external = z.strictObject({
  kind: z.literal('extern'),
  ...identity,
  sendable: z.boolean(),
  disposal,
  role: externRole.optional(),
});

export type ExternRole = z.output<typeof externRole>;

export const typeDefinition = z.discriminatedUnion('kind', [struct, enumeration, external]);

export type TypeDefinition = z.output<typeof typeDefinition>;

/**
 * Whether a value of the host type entry `type` of `types` is a resource object behind a handle
 * (§7): a `dispose` makes it disposable, so its values have an identity of their own, unless it is
 * a cell's. Any other host type's values are its host's JSON, as plain as an int.
 */
export function isResourceType(types: readonly TypeDefinition[], type: number): boolean {
  const entry = types[type];
  return entry?.kind === 'extern' && entry.disposal.kind === 'function' && entry.role !== 'cell';
}

/** Whether type entry `type` of `types` has `role`. */
export function hasRole(types: readonly TypeDefinition[], type: number, role: ExternRole): boolean {
  const entry = types[type];
  return entry?.kind === 'extern' && entry.role === role;
}
