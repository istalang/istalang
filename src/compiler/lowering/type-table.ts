/**
 * The type table of a Definition (docs/arch/definition.md): one entry per distinct type, keyed as
 * the checker keys it (types/type-keys.ts).
 *
 * - An entry is numbered before its layout is computed, so a recursive type refers to itself
 *   through the table (§3.1).
 * - Every nominal type can be laid out: a struct by its fields, an enum by its variants, an extern
 *   type by who disposes it, which the checker derives from the `dispose` declared for it
 *   (checker/rules/disposal.ts).
 * - An anonymous struct is a struct entry without a name, one per type, so two never share an
 *   entry (§3.1).
 * - An `any` type (§3.10) is an enum the program closes: one variant per type a value of it is
 *   converted from, each holding that value as its one field. A variant is added the first time
 *   lowering converts from its type, so a variant's index never changes once code names it;
 *   what switches over every variant is written once lowering has reached them all (tables.ts).
 *
 * What an entry refers to outside types, its disposal's function and its annotations' values,
 * comes through `TypeTableSeams`, which the function and constant tables implement.
 */

import type { FunctionId, TypeId } from '../../definition/operands.ts';
import type {
  EnumRole,
  ExternRole,
  TypeDefinition,
  TypeReference,
} from '../../definition/types.ts';
import type { Value } from '../../definition/values.ts';
import { type WellKnownDeclaration, wellKnown } from '../../language/well-known.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Checker, Disposal } from '../checker/check.ts';
import type { CheckedAnnotation } from '../checker/checked-annotation.ts';
import { isHostExtern } from '../checker/host-externs.ts';
import {
  type AnonymousStructType,
  type AnyType,
  type FieldMember,
  type NominalType,
  sameType,
  type Type,
} from '../checker/types/type.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import { type FunctionInstance, instanceOfCall } from './instances.ts';
import { qualifiedNameOf, spelledType } from './names.ts';

/** What a type entry refers to outside the type table. */
export interface TypeTableSeams {
  /** The entry of a function instance, such as a declared `dispose` (§7). */
  readonly functionIndex: (instance: FunctionInstance) => FunctionId;
  /** The native a host implements a function by. */
  readonly hostNativeIndex: (declaration: FunctionDeclaration) => FunctionId;
  /** The persisted values of annotations the checker computed (§3.16). */
  readonly annotationValues: (annotations: readonly CheckedAnnotation[]) => Value[];
}

/** A type with an entry of its own: a declared struct, enum or extern type, or an anonymous struct. */
type EntryType = NominalType | AnonymousStructType;

/** The name of the one field of an `any` type's variant: the value converted into it. */
const anyValueField = 'value';

/** The enum entry of an `any` type named `name`, with `variants`. */
function anyEntry(name: string, variants: Extract<TypeDefinition, { kind: 'enum' }>['variants']) {
  return { kind: 'enum', name, arguments: [], variants } as const satisfies TypeDefinition;
}

/**
 * The std type each role of an extern type entry is (definition/types.ts). A shared struct's entry
 * is a cell's too (§3.18).
 */
const externRoles = {
  cell: wellKnown.cell,
  future: wellKnown.future,
  instance: wellKnown.instance,
} as const satisfies Record<ExternRole, WellKnownDeclaration>;

/** The std type each role of an enum entry is (definition/types.ts). */
const enumRoles = {
  json: wellKnown.json,
} as const satisfies Record<EnumRole, WellKnownDeclaration>;

export class TypeTable {
  readonly #checker: Checker;
  readonly #seams: TypeTableSeams;
  readonly #entries: TypeDefinition[] = [];
  readonly #indexes = new Map<string, TypeId>();
  /** The types each `any` type's variants hold, by its entry's index. */
  readonly #anyMembers = new Map<TypeId, Type[]>();

  constructor(checker: Checker, seams: TypeTableSeams) {
    this.#checker = checker;
    this.#seams = seams;
  }

  /** Every entry made so far, in index order. */
  get entries(): readonly TypeDefinition[] {
    return this.#entries;
  }

  /** How the Definition refers to `type`. */
  reference(type: Type): TypeReference {
    switch (type.kind) {
      case 'primitive':
        return { kind: 'primitive', name: type.name };
      case 'nominal':
      case 'anonymous':
        return { kind: 'named', type: this.#typeEntry(type) };
      case 'tuple':
        return {
          kind: 'tuple',
          elements: type.elements.map((element) => this.reference(element)),
        };
      case 'function':
        return {
          kind: 'function',
          async: type.isAsync,
          parameters: type.parameters.map((parameter) => this.reference(parameter.type)),
          result: this.reference(type.result),
        };
      case 'parameter':
      case 'error':
        return unreachable(`A ${type.kind} type can't reach lowering.`);
      case 'any':
        return { kind: 'named', type: this.anyIndex(type) };
      default: {
        const unhandled: never = type;
        return unhandled;
      }
    }
  }

  /** The index of the type entry for `type`. */
  index(type: EntryType): TypeId {
    return this.#typeEntry(type);
  }

  /** The index of the enum standing for the `any` type `type`, with the variants it has so far. */
  anyIndex(type: AnyType): TypeId {
    const key = this.#checker.typeKeys.typeKey(type);
    const known = this.#indexes.get(key);
    if (known !== undefined) {
      return known;
    }
    const index = this.#entries.push(anyEntry(spelledType(this.#checker, type), [])) - 1;
    this.#indexes.set(key, index);
    this.#anyMembers.set(index, []);
    return index;
  }

  /** The variant of `type`'s enum holding a value of `member`, a type meeting it; added when new. */
  anyVariant(type: AnyType, member: Type): number {
    const index = this.anyIndex(type);
    const members = this.#membersAt(index);
    const found = members.findIndex((each) => sameType(each, member));
    if (found >= 0) {
      return found;
    }
    members.push(member);
    const field = { name: anyValueField, type: this.reference(member), annotations: [] };
    const variant = { name: spelledType(this.#checker, member), fields: [field] };
    const entry = this.#entries[index];
    const variants = entry?.kind === 'enum' ? entry.variants : [];
    this.#entries[index] = anyEntry(spelledType(this.#checker, type), [...variants, variant]);
    return members.length - 1;
  }

  /** The types `type`'s variants hold so far, in variant order. */
  anyMembers(type: AnyType): readonly Type[] {
    return this.#membersAt(this.anyIndex(type));
  }

  #membersAt(index: TypeId): Type[] {
    const members = this.#anyMembers.get(index);
    if (members === undefined) {
      unreachable(`Type ${index} is no any type's enum.`);
    }
    return members;
  }
  /**
   * Not `memo`: the index is recorded before the layout is computed, because a recursive type's
   * layout refers to the type itself.
   */
  #typeEntry(type: EntryType): TypeId {
    const key = this.#checker.typeKeys.typeKey(type);
    const known = this.#indexes.get(key);
    if (known !== undefined) {
      return known;
    }
    const index = this.#entries.length;
    this.#indexes.set(key, index);
    this.#entries.push({ kind: 'struct', name: '', arguments: [], fields: [] });
    this.#entries[index] = this.#layout(type);
    return index;
  }

  /** The entry describing `type`: its fields, its variants, or how an extern type is disposed. */
  #layout(type: EntryType): TypeDefinition {
    if (type.kind === 'anonymous') {
      return { kind: 'struct', name: '', arguments: [], fields: this.#fields(type.fields) };
    }
    const { declaration } = type.entity;
    const name = qualifiedNameOf(this.#checker, declaration);
    const typeArguments = type.arguments.map((argument) => this.reference(argument));
    switch (declaration.kind) {
      case 'StructDeclaration':
        if (declaration.isShared) {
          return {
            kind: 'extern',
            name,
            arguments: typeArguments,
            sendable: false,
            disposal: this.#disposal(this.#checker.disposalOf(type)),
            role: 'cell',
          };
        }
        return {
          kind: 'struct',
          name,
          arguments: typeArguments,
          fields: this.#fields(this.#checker.fieldsOf(type) ?? []),
        };
      case 'EnumDeclaration': {
        const role = this.#roleOf(enumRoles, type.entity);
        return {
          kind: 'enum',
          name,
          arguments: typeArguments,
          variants: (this.#checker.variantsOf(type) ?? []).map((variant) => ({
            name: variant.name,
            fields: this.#fields(variant.fields),
          })),
          ...(role === undefined ? {} : { role }),
        };
      }
      case 'ExternStructDeclaration': {
        const role = this.#roleOf(externRoles, type.entity);
        return {
          kind: 'extern',
          name,
          arguments: typeArguments,
          sendable: declaration.isSendable,
          disposal: this.#disposal(this.#checker.disposalOf(type)),
          ...(role === undefined ? {} : { role }),
        };
      }
      default: {
        const unhandled: never = declaration;
        return unhandled;
      }
    }
  }

  /** Which of `roles` the type `entity` declares has: what the runtime makes of its values. */
  #roleOf<Role extends string>(
    roles: Readonly<Record<Role, WellKnownDeclaration>>,
    entity: NominalType['entity'],
  ): Role | undefined {
    return (Object.keys(roles) as Role[]).find(
      (role) => this.#checker.wellKnownEntity(roles[role]) === entity,
    );
  }

  /**
   * A type entry's disposal: a declared `dispose` is the entry of its instance (§7), and one a host
   * implements names its native too (boundary/host-externs.ts).
   */
  #disposal(disposal: Disposal): Extract<TypeDefinition, { kind: 'extern' }>['disposal'] {
    if (disposal.kind !== 'function') {
      return disposal;
    }
    const instance = instanceOfCall(disposal.call);
    const entry = { kind: 'function', function: this.#seams.functionIndex(instance) } as const;
    return isHostExtern(this.#checker, instance.declaration)
      ? { ...entry, host: this.#seams.hostNativeIndex(instance.declaration) }
      : entry;
  }

  #fields(fields: readonly FieldMember[]) {
    return fields.map((field) => ({
      name: field.name,
      type: this.reference(field.type),
      annotations: this.#seams.annotationValues(this.#checker.annotations.ofField(field)),
    }));
  }
}
