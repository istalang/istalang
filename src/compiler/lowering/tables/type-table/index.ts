/**
 * The type table of a Definition (docs/arch/definition.md): one entry per distinct type, keyed by
 * its table key (names.ts), which is the same in every program, so an entry made for one program is
 * found by it in another. A declared type's entry is named by its declaration, any other by its
 * table key, which names nothing by an alias.
 *
 * - An entry is numbered before its layout is computed, so a recursive type refers to itself
 *   through the table (§5.2).
 * - What an entry holds is its layout (layouts.ts); a shape is one entry per shape, so every place
 *   writing equal fields shares it (§5.2).
 * - A recursive type (§4.6) is the entry of what it unfolds to, the same key, whose layout refers
 *   back to it; one unfolding to a tuple or a function type, which have no entry of their own, has
 *   an alias entry, numbered first for the same reason, as has the type written out (`folded`).
 * - A union (§4.2) is an enum, one variant per member, ordered and named by their table keys, which
 *   tell every two members apart and spell a type by its key alone, never by the alias it was
 *   written through, so every union of one key orders its variants alike, as its entry was laid
 *   out, and the runtime finds a member's variant by its name: a member's value is the variant's
 *   one field, and a member with one value only, a literal type or `None`, is a variant without
 *   fields, its tag. A literal type on its own is its base: its one value needs no tag.
 * - An `any` type (§8.3) is an enum the program closes: one variant per type a value of it is
 *   converted from, each holding that value as its one field, ordered and named by their table
 *   keys as a union's are, so a Definition never shows which conversion lowering met first. A
 *   variant is added the first time lowering asks for it, which can move the ones after it: an
 *   entry that read an `any` type's variants is written again once they changed
 *   (function-table.ts), so every index code names is the one the finished enum has.
 * - Every ask for an entry is recorded as the asking entry's (requests.ts), and each layout's own
 *   asks as its entry's.
 */

import type { TypeId } from '../../../../definition/operands.ts';
import {
  type Representation,
  representationOf,
  type StructuralReference,
  type TypeDefinition,
  type TypeReference,
  typesIn,
} from '../../../../definition/tables/types.ts';
import { compareOrdered } from '../../../../foundation/language/order.ts';
import { memo } from '../../../../foundation/structures/memo.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../../checker/check.ts';
import { folded } from '../../../checker/types/identity/folding.ts';
import { sameType } from '../../../checker/types/identity/identity.ts';
import { type RecursiveType, unfoldRecursive } from '../../../checker/types/type/computed-types.ts';
import type {
  AnyType,
  FunctionType,
  TupleType,
  Type,
  UnionType,
} from '../../../checker/types/type/index.ts';
import { baseOf } from '../../../checker/types/unions/union-members.ts';
import { type AnyEntry, anyEnum } from '../any-entries.ts';
import { tableKey } from '../names.ts';
import type { TableRequests } from '../requests.ts';
import {
  type EntryType,
  factsOf,
  type LayoutContext,
  layoutOf,
  refuseStandIn,
  type TypeTableSeams,
} from './layouts.ts';

/** What an entry stands as while its layout, which may refer back to it, is computed. */
const placeholder: TypeDefinition = {
  kind: 'struct',
  name: '',
  arguments: [],
  fields: [],
  disposable: false,
  heap: true,
};

/** Where the type table notes what the entry being written asks of it. */
interface TypeTableNotes {
  readonly requests: TableRequests;
  /** That the entry read an `any` type's variants, `count` of them, numbered as they are now. */
  readonly variantsRead: (any: TypeId, count: number) => void;
}

/** The variant of a union's or an `any` type's enum holding a value, and that value's type. */
export interface HeldVariant {
  readonly variant: number;
  readonly held: Type;
}

export class TypeTable {
  readonly #checker: Checker;
  /** Each entry, an `any` type's as the members its enum is built from. */
  readonly #entries: (TypeDefinition | AnyEntry)[] = [];
  /**
   * Each entry's table key (names.ts), which finds it and which the Definition is numbered by
   * (key-order.ts).
   */
  readonly #keys: string[] = [];
  readonly #indexes = new Map<string, TypeId>();
  /** The type each entry laid out here was made for; none for one taken over by key. */
  readonly #madeFor = new Map<TypeId, Type>();
  readonly #requests: TableRequests;
  /** Notes that the entry being written read an `any` type's variants, so many as it has now. */
  readonly #variantsRead: (any: TypeId, count: number) => void;

  readonly #layoutContext: LayoutContext;

  /** Tables for `checker`'s program, every ask for an entry recorded in `requests`. */
  constructor(checker: Checker, seams: TypeTableSeams, { requests, variantsRead }: TypeTableNotes) {
    this.#checker = checker;
    this.#requests = requests;
    this.#variantsRead = variantsRead;
    this.#layoutContext = {
      checker,
      seams,
      reference: (type) => this.reference(type),
      index: (type) => this.index(type),
      unionMembers: (type) => this.unionMembers(type),
    };
  }

  /** Every entry made so far, in index order. */
  get entries(): readonly TypeDefinition[] {
    return this.#entries.map((entry) => (entry.kind === 'any' ? anyEnum(entry) : entry));
  }

  /** Every entry's table key, in index order. */
  get keys(): readonly string[] {
    return this.#keys;
  }

  /** Each entry laid out from a checker's type, by index, with that type. */
  get made(): ReadonlyMap<TypeId, Type> {
    return this.#madeFor;
  }

  /** How the Definition refers to `type`. */
  reference(type: Type): TypeReference {
    if (type.kind === 'tuple' || type.kind === 'function') {
      const recursive = folded(type);
      return recursive.kind === 'recursive' ? this.reference(recursive) : this.#structural(type);
    }
    switch (type.kind) {
      case 'primitive':
        return { kind: 'primitive', name: type.name };
      case 'nominal':
      case 'anonymous':
        return { kind: 'named', type: this.index(type) };
      case 'recursive': {
        const unfolded = unfoldRecursive(type);
        return unfolded.kind === 'tuple' || unfolded.kind === 'function'
          ? { kind: 'named', type: this.#aliasEntry(type, unfolded) }
          : this.reference(unfolded);
      }
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
        return { kind: 'named', type: this.index(type) };
      case 'literal':
        return this.reference(baseOf(type));
      default: {
        const unhandled: never = type;
        return unhandled;
      }
    }
  }

  /**
   * How every backend represents values of `type` (definition `representationOf`); undefined while
   * an entry that says so is still being laid out, as a recursive type's is while its layout runs.
   */
  representationOf(type: Type): Representation | undefined {
    const reference = this.reference(type);
    const laidOut = typesIn(reference).every((index) => this.#entries[index] !== placeholder);
    return laidOut ? representationOf(this.entries, reference) : undefined;
  }

  /** The index of the type entry for `type`. */
  index(type: EntryType): TypeId {
    return this.#entryOf(type, () => layoutOf(this.#layoutContext, type));
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
    const checker = this.#checker;
    const name = tableKey(checker, type);
    const index = memo(this.#indexes, name, () => {
      const disposable = checker.reachesDisposable(type);
      const entry: AnyEntry = { kind: 'any', name, disposable, members: [] };
      this.#keys.push(name);
      return this.#entries.push(entry) - 1;
    });
    this.#requests.record('type', index);
    return index;
  }

  /**
   * The variant of `type`'s enum holding a value of `member`, a type meeting it, or of a literal's
   * base, interned as every entry is: a type test names the variant a value would be held in before
   * lowering has met any put there, so a member is added the first time either asks.
   */
  anyVariant(type: AnyType, member: Type): HeldVariant {
    const held = baseOf(member);
    refuseStandIn(this.#layoutContext, held, type);
    const { index, entry } = this.#anyEntry(type);
    const { members } = entry;
    const name = tableKey(this.#checker, held);
    const at = members.findIndex((each) => compareOrdered(each.name, name) >= 0);
    const variant = at < 0 ? members.length : at;
    if (members[variant]?.name !== name) {
      members.splice(variant, 0, { type: held, name, reference: this.reference(held) });
    }
    this.#variantsRead(index, members.length);
    return { variant, held };
  }

  /** The types `type`'s variants hold so far, in variant order. */
  anyMembers(type: AnyType): readonly Type[] {
    const { index, entry } = this.#anyEntry(type);
    this.#variantsRead(index, entry.members.length);
    return entry.members.map((member) => member.type);
  }

  /** How many variants the `any` type of entry `index` has so far, read by no entry. */
  variantCount(index: TypeId): number {
    const entry = this.#entries[index];
    return entry?.kind === 'any' ? entry.members.length : unreachable(`${index} is no any type.`);
  }

  #anyEntry(type: AnyType): { readonly index: TypeId; readonly entry: AnyEntry } {
    const index = this.anyIndex(type);
    const entry = this.#entries[index];
    if (entry?.kind !== 'any') {
      unreachable(`${tableKey(this.#checker, type)} has an entry of another kind.`);
    }
    return { index, entry };
  }

  #entryOf(type: Type, layout: () => TypeDefinition): TypeId {
    return this.keyed(tableKey(this.#checker, type), layout, type);
  }

  /**
   * The index of the entry whose table key is `key`, which `layout` computes the first time, for
   * `madeFor` where that is a checker's type. Not `memo`: the index is recorded before the layout
   * is computed, because a recursive type's layout refers to the type itself.
   */
  keyed(key: string, layout: () => TypeDefinition, madeFor?: Type): TypeId {
    const known = this.#indexes.get(key);
    if (known !== undefined) {
      this.#requests.record('type', known);
      return known;
    }
    const index = this.#entries.length;
    this.#indexes.set(key, index);
    this.#keys.push(key);
    this.#entries.push(placeholder);
    this.#requests.record('type', index);
    if (madeFor !== undefined) {
      this.#madeFor.set(index, madeFor);
    }
    this.#entries[index] = this.#requests.during({ kind: 'type', index }, layout);
    return index;
  }

  /**
   * The tuple or function `type` is, part by part: not folded, so a recursive alias's body is the
   * structure it unfolds to, never the alias again.
   */
  #structural(type: TupleType | FunctionType): StructuralReference {
    return type.kind === 'tuple'
      ? { kind: 'tuple', elements: type.elements.map((element) => this.reference(element)) }
      : {
          kind: 'function',
          parameters: type.parameters.map((parameter) => this.reference(parameter.type)),
          result: this.reference(type.result),
        };
  }

  /** The alias entry of the recursive type `type`, standing for `unfolded`, numbered first. */
  #aliasEntry(type: RecursiveType, unfolded: TupleType | FunctionType): TypeId {
    return this.#entryOf(type, () => ({
      kind: 'alias',
      name: tableKey(this.#checker, type),
      arguments: [],
      type: this.#structural(unfolded),
      ...factsOf(this.#checker, type),
    }));
  }
}
