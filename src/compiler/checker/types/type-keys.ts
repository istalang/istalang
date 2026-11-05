/**
 * Keys for types, for the maps and sets that are keyed by type, and the one definition of type
 * identity: two types are the same type exactly when their keys are equal (identity.ts).
 *
 * - A nominal type or a type parameter is itself by an object's identity: an entity, or the
 *   parameter's declaration; an `any` type is its traits' with their arguments, sorted, since its
 *   constraints are a set. A string can carry that identity only as a number. The numbers are the
 *   module's, so an object keys alike in every checker and in every revision of a program; lowering
 *   keys its function-table entries through the same unit. No number ever reaches lowering's
 *   output: it only finds entries by these keys.
 * - A shape (§3.1) is its field names and their keys, in name order, as the type keeps its fields:
 *   `{x:Int,y:Int}` however it was written. The key is the canonical text itself, never a digest,
 *   since a collision would make two types one without any error.
 * - A literal type is its value, a string's quoted as JSON, so no text it holds can end it early.
 * - A union is its members' keys, sorted, since its members are a set.
 * - A type holding a recursive type (§3.17) is the canonical spelling of its minimized term graph
 *   (recursive-terms.ts), its nodes numbered from it with `~` and their structure spelled as here:
 *   equal unfoldings are one key, so a recursive type, what it unfolds to, and the same structure
 *   written out or through another alias are one type; a recursive type `match` use closes into
 *   such a graph too. A key holding `~` is no other type's.
 * - A type computed from types not known yet (`T.Data`, `S["meta"]`, `keyof S`) is its parts' keys:
 *   such a type is opaque, equal only to itself (§3.5). A mapped struct type not reduced yet keys its
 *   own parameter by how deep it binds, so its spelling's name for it never makes two types; it
 *   starts with `*`, as no other type's key does, so it never keys alike with a shape.
 * - An alias names no type of its own (§3.17), so no key mentions one.
 * - A type's own key is memoized per type object, which is immutable. Comparing generic signatures
 *   up to the names of their type parameters (rules/clashes.ts) keys each of those parameters by
 *   its position, which is the same as substituting canonical parameters, without building them;
 *   such keys are computed afresh.
 * - A type's spelled key (`spelledKey`) is its key with everything it is spelled with: the alias,
 *   associated type or keys it was written through, the node each shape, mapped type and field was
 *   written at, an `any`'s constraints and a union's members in written order, and the type
 *   `match` use an error type carries. Two types are alike in every part (`sameTypeSpelled`)
 *   exactly when their spelled keys are equal. A result computed from a type's spelling, such as a
 *   type `match`'s reduction, is kept by this key, never by the type's, so it never answers one
 *   spelling with another's: a later revision would otherwise keep nodes an earlier tree made.
 */

import { memo } from '../../../structures/memo.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { MappedParts } from './computed-types.ts';
import { canonicalKey } from './recursive-terms.ts';
import type {
  AliasUse,
  AnonymousStructType,
  FieldMember,
  FunctionType,
  ParameterKey,
  RecursiveUse,
  Type,
  UnreducedUse,
} from './type.ts';
import { holdsRecursion } from './type-children.ts';

/** Every identity numbered so far; an object no longer reachable lets its number go. */
const identities = new WeakMap<object, number>();
let numbered = 0;

/** Each type's own key, with no parameter keyed by position. */
const ownKeys = new WeakMap<Type, string>();

/** Each type's spelled key. */
const spelledKeys = new WeakMap<Type, string>();

/** Keys for types, and the numbers for identities they are made of. */
export interface TypeKeys {
  /** A number for `object`'s identity, the same every time it is asked for. */
  readonly identityOf: (object: object) => number;
  /** The key of `type`. Type parameters in `positions` are keyed by their position there. */
  readonly typeKey: (type: Type, positions?: ReadonlyMap<ParameterKey, number>) => string;
  /**
   * The key of a shape, `typeKey`'s, which starts with `{`, as no other type's does; or `~[` where
   * the shape holds a recursive type, as a recursive type's key does.
   */
  readonly shapeKey: (type: AnonymousStructType) => ShapeKey;
  /** The key of `type`'s own structure, each type it is built from spelled by `partKey`. */
  readonly structureKey: (type: Type, partKey: (part: Type) => string) => string;
  /** The key of `type` with everything it is spelled with (the banner). */
  readonly spelledKey: (type: Type) => string;
}

/** A shape's key (`TypeKeys.shapeKey`), or a recursive type's. */
export type ShapeKey = `{${string}` | `~[${string}`;

function identityOf(object: object): number {
  return memo(identities, object, () => {
    numbered += 1;
    return numbered;
  });
}

function typeKey(type: Type, positions?: ReadonlyMap<ParameterKey, number>): string {
  return positions === undefined || positions.size === 0
    ? memo(ownKeys, type, () => keyAt(type, undefined))
    : keyAt(type, positions);
}

/** `type`'s key, `positions` keying type parameters: canonical where it holds recursion. */
function keyAt(type: Type, positions: ReadonlyMap<ParameterKey, number> | undefined): string {
  if (!holdsRecursion(type)) {
    return structureKeyOf(type, positions, (each) => typeKey(each, positions));
  }
  return canonicalKey(
    type,
    (leaf) => typeKey(leaf, positions),
    (term, partKey) => structureKeyOf(term, positions, partKey),
  );
}

/** `type`'s key by its kind and parts, each part keyed by `key`. */
function structureKeyOf(
  type: Type,
  positions: ReadonlyMap<ParameterKey, number> | undefined,
  key: (each: Type) => string,
): string {
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'error':
      return '?';
    case 'parameter': {
      const position = positions?.get(type.declaration);
      if (position !== undefined) {
        return `$${position}`;
      }
      const ranging = type.within === undefined ? '' : `in ${key(type.within)}`;
      const meeting = type.meeting === undefined ? '' : `@${identityOf(type.meeting.pattern)}`;
      return `'${identityOf(type.declaration)}${ranging}${meeting}`;
    }
    case 'nominal':
      return `#${identityOf(type.entity)}<${type.arguments.map(key).join(',')}>`;
    case 'anonymous':
      return shapeKeyOf(type, key);
    case 'recursive':
      return unreachable('A recursive type is keyed by its graph.');
    case 'tuple':
      return `(${type.elements.map(key).join(',')})`;
    case 'function':
      return functionKeyOf(type, key);
    case 'any': {
      const constraints = type.constraints.map(
        ({ trait, arguments: typeArguments }) =>
          `${identityOf(trait)}<${typeArguments.map(key).join(',')}>`,
      );
      return `any{${constraints.sort().join('&')}}`;
    }
    case 'literal':
      return `=${typeof type.value === 'string' ? JSON.stringify(type.value) : String(type.value)}`;
    case 'union':
      return `|<${type.members.map(key).sort().join(',')}>`;
    case 'associated':
      return `${key(type.of)}.${type.name}`;
    case 'field':
      return `${key(type.of)}[${key(type.key)}]`;
    case 'keys':
      return `keyof(${key(type.of)})-${JSON.stringify(type.without)}`;
    case 'mapped':
      return mappedKeyOf(type, positions);
    case 'match':
      return useKeyOf(type, key);
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/**
 * A mapped struct type's key: its named fields', its keys' and its value's, its own parameter keyed
 * by how many mapped types bind one around it, so two alike up to that name are one type.
 */
function mappedKeyOf(
  type: MappedParts,
  positions: ReadonlyMap<ParameterKey, number> | undefined,
): string {
  const outer = positions ?? new Map<ParameterKey, number>();
  const bound = -1 - [...outer.values()].filter((position) => position < 0).length;
  const inner = new Map([...outer, [type.parameter, bound]]);
  const named = type.named.map((field) => `${field.name}:${typeKey(field.type, positions)}`);
  const mapped = `[${typeKey(type.keys, positions)}]:${typeKey(type.value, inner)}`;
  return `*{${[...named, mapped].join(',')}}`;
}

function shapeKeyOf(type: AnonymousStructType, key: (type: Type) => string): ShapeKey {
  return `{${type.fields.map((field) => `${field.name}:${key(field.type)}`).join(',')}}`;
}

/** The key of a function type: its parameters, by `&` or not, its pack, and its result. */
function functionKeyOf(type: FunctionType, key: (type: Type) => string): string {
  const parameters = type.parameters.map(
    (parameter) => `${parameter.reference ? '&' : ''}${key(parameter.type)}`,
  );
  if (type.pack !== undefined) {
    parameters.push(`...${key(type.pack)}`);
  }
  const prefix = `${type.isSendable ? 'sendable ' : ''}${type.isAsync ? 'async ' : ''}`;
  return `${prefix}fn(${parameters.join(',')})->${key(type.result)}`;
}

/** The key of an unreduced use of a type `match` alias (§3.17). */
function useKeyOf(use: RecursiveUse, key: (type: Type) => string): string {
  return `match:${identityOf(use.declaration)}<${use.arguments.map(key).join(',')}>`;
}

/** The key of a use naming no type, with why: a type `match`'s or an associated type's. */
function unreducedKeyOf(unreduced: UnreducedUse, key: (type: Type) => string): string {
  return unreduced.cause === 'expandsItself'
    ? `${unreduced.cause}${key(unreduced.use.of)}.${unreduced.use.name}`
    : `${unreduced.cause}${useKeyOf(unreduced.use, key)}`;
}

function spelledKey(type: Type): string {
  return memo(spelledKeys, type, () => `${spelledKindKey(type)}${aliasKeyOf(type.alias)}`);
}

/** `type`'s spelled key without the alias it was written through. */
function spelledKindKey(type: Type): string {
  const key = spelledKey;
  const keys = (types: readonly Type[]) => types.map(key).join(',');
  switch (type.kind) {
    case 'nominal':
    case 'tuple':
    case 'function':
      return structureKeyOf(type, undefined, key);
    case 'recursive':
      // A graph is never respelled: closing builds a new one, which is another spelling.
      return `${typeKey(type)}@${identityOf(type.graph)}#${type.node}`;
    case 'primitive':
    case 'literal':
    case 'associated':
    case 'field':
    case 'keys':
    case 'match':
    case 'parameter':
      return structureKeyOf(type, undefined, key);
    case 'error':
      return type.unreduced === undefined ? '?' : `?${unreducedKeyOf(type.unreduced, key)}`;
    case 'anonymous':
      return `{@${identityOf(type.origin)}:${type.fields.map(spelledFieldKey).join(',')}}`;
    case 'any': {
      const constraints = type.constraints.map(
        ({ trait, arguments: typeArguments }) => `${identityOf(trait)}<${keys(typeArguments)}>`,
      );
      return `any{${constraints.join('&')}}`;
    }
    case 'union':
      return `|<${keys(type.members)}>`;
    case 'mapped': {
      const named = type.named.map(spelledFieldKey).join(',');
      const written = `@${identityOf(type.origin)}'${identityOf(type.parameter)}`;
      return `*{${written}:${named}[${key(type.keys)}]:${key(type.value)}}`;
    }
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/** A field's spelled key: its name and type, and where it is declared, with its type there. */
function spelledFieldKey(field: FieldMember): string {
  const { declared } = field;
  const where =
    declared === undefined
      ? ''
      : `@${identityOf(declared.node)}/${declared.module}:${spelledKey(declared.type)}`;
  return `${field.name}${where}:${spelledKey(field.type)}`;
}

/** What a type is written through, spelled: an alias with its arguments, an owner, or keys. */
function aliasKeyOf(alias: AliasUse | undefined): string {
  if (alias === undefined) {
    return '';
  }
  switch (alias.kind) {
    case 'alias':
      return ` as ${identityOf(alias.declaration)}<${alias.arguments.map(spelledKey).join(',')}>`;
    case 'associated':
      return ` as ${spelledKey(alias.of)}.${alias.name}`;
    case 'keys':
      return ` as keyof ${spelledKey(alias.of)}`;
    default: {
      const unhandled: never = alias;
      return unhandled;
    }
  }
}

/** The one numbering of identities every checker keys types by. */
export const typeKeys: TypeKeys = {
  identityOf,
  typeKey,
  shapeKey: (type) => typeKey(type) as ShapeKey,
  structureKey: (type, partKey) => structureKeyOf(type, undefined, partKey),
  spelledKey,
};
