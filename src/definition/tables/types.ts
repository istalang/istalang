/**
 * The type table, and the types every register states (docs/arch/definition.md, "Types and locations").
 *
 * - **Typed code.** Every register has a type (../tables/functions.ts), so a backend lays values out
 *   and counts holders from the code alone; generics are compiled once per concrete set of type
 *   arguments, so no reference names a type parameter.
 * - **Reach facts on every entry.** `disposable` says a value of the entry may reach a disposable
 *   (the checker's `reachesDisposable`): only such values are counted to dispose them (§7), and no
 *   cycle passes through one. `heap` says a value is an allocation a backend counts to free it
 *   (LLVM) or to change it in place when unique: anything but a scalar.
 * - **One kind per meaning.** A struct, an enum, a shared struct (a handle to a cell holding its
 *   struct, §3.18), an extern type the runtime or a host implements, and a recursive alias that
 *   unfolds to a structural type (§3.17, `type Step = fn(Int) -> Step`), which a reference holding
 *   it would otherwise never end.
 * - **Labels, not identity.** An entry is its index; `name` and `arguments` serve traces and
 *   messages. A role marks what the runtime must know of an entry beyond its natives, set by
 *   lowering from the checker's entities, never from a std spelling.
 */

import { z } from 'zod';
import { primitiveNames } from '../../foundation/language/primitives.ts';
import { functionId, typeId } from '../operands.ts';
import { value } from '../values/values.ts';

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
  get parameters() {
    return z.array(typeReference);
  },
  get result() {
    return typeReference;
  },
});

/** A `&` parameter's register: a reference to a place of type `to` (§3.7). */
const referenceType = z.strictObject({
  kind: z.literal('reference'),
  get to() {
    return typeReference;
  },
});

/** A use of a type: a primitive, a table entry, a structural type, or a reference to a place. */
export const typeReference = z.discriminatedUnion('kind', [
  primitive,
  named,
  tuple,
  functionType,
  referenceType,
]);

export type TypeReference = z.output<typeof typeReference>;

const field = z.strictObject({
  name: z.string(),
  type: typeReference,
  /** Annotation values in source order, each a struct value of the annotation's type. */
  annotations: z.array(value),
});

export type Field = z.output<typeof field>;

/** What every entry states: its label, and its reach facts. */
const common = {
  /** A declared type's module-qualified name, `time.Duration`; any other's table key. */
  name: z.string(),
  arguments: z.array(typeReference),
  disposable: z.boolean(),
  heap: z.boolean(),
};

const struct = z.strictObject({ kind: z.literal('struct'), ...common, fields: z.array(field) });

/**
 * What the runtime makes of an enum's values: a `json` enum is the json module's `Json`, JSON held
 * as a value, which the host boundary moves across (§9).
 */
const enumRole = z.enum(['json']);

export type EnumRole = z.output<typeof enumRole>;

const enumeration = z.strictObject({
  kind: z.literal('enum'),
  ...common,
  variants: z.array(z.strictObject({ name: z.string(), fields: z.array(field) })),
  role: enumRole.optional(),
});

/** A shared struct's handle (§3.18): a cell holding a value of the struct entry `value`. */
const shared = z.strictObject({
  kind: z.literal('shared'),
  ...common,
  value: typeId,
  /** The declared `dispose`, run when the handle loses its last holder (§7). */
  dispose: functionId.optional(),
});

/**
 * What the runtime makes of an extern type's values: every `Array<T>`, every `Map<K, V>`, every
 * `_Cell<T>` (a variable passed by `&` or captured, §3.7, §3.14, or a transient, §3.4), every
 * weak reference (§7), every `Instance<T>` `spawn` gives, holding the instance's name (§9), and
 * the handle of an async call, the execution running it (§7).
 */
const externRole = z.enum(['array', 'map', 'cell', 'weakRef', 'instance', 'call']);

export type ExternRole = z.output<typeof externRole>;

/**
 * A type the runtime or a host implements: a role's, or a host's, whose values are its JSON, or
 * resource objects when it declares a `dispose` (§7, §9).
 */
const external = z.strictObject({
  kind: z.literal('extern'),
  ...common,
  role: externRole.optional(),
  dispose: functionId.optional(),
  /**
   * An `Instance<T>` entry's, when a codec writes `T`: the entry encoding the outcome of every
   * instance spawned as one (§9), whichever native spawns it.
   */
  encoder: functionId.optional(),
});

const recursiveAlias = z.strictObject({
  kind: z.literal('alias'),
  ...common,
  get type() {
    return typeReference;
  },
});

export const typeDefinition = z.discriminatedUnion('kind', [
  struct,
  enumeration,
  shared,
  external,
  recursiveAlias,
]);

export type TypeDefinition = z.output<typeof typeDefinition>;

/** The type-table entries `reference` names, at any depth. */
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
    case 'reference':
      return typesIn(reference.to);
    default: {
      const unhandled: never = reference;
      return unhandled;
    }
  }
}

/**
 * Whether a value of `reference` may reach a disposable: a function value may, its type not saying
 * what it captured (§7), and a reference reaches what its place holds.
 */
function reachesDisposable(types: readonly TypeDefinition[], reference: TypeReference): boolean {
  switch (reference.kind) {
    case 'primitive':
      return false;
    case 'named':
      return types[reference.type]?.disposable === true;
    case 'tuple':
      return reference.elements.some((element) => reachesDisposable(types, element));
    case 'function':
      return true;
    case 'reference':
      return reachesDisposable(types, reference.to);
    default: {
      const unhandled: never = reference;
      return unhandled;
    }
  }
}

/**
 * How a backend keeps holders of values of `reference` (ir-first design, decision 5): `counted`,
 * each holder counted, as what reaches a disposable is; `heap`, an allocation shared between
 * holders, whose holders a backend counts to free it or to change it in place when unique; `plain`,
 * a scalar or a handle reaching no disposable, whose holders nothing counts.
 */
export function lifetimeOf(
  types: readonly TypeDefinition[],
  reference: TypeReference,
): 'counted' | 'heap' | 'plain' {
  if (reachesDisposable(types, reference)) {
    return 'counted';
  }
  switch (reference.kind) {
    case 'primitive':
    case 'reference':
      return 'plain';
    case 'tuple':
    case 'function':
      return 'heap';
    case 'named': {
      const entry = types[reference.type];
      if (entry === undefined || !entry.heap) {
        return 'plain';
      }
      // A host value and a shared struct's handle change only behind their own seams.
      const behindSeam =
        (entry.kind === 'extern' && entry.role !== 'array' && entry.role !== 'map') ||
        entry.kind === 'shared';
      return behindSeam ? 'plain' : 'heap';
    }
    default: {
      const unhandled: never = reference;
      return unhandled;
    }
  }
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

/**
 * The entry encoding the outcome of an instance spawned as the `Instance<T>` type entry `type` of
 * `types` (§9); undefined when no codec writes `T`.
 */
export function outcomeEncoderOf(
  types: readonly TypeDefinition[],
  type: number,
): number | undefined {
  const entry = types[type];
  return entry?.kind === 'extern' ? entry.encoder : undefined;
}

/**
 * Whether a value of the extern type entry `type` of `types` is a resource object behind a handle
 * (§7): a host's type declaring a `dispose`, so its values have an identity of their own. Any other
 * host type's values are its host's JSON, as plain as an int.
 */
export function isResourceType(types: readonly TypeDefinition[], type: number): boolean {
  const entry = types[type];
  return entry?.kind === 'extern' && entry.role === undefined && entry.dispose !== undefined;
}

/** The `dispose` a value of type entry `type` of `types` runs when it loses its last holder. */
export function disposeOf(types: readonly TypeDefinition[], type: number): number | undefined {
  const entry = types[type];
  return entry?.kind === 'shared' || entry?.kind === 'extern' ? entry.dispose : undefined;
}
