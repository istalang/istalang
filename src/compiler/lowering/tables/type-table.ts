/**
 * The type table of a Definition (docs/arch/definition.md): one entry per distinct type, keyed as
 * the checker keys it (types/identity/type-keys.ts). A declared type's entry is named by its
 * declaration, any other by its table key (names.ts), which names nothing by an alias.
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
 * - A union (§2) is an enum, one variant per member, ordered and named by their table keys, which
 *   tell every two members apart and spell a type by its key alone, never by the alias it was
 *   written through, so every union of one key orders its variants alike, as its entry was laid
 *   out, and the runtime finds a member's variant by its name: a member's value is the variant's
 *   one field, and a member with one value only, a literal type or `None`, is a variant without
 *   fields, its tag. A literal type on its own is its base: its one value needs no tag.
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
} from '../../../definition/tables/types.ts';
import type { Value } from '../../../definition/values/values.ts';
import { compareOrdered } from '../../../foundation/language/order.ts';
import { unionLayout } from '../../../foundation/language/well-known/variants.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker, Disposal } from '../../checker/check.ts';
import type { CheckedAnnotation } from '../../checker/surface/checked-annotation.ts';
import type { FunctionInstance } from '../../checker/surface/witness-closing.ts';
import { folded } from '../../checker/types/identity/folding.ts';
import { sameType } from '../../checker/types/identity/identity.ts';
import { type RecursiveType, unfoldRecursive } from '../../checker/types/type/computed-types.ts';
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
import { type ClosedCall, closeFunctionCall } from '../calls/closed-calls.ts';
import { foundCodecCall } from '../synthesized/boundary/codec-calls.ts';
import { type AnyEntry, anyEnum } from './any-entries.ts';
import { enumRoles, externRoles, roleOf } from './entry-roles.ts';
import { qualifiedNameOf, tableKey } from './names.ts';

/** What a type entry refers to outside the type table. */
interface TypeTableSeams {
  /** The entry of a function instance, such as a declared `dispose` (§7). */
  readonly functionIndex: (instance: FunctionInstance) => FunctionId;
  /** The entry a closed call runs, such as the codec writing an instance's outcome (§9). */
  readonly callIndex: (call: ClosedCall) => FunctionId;
  /** The native a host implements a function by. */
  readonly hostNativeIndex: (declaration: FunctionDeclaration) => FunctionId;
  /** The persisted values of annotations the checker computed (§3.16). */
  readonly annotationValues: (annotations: readonly CheckedAnnotation[]) => Value[];
}

/** What every entry states of its type: whether it reaches a disposable, and whether it is heap. */
type EntryFacts = Pick<TypeDefinition, 'disposable' | 'heap'>;

/** What every declared type's entry starts with: its name, its type arguments and its facts. */
type EntryHead = EntryFacts & Pick<TypeDefinition, 'name' | 'arguments'>;

/** A type with an entry of its own: a declared struct, enum or extern type, a shape or a union. */
type EntryType = NominalType | AnonymousStructType | UnionType;

/** The name of the one field of an `any` type's or a union's variant: the member's value. */
const memberValueField = unionLayout.valueField;

/** What an entry stands as while its layout, which may refer back to it, is computed. */
const placeholder: TypeDefinition = {
  kind: 'struct',
  name: '',
  arguments: [],
  fields: [],
  disposable: false,
  heap: true,
};

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
    const keyed = type.members.map((member) => ({ member, key: tableKey(this.#checker, member) }));
    return keyed.sort((a, b) => compareOrdered(a.key, b.key)).map(({ member }) => member);
  }

  /** The variant of the union `type`'s enum holding a value of `member`, one of its members. */
  unionVariant(type: UnionType, member: Type): number {
    const index = this.unionMembers(type).findIndex((each) => sameType(each, member));
    return index >= 0 ? index : unreachable(`${tableKey(this.#checker, member)} is no member.`);
  }

  /** The index of the enum standing for the `any` type `type`, with the variants it has so far. */
  anyIndex(type: AnyType): TypeId {
    const key = this.#checker.typeKeys.typeKey(type);
    const known = this.#indexes.get(key);
    if (known !== undefined) {
      return known;
    }
    const entry: AnyEntry = {
      kind: 'any',
      name: tableKey(this.#checker, type),
      disposable: this.#checker.reachesDisposable(type),
      members: [],
    };
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
    const name = tableKey(this.#checker, member);
    return members.push({ type: member, name, reference: this.reference(member) }) - 1;
  }

  /** The types `type`'s variants hold so far, in variant order. */
  anyMembers(type: AnyType): readonly Type[] {
    return this.#anyEntry(type).members.map((member) => member.type);
  }

  #anyEntry(type: AnyType): AnyEntry {
    const entry = this.#entries[this.anyIndex(type)];
    if (entry?.kind !== 'any') {
      unreachable(`${tableKey(this.#checker, type)} has an entry of another kind.`);
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
    this.#entries.push(placeholder);
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
    this.#entries.push(placeholder);
    this.#entries[index] = {
      kind: 'alias',
      name: tableKey(this.#checker, type),
      arguments: [],
      type: this.reference(unfolded),
      ...this.#facts(type),
    };
    return index;
  }

  /** The entry describing `type`: its fields, its variants, or what implements it. */
  #layout(type: EntryType): TypeDefinition {
    const facts = this.#facts(type);
    if (type.kind === 'anonymous') {
      return {
        kind: 'struct',
        name: '',
        arguments: [],
        fields: this.#fields(type.fields),
        ...facts,
      };
    }
    if (type.kind === 'union') {
      return this.#unionLayout(type);
    }
    return this.#declaredLayout(type, facts);
  }

  /** The entry of a declared type: a struct, a shared struct, an enum or an extern type. */
  #declaredLayout(type: NominalType, facts: EntryFacts): TypeDefinition {
    const { declaration } = type.entity;
    const head: EntryHead = {
      name: qualifiedNameOf(this.#checker, declaration),
      arguments: type.arguments.map((argument) => this.reference(argument)),
      ...facts,
    };
    const dispose = this.#dispose(type);
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
        const value = this.#checker.sharedValueOf(type);
        const role = roleOf(this.#checker, externRoles, declaration);
        return value === undefined || role !== undefined
          ? extern(role)
          : { kind: 'shared', ...head, value: this.#typeEntry(value as EntryType), ...disposing };
      }
      case 'StructDeclaration':
        return {
          kind: 'struct',
          ...head,
          fields: this.#fields(this.#checker.fieldsOf(type) ?? []),
        };
      case 'EnumDeclaration':
        return this.#enumLayout(type, head, roleOf(this.#checker, enumRoles, declaration));
      case 'ExternStructDeclaration': {
        const role = roleOf(this.#checker, externRoles, declaration);
        return extern(role, role === 'instance' ? this.#outcomeEncoder(type) : undefined);
      }
      default: {
        const unhandled: never = declaration;
        return unhandled;
      }
    }
  }

  /** An enum's entry: a heap value only when some variant has fields. */
  #enumLayout(type: NominalType, head: EntryHead, role: EnumRole | undefined): TypeDefinition {
    const variants = (this.#checker.variantsOf(type) ?? []).map((variant) => ({
      name: variant.name,
      fields: this.#fields(variant.fields),
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
  #outcomeEncoder(instance: NominalType): FunctionId | undefined {
    const [outcome] = instance.arguments;
    const codec =
      outcome === undefined
        ? undefined
        : foundCodecCall(this.#checker, undefined, outcome, 'write');
    return codec === undefined ? undefined : this.#seams.callIndex(codec);
  }

  /** A union's enum: a variant per member, its value in the one field, a one-value member none. */
  #unionLayout(type: UnionType): TypeDefinition {
    const variants = this.unionMembers(type).map((member) => ({
      name: tableKey(this.#checker, member),
      fields: hasOneValue(member)
        ? []
        : [{ name: memberValueField, type: this.reference(member), annotations: [] }],
    }));
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
      name: tableKey(checker, type),
      arguments: [],
      variants,
      ...(isJson ? { role: 'json' as const } : {}),
      disposable: checker.reachesDisposable(type),
      heap: variants.some((variant) => variant.fields.length > 0),
    };
  }

  /** What every entry states: whether its values may reach a disposable, and are allocations. */
  #facts(type: Type): EntryFacts {
    return { disposable: this.#checker.reachesDisposable(type), heap: true };
  }

  /** The entry of the `dispose` a value of `type` runs as it loses its last holder (§7). */
  #dispose(type: NominalType): FunctionId | undefined {
    const disposal: Disposal = this.#checker.disposalOf(type);
    return disposal.kind === 'function'
      ? this.#seams.functionIndex(closeFunctionCall(disposal.call, undefined, this.#checker))
      : undefined;
  }

  #fields(fields: readonly FieldMember[]) {
    return fields.map((field) => ({
      name: field.name,
      type: this.reference(field.type),
      annotations: this.#seams.annotationValues(this.#checker.annotations.ofField(field)),
    }));
  }
}
