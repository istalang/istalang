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
 * Every entry is fully instantiated: `Pair<Int, String>` and `Pair<Int, Int>` are two entries,
 * and a reference never contains a type parameter. An entry is identified by its module-qualified
 * declared `name` and its `arguments`, so the runtime recognizes `time.Time` or `prelude.Optional`
 * whatever they are instantiated with. A shape (an anonymous struct type) has no name: it has one
 * entry however many places write it, its fields in name order (spec §3.1).
 *
 * A recursive alias whose values are tuples or functions (spec §3.17, `type Step = fn(Int) ->
 * Step`) has an entry of its own, which stands for the type it unfolds to: a reference holding it
 * would otherwise never end. Any other recursive alias is the entry of what it unfolds to, a
 * union's enum, a shape's struct or a declared type's, whose layout refers back to it.
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
import { value } from './values/values.ts';

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
  z.strictObject({
    kind: z.literal('function'),
    function: functionId,
    /**
     * For a `dispose` a host implements, the native entry its wrapper calls, so whatever stands in
     * for the host, as a test does (spec §10), knows which native releases a host value.
     */
    host: functionId.optional(),
  }),
]);

/**
 * What the runtime makes of an extern type's values: a `shared` type is every shared struct's,
 * whose values are handles to the cells `newCell` makes (spec §3.18); a `cell` type is every
 * `_Cell<T>`, the one a variable passed by `&` or captured lives in (§3.7, §3.14), as a code entry
 * lists in its `cells`; a `future` type is every `Future<T>`, which a host's extern returning one
 * gives back pending (§9); an `instance` type is every `Instance<T>`, which `spawn` gives, holding
 * the new instance's name (§9). Any other extern type has none.
 */
const externRole = z.enum(['shared', 'cell', 'future', 'instance']);

/** A type the runtime or host implements, such as `prelude.Array<Int>` or a host `Queue<T>`. */
const external = z.strictObject({
  kind: z.literal('extern'),
  ...identity,
  sendable: z.boolean(),
  disposal,
  role: externRole.optional(),
});

export type ExternRole = z.output<typeof externRole>;

/** A recursive alias that unfolds to a structural type: `type` is that type, which refers to it. */
const recursiveAlias = z.strictObject({
  kind: z.literal('alias'),
  ...identity,
  get type() {
    return typeReference;
  },
});

export const typeDefinition = z.discriminatedUnion('kind', [
  struct,
  enumeration,
  external,
  recursiveAlias,
]);

export type TypeDefinition = z.output<typeof typeDefinition>;

/**
 * Whether a value of the host type entry `type` of `types` is a resource object behind a handle
 * (§7): a `dispose` makes it disposable, so its values have an identity of their own, unless it is
 * a shared struct's, whose values are cells. Any other host type's values are its host's JSON, as
 * plain as an int.
 */
export function isResourceType(types: readonly TypeDefinition[], type: number): boolean {
  const entry = types[type];
  return entry?.kind === 'extern' && entry.disposal.kind === 'function' && entry.role !== 'shared';
}

/** Whether a cell may have the type entry `type` of `types`: a shared struct's or a variable's. */
export function isCellType(types: readonly TypeDefinition[], type: number): boolean {
  return hasRole(types, type, 'shared') || hasRole(types, type, 'cell');
}

/** Whether type entry `type` of `types` has `role`, an extern type's or an enum's. */
export function hasRole(
  types: readonly TypeDefinition[],
  type: number,
  role: ExternRole | EnumRole,
): boolean {
  const entry = types[type];
  return (entry?.kind === 'extern' || entry?.kind === 'enum') && entry.role === role;
}
