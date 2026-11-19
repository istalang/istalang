/**
 * What a type's entry in the type table holds (index.ts): its fields, its variants, or what
 * implements it, each part referred to through the table, so a layout never numbers an entry
 * itself.
 *
 * - Every nominal type can be laid out: a struct by its fields, an enum by its variants, an extern
 *   type by who disposes it, which the checker derives from the `dispose` declared for it
 *   (checker/rules/disposal/disposal.ts).
 * - A shape is a struct entry without a name, its fields in the name order the shape keeps (§5.2).
 * - A union (§4.2) is an enum, one variant per member in the table's order, named by its table key:
 *   a member's value is the variant's one field, and a member with one value only, a literal type
 *   or `None`, is a variant without fields, its tag.
 *
 * What an entry refers to outside types, its disposal's function and its annotations' values,
 * comes through `TypeTableSeams`, which the function and constant tables implement.
 */

import type { FunctionId, TypeId } from '../../../../definition/operands.ts';
import type {
  EnumRole,
  ExternRole,
  TypeDefinition,
  TypeReference,
} from '../../../../definition/tables/types.ts';
import type { Value } from '../../../../definition/values/values.ts';
import { unionLayout } from '../../../../foundation/language/well-known/variants.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Checker, Disposal } from '../../../checker/check.ts';
import type { CheckedAnnotation } from '../../../checker/surface/checked-annotation.ts';
import type { FunctionInstance } from '../../../checker/surface/witness-closing.ts';
import type {
  AnonymousStructType,
  AnyType,
  FieldMember,
  NominalType,
  Type,
  UnionType,
} from '../../../checker/types/type/index.ts';
import { hasOneValue } from '../../../checker/types/unions/unions.ts';
import { type ClosedCall, closeFunctionCall } from '../../calls/closed-calls.ts';
import { foundCodecCall } from '../../synthesized/boundary/codec-calls.ts';
import { enumRoles, externRoles, roleOf } from '../entry-roles.ts';
import { qualifiedNameOf, tableKey } from '../names.ts';

/** What a type entry refers to outside the type table. */
export interface TypeTableSeams {
  /** The entry of a function instance, such as a declared `dispose` (§16). */
  readonly functionIndex: (instance: FunctionInstance) => FunctionId;
  /** The entry a closed call runs, such as the codec writing an instance's outcome (§17.4). */
  readonly callIndex: (call: ClosedCall) => FunctionId;
  /** The persisted values of annotations the checker computed (§5.5). */
  readonly annotationValues: (annotations: readonly CheckedAnnotation[]) => Value[];
  /** Whether a type holds a shared instance's stand-in, which no layout by members may meet. */
  readonly holdsStandIn: (type: Type) => boolean;
}

/** A type with an entry of its own: a declared struct, enum or extern type, a shape or a union. */
export type EntryType = NominalType | AnonymousStructType | UnionType;

/** What a layout reads: the checker, the seams, and the table it refers to other types through. */
export interface LayoutContext {
  readonly checker: Checker;
  readonly seams: TypeTableSeams;
  readonly reference: (type: Type) => TypeReference;
  readonly index: (type: EntryType) => TypeId;
  readonly unionMembers: (type: UnionType) => readonly Type[];
}

/** What every entry states of its type: whether it reaches a disposable, and whether it is heap. */
type EntryFacts = Pick<TypeDefinition, 'disposable' | 'heap'>;

/** What every declared type's entry starts with: its name, its type arguments and its facts. */
type EntryHead = EntryFacts & Pick<TypeDefinition, 'name' | 'arguments'>;

/** The name of the one field of an `any` type's or a union's variant: the member's value. */
const memberValueField = unionLayout.valueField;

/** The entry describing `type`: its fields, its variants, or what implements it. */
export function layoutOf(context: LayoutContext, type: EntryType): TypeDefinition {
  const facts = factsOf(context.checker, type);
  if (type.kind === 'anonymous') {
    return {
      kind: 'struct',
      name: '',
      arguments: [],
      fields: fieldsOf(context, type.fields),
      ...facts,
    };
  }
  if (type.kind === 'union') {
    return unionLayoutOf(context, type);
  }
  return declaredLayout(context, type, facts);
}

/** What every entry states: whether its values may reach a disposable, and are allocations. */
export function factsOf(checker: Checker, type: Type): EntryFacts {
  return { disposable: checker.reachesDisposable(type), heap: true };
}

/** Crashes where a stand-in reaches a layout ordered by its members' types (stencils.ts). */
export function refuseStandIn(
  context: Pick<LayoutContext, 'checker' | 'seams'>,
  member: Type,
  within: AnyType | UnionType,
): void {
  if (context.seams.holdsStandIn(member)) {
    unreachable(`${tableKey(context.checker, within)} holds a shared instance's stand-in.`);
  }
}

/** The entry of a declared type: a struct, a shared struct, an enum or an extern type. */
function declaredLayout(
  context: LayoutContext,
  type: NominalType,
  facts: EntryFacts,
): TypeDefinition {
  const { checker } = context;
  const { declaration } = type.entity;
  const head: EntryHead = {
    name: qualifiedNameOf(checker, declaration),
    arguments: type.arguments.map((argument) => context.reference(argument)),
    ...facts,
  };
  const dispose = disposeOf(context, type);
  const disposing = dispose === undefined ? {} : { dispose };
  /**
   * An extern entry, with its role if it has one: a host type, or a shared struct the std knows;
   * an instance's with the entry encoding its outcome.
   */
  const extern = (role: ExternRole | undefined, encoder?: FunctionId): TypeDefinition => ({
    kind: 'extern',
    ...head,
    ...(role === undefined ? {} : { role }),
    ...disposing,
    ...(encoder === undefined ? {} : { encoder }),
  });
  switch (declaration.kind) {
    case 'SharedStructDeclaration': {
      const value = checker.sharedValueOf(type);
      const role = roleOf(checker, externRoles, declaration);
      return value === undefined || role !== undefined
        ? extern(role)
        : { kind: 'shared', ...head, value: context.index(value as EntryType), ...disposing };
    }
    case 'StructDeclaration':
      return { kind: 'struct', ...head, fields: fieldsOf(context, checker.fieldsOf(type) ?? []) };
    case 'EnumDeclaration':
      return enumLayout(context, type, head, roleOf(checker, enumRoles, declaration));
    case 'ExternStructDeclaration': {
      const role = roleOf(checker, externRoles, declaration);
      return extern(role, role === 'instance' ? outcomeEncoder(context, type) : undefined);
    }
    default: {
      const unhandled: never = declaration;
      return unhandled;
    }
  }
}

/** An enum's entry: a heap value only when some variant has fields. */
function enumLayout(
  context: LayoutContext,
  type: NominalType,
  head: EntryHead,
  role: EnumRole | undefined,
): TypeDefinition {
  const variants = (context.checker.variantsOf(type) ?? []).map((variant) => ({
    name: variant.name,
    fields: fieldsOf(context, variant.fields),
  }));
  return {
    kind: 'enum',
    ...head,
    variants,
    ...(role === undefined ? {} : { role }),
    heap: variants.some((variant) => variant.fields.length > 0),
  };
}

/** The entry encoding the outcome of an instance of `instance`, `Instance<T>`: `T`'s codec's. */
function outcomeEncoder(context: LayoutContext, instance: NominalType): FunctionId | undefined {
  const [outcome] = instance.arguments;
  const codec =
    outcome === undefined
      ? undefined
      : foundCodecCall(context.checker, undefined, outcome, 'write');
  return codec === undefined ? undefined : context.seams.callIndex(codec);
}

/** A union's enum: a variant per member, its value in the one field, a one-value member none. */
function unionLayoutOf(context: LayoutContext, type: UnionType): TypeDefinition {
  for (const member of type.members) {
    refuseStandIn(context, member, type);
  }
  const { checker } = context;
  const variants = context.unionMembers(type).map((member) => ({
    name: tableKey(checker, member),
    fields: hasOneValue(member)
      ? []
      : [{ name: memberValueField, type: context.reference(member), annotations: [] }],
  }));
  // The `json` role is the type `json.Json` is, by key, whatever alias wrote it.
  const json = checker.wellKnownEntity(enumRoles.json);
  const isJson =
    json?.kind === 'type' &&
    json.declaration.kind === 'TypeAliasDeclaration' &&
    checker.typeKeys.typeKey(checker.aliasedType(json.declaration)) ===
      checker.typeKeys.typeKey(type);
  return {
    kind: 'enum',
    name: tableKey(checker, type),
    arguments: [],
    variants,
    ...(isJson ? { role: 'json' as const } : {}),
    disposable: checker.reachesDisposable(type),
    heap: variants.some((variant) => variant.fields.length > 0),
  };
}

/** The entry of the `dispose` a value of `type` runs as it loses its last holder (§16). */
function disposeOf(context: LayoutContext, type: NominalType): FunctionId | undefined {
  const disposal: Disposal = context.checker.disposalOf(type);
  return disposal.kind === 'function'
    ? context.seams.functionIndex(closeFunctionCall(disposal.call, undefined, context.checker))
    : undefined;
}

function fieldsOf(context: LayoutContext, fields: readonly FieldMember[]) {
  return fields.map((field) => ({
    name: field.name,
    type: context.reference(field.type),
    annotations: context.seams.annotationValues(context.checker.annotations.ofField(field)),
  }));
}
