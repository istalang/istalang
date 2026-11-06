/**
 * The type table of a Definition (docs/arch/definition.md): one entry per distinct type, keyed as
 * the checker keys it (types/identity/type-keys.ts).
 *
 * - An entry is numbered before its layout is computed, so a recursive type refers to itself
 *   through the table (§3.1).
 * - Every nominal type can be laid out: a struct by its fields, an enum by its variants, an extern
 *   type by who disposes it, which the checker derives from the `dispose` declared for it
 *   (checker/rules/disposal/disposal.ts).
 * - A shape is a struct entry without a name, one per shape: every place writing equal fields
 *   shares it (§3.1), its fields in the name order the shape keeps.
 * - A recursive type (§3.17) is the entry of what it unfolds to, the same key, whose layout refers
 *   back to it; one unfolding to a tuple or a function type, which have no entry of their own, has
 *   an alias entry, numbered first for the same reason, as has the type written out (`folded`).
 *   Equal recursive types share one entry, named by the preferred alias (names.ts).
 * - A union (§2) is an enum, one variant per member, in the order of their spelled names, which
 *   no numbering of identities changes: a member's value is the variant's one field, and a member
 *   with one value only, a literal type or `None`, is a variant without fields, its tag. A literal
 *   type on its own is its base: its one value needs no tag.
 * - An `any` type (§3.10) is an enum the program closes: one variant per type a value of it is
 *   converted from, each holding that value as its one field. A variant is added the first time
 *   lowering converts from its type, so a variant's index never changes once code names it;
 *   what switches over every variant is written once lowering has reached them all (tables.ts).
 *
 * What an entry refers to outside types, its disposal's function and its annotations' values,
 * comes through `TypeTableSeams`, which the function and constant tables implement.
 */

import type { FunctionId, TypeId } from '../../../definition/operands.ts';
import type {
  EnumRole,
  ExternRole,
  TypeDefinition,
  TypeReference,
} from '../../../definition/types.ts';
import type { Value } from '../../../definition/values/values.ts';
import { compareOrdered } from '../../../language/order.ts';
import { unionLayout, type WellKnownDeclaration, wellKnown } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Checker, Disposal } from '../../checker/check.ts';
import type { CheckedAnnotation } from '../../checker/surface/checked-annotation.ts';
import { isHostExtern } from '../../checker/surface/host-externs.ts';
import { type RecursiveType, unfoldRecursive } from '../../checker/types/computed-types.ts';
import { sameType } from '../../checker/types/identity/identity.ts';
import { folded } from '../../checker/types/identity/recursive-types.ts';
import type {
  AnonymousStructType,
  AnyType,
  FieldMember,
  NominalType,
  Type,
  UnionType,
} from '../../checker/types/type/index.ts';
import { baseOf } from '../../checker/types/unions/union-members.ts';
import { hasOneValue } from '../../checker/types/unions/unions.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import { closeFunctionCall } from '../calls/closed-calls.ts';
import type { FunctionInstance } from './instances.ts';
import { qualifiedNameOf, recursiveName, spelledType, unionName } from './names.ts';

/** What a type entry refers to outside the type table. */
export interface TypeTableSeams {
  /** The entry of a function instance, such as a declared `dispose` (§7). */
  readonly functionIndex: (instance: FunctionInstance) => FunctionId;
  /** The native a host implements a function by. */
  readonly hostNativeIndex: (declaration: FunctionDeclaration) => FunctionId;
  /** The persisted values of annotations the checker computed (§3.16). */
  readonly annotationValues: (annotations: readonly CheckedAnnotation[]) => Value[];
}

/** A type with an entry of its own: a declared struct, enum or extern type, a shape or a union. */
type EntryType = NominalType | AnonymousStructType | UnionType;

/** The name of the one field of an `any` type's or a union's variant: the member's value. */
const memberValueField = unionLayout.valueField;

/**
 * An `any` type's entry while lowering runs: the types converted into it so far, each with its
 * name and how the Definition refers to it, from which its enum is built (`anyEnum`).
 */
interface AnyEntry {
  readonly kind: 'any';
  readonly name: string;
  readonly members: {
    readonly type: Type;
    readonly name: string;
    readonly reference: TypeReference;
  }[];
}

/** The enum entry `entry` stands for: one variant per member, holding its value. */
function anyEnum(entry: AnyEntry): TypeDefinition {
  const variants = entry.members.map(({ name, reference }) => ({
    name,
    fields: [{ name: memberValueField, type: reference, annotations: [] }],
  }));
  return { kind: 'enum', name: entry.name, arguments: [], variants };
}

/**
 * The std type each role of an extern type entry is (definition/types.ts); a shared struct's role
 * comes from its declaration's kind instead (§3.18).
 */
const externRoles = {
  cell: wellKnown.cell,
  future: wellKnown.future,
  instance: wellKnown.instance,
} as const satisfies Record<Exclude<ExternRole, 'shared'>, WellKnownDeclaration>;

/**
 * The std type each role of an enum entry is (definition/types.ts): `json.Json`, a recursive
 * alias whose union is an enum entry (§3.17).
 */
const enumRoles = {
  json: wellKnown.json,
} as const satisfies Record<EnumRole, WellKnownDeclaration>;

export class TypeTable {
  readonly #checker: Checker;
  readonly #seams: TypeTableSeams;
  /** Each entry, an `any` type's as the members its enum is built from. */
  readonly #entries: (TypeDefinition | AnyEntry)[] = [];
  readonly #indexes = new Map<string, TypeId>();

  constructor(checker: Checker, seams: TypeTableSeams) {
    this.#checker = checker;
    this.#seams = seams;
  }

  /** Every entry made so far, in index order. */
  get entries(): readonly TypeDefinition[] {
    return this.#entries.map((entry) => (entry.kind === 'any' ? anyEnum(entry) : entry));
  }

  /** How the Definition refers to `type`. */
  reference(type: Type): TypeReference {
    const recursive = type.kind === 'tuple' || type.kind === 'function' ? folded(type) : type;
    if (recursive.kind === 'recursive' && recursive !== type) {
      return this.reference(recursive);
    }
    switch (type.kind) {
      case 'primitive':
        return { kind: 'primitive', name: type.name };
      case 'nominal':
      case 'anonymous':
        return { kind: 'named', type: this.#typeEntry(type) };
      case 'recursive': {
        const unfolded = unfoldRecursive(type);
        return unfolded.kind === 'tuple' || unfolded.kind === 'function'
          ? { kind: 'named', type: this.#aliasEntry(type, unfolded) }
          : this.reference(unfolded);
      }
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
      case 'associated':
      case 'field':
      case 'keys':
      case 'mapped':
      case 'match':
      case 'error':
        return unreachable(`A ${type.kind} type can't reach lowering.`);
      case 'any':
        return { kind: 'named', type: this.anyIndex(type) };
      case 'union':
        return { kind: 'named', type: this.#typeEntry(type) };
      case 'literal':
        return this.reference(baseOf(type));
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

  /** The members of the union `type` in the order of its enum's variants. */
  unionMembers(type: UnionType): readonly Type[] {
    const spelled = type.members.map((member) => ({
      member,
      name: spelledType(this.#checker, member),
    }));
    return spelled.sort((a, b) => compareOrdered(a.name, b.name)).map(({ member }) => member);
  }

  /** The variant of the union `type`'s enum holding a value of `member`, one of its members. */
  unionVariant(type: UnionType, member: Type): number {
    const index = this.unionMembers(type).findIndex((each) => sameType(each, member));
    return index >= 0 ? index : unreachable(`${spelledType(this.#checker, member)} is no member.`);
  }

  /** The index of the enum standing for the `any` type `type`, with the variants it has so far. */
  anyIndex(type: AnyType): TypeId {
    const key = this.#checker.typeKeys.typeKey(type);
    const known = this.#indexes.get(key);
    if (known !== undefined) {
      return known;
    }
    const entry: AnyEntry = { kind: 'any', name: spelledType(this.#checker, type), members: [] };
    const index = this.#entries.push(entry) - 1;
    this.#indexes.set(key, index);
    return index;
  }

  /**
   * The variant of `type`'s enum holding a value of `member`, a type meeting it; added when new.
   */
  anyVariant(type: AnyType, member: Type): number {
    const { members } = this.#anyEntry(type);
    const found = members.findIndex((each) => sameType(each.type, member));
    if (found >= 0) {
      return found;
    }
    const name = spelledType(this.#checker, member);
    return members.push({ type: member, name, reference: this.reference(member) }) - 1;
  }

  /** The types `type`'s variants hold so far, in variant order. */
  anyMembers(type: AnyType): readonly Type[] {
    return this.#anyEntry(type).members.map((member) => member.type);
  }

  #anyEntry(type: AnyType): AnyEntry {
    const entry = this.#entries[this.anyIndex(type)];
    if (entry?.kind !== 'any') {
      unreachable(`${spelledType(this.#checker, type)} has an entry of another kind.`);
    }
    return entry;
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

  /** The alias entry of the recursive type `type`, standing for `unfolded`, numbered first. */
  #aliasEntry(type: RecursiveType, unfolded: Type): TypeId {
    const key = this.#checker.typeKeys.typeKey(type);
    const known = this.#indexes.get(key);
    if (known !== undefined) {
      return known;
    }
    const index = this.#entries.length;
    this.#indexes.set(key, index);
    this.#entries.push({ kind: 'struct', name: '', arguments: [], fields: [] });
    const named = recursiveName(this.#checker, type);
    this.#entries[index] = {
      kind: 'alias',
      name: named.name,
      arguments: named.arguments.map((argument) => this.reference(argument)),
      type: this.reference(unfolded),
    };
    return index;
  }

  /** The entry describing `type`: its fields, its variants, or how an extern type is disposed. */
  #layout(type: EntryType): TypeDefinition {
    if (type.kind === 'anonymous') {
      return { kind: 'struct', name: '', arguments: [], fields: this.#fields(type.fields) };
    }
    if (type.kind === 'union') {
      return this.#unionLayout(type);
    }
    const { declaration } = type.entity;
    const name = qualifiedNameOf(this.#checker, declaration);
    const typeArguments = type.arguments.map((argument) => this.reference(argument));
    switch (declaration.kind) {
      case 'SharedStructDeclaration':
        return {
          kind: 'extern',
          name,
          arguments: typeArguments,
          sendable: false,
          disposal: this.#disposal(this.#checker.disposalOf(type)),
          role: 'shared',
        };
      case 'StructDeclaration':
        return {
          kind: 'struct',
          name,
          arguments: typeArguments,
          fields: this.#fields(this.#checker.fieldsOf(type) ?? []),
        };
      case 'EnumDeclaration': {
        const role = this.#roleOf(enumRoles, declaration);
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
        const role = this.#roleOf(externRoles, declaration);
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

  /** A union's enum: a variant per member, its value in the one field, a one-value member none. */
  #unionLayout(type: UnionType): TypeDefinition {
    const variants = this.unionMembers(type).map((member) => ({
      name: spelledType(this.#checker, member),
      fields: hasOneValue(member)
        ? []
        : [{ name: memberValueField, type: this.reference(member), annotations: [] }],
    }));
    const named = unionName(this.#checker, type);
    const typeArguments = named.arguments.map((argument) => this.reference(argument));
    // The `json` role is the type `json.Json` is, by key, whatever alias wrote it.
    const checker = this.#checker;
    const json = checker.wellKnownEntity(enumRoles.json);
    const isJson =
      json?.kind === 'type' &&
      json.declaration.kind === 'TypeAliasDeclaration' &&
      checker.typeKeys.typeKey(checker.aliasedType(json.declaration)) ===
        checker.typeKeys.typeKey(type);
    return {
      kind: 'enum',
      name: named.name,
      arguments: typeArguments,
      variants,
      ...(isJson ? { role: 'json' as const } : {}),
    };
  }

  /** Which of `roles` the type `declaration` declares has: what the runtime makes of its values. */
  #roleOf<Role extends string>(
    roles: Readonly<Record<Role, WellKnownDeclaration>>,
    declaration: object,
  ): Role | undefined {
    return (Object.keys(roles) as Role[]).find((role) => {
      const entity = this.#checker.wellKnownEntity(roles[role]);
      return entity !== undefined && 'declaration' in entity && entity.declaration === declaration;
    });
  }

  /**
   * A type entry's disposal: a declared `dispose` is the entry of its instance (§7), and one a host
   * implements names its native too (boundary/host-externs.ts).
   */
  #disposal(disposal: Disposal): Extract<TypeDefinition, { kind: 'extern' }>['disposal'] {
    if (disposal.kind !== 'function') {
      return disposal;
    }
    const instance = closeFunctionCall(disposal.call, undefined, this.#checker);
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
