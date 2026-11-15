/**
 * Keys for types, for the maps and sets that are keyed by type, and the one definition of type
 * identity: two types are the same type exactly when their keys are equal (identity.ts).
 *
 * - A nominal type or a type parameter is itself by an object's identity: an entity, or the
 *   parameter's declaration; an `any` type is its traits' with their arguments, sorted, since its
 *   constraints are a set. A string can carry that identity only as a number. The numbers are the
 *   module's, so an object keys alike in every checker and in every revision of a program; lowering
 *   keys its function-table entries through the same unit. No number ever reaches lowering's
 *   output: it finds entries by these keys, and persists their table keys, this key with each
 *   identity spelled by a qualified name in place of its number (lowering/tables/names.ts).
 * - Every key, a table key too, is spelled by one structural walk (`structureKeyOf`), how an
 *   identity is spelled passed in (`IdentitySpelling`), so an attribute a type gains is keyed once
 *   for both.
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
 *   such a type is opaque, equal only to itself (§3.5). A mapped struct type not reduced yet keys
 *   its own parameter by how deep it binds, so its spelling's name for it never makes two types; it
 *   starts with `*`, as no other type's key does, so it never keys alike with a shape.
 * - An alias names no type of its own (§3.17), so no key mentions one.
 * - A canonical key is kept by the type's pre-key: its structure, keyed as here, down to each
 *   recursive type it reaches, spelled by that type's graph and node. A graph is immutable and
 *   minimized, so one pre-key always unfolds alike and has one key; substitution and union
 *   construction build many objects of one structure, and only the first builds a term graph. A
 *   key is kept with the first graph its pre-key reaches and goes with it, as a later revision's
 *   graphs replace an earlier one's; an identity's number is never reused, so a pre-key naming a
 *   graph gone finds nothing.
 * - A type's own key is memoized per type object, which is immutable. Comparing generic signatures
 *   up to the names of their type parameters (constructs/declarations/functions/clashes.ts) keys
 *   each of those parameters by its position, which is the same as substituting canonical
 *   parameters, without building them; such keys are computed afresh.
 * - A type's spelled key (`spelledKey`) is its key with everything it is spelled with: the alias,
 *   associated type or keys it was written through, the node each shape, mapped type and field was
 *   written at, an `any`'s constraints and a union's members in written order, and the type
 *   `match` use an error type carries. A recursive type spells its graph by its nodes' spellings
 *   and labels, `~i` where a node is reached again, so one spelling closed twice, by one checker or
 *   two, spells alike. Two types are alike in every part (`sameTypeSpelled`)
 *   exactly when their spelled keys are equal. A result computed from a type's spelling, such as a
 *   type `match`'s reduction, is kept by this key, never by the type's, so it never answers one
 *   spelling with another's: a later revision would otherwise keep nodes an earlier tree made.
 */

import { memo } from '../../../../foundation/structures/memo.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { TraitDeclaration } from '../../../syntax/declarations/index.ts';
import { holdsRecursion } from '../parts/type-children.ts';
import type { AliasUse } from '../type/alias-uses.ts';
import type { MappedParts, MappedType, MatchType, RecursiveGraph } from '../type/computed-types.ts';
import type {
  AnonymousStructType,
  FieldMember,
  FunctionType,
  NominalEntity,
  ParameterKey,
  RecursiveUse,
  Type,
  TypeParameterType,
  UnreducedUse,
} from '../type/index.ts';
import { literalText } from '../type/primitives.ts';
import { canonicalKey, unionKeyOf } from './recursive-terms.ts';

/** Every identity numbered so far; an object no longer reachable lets its number go. */
const identities = new WeakMap<object, number>();
let numbered = 0;

/** Each type's own key, with no parameter keyed by position. */
const ownKeys = new WeakMap<Type, string>();

/** Canonical keys by pre-key, kept with the first graph each pre-key reaches (the banner). */
const canonicalKeys = new WeakMap<RecursiveGraph, Map<string, string>>();

/** Each type's spelled key. */
const spelledKeys = new WeakMap<Type, string>();

/** Each recursive type graph's spelling. */
const spelledGraphs = new WeakMap<RecursiveGraph, string>();

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
  /**
   * The key of `type` with each identity it names spelled by `spelling`, each type it is built
   * from that holds no recursion keyed by `partKey`: canonical where it holds recursion.
   */
  readonly keyWith: (
    type: Type,
    spelling: IdentitySpelling,
    partKey: (part: Type) => string,
  ) => string;
  /** The key of `type` with everything it is spelled with (the banner). */
  readonly spelledKey: (type: Type) => string;
}

/** A shape's key (`TypeKeys.shapeKey`), or a recursive type's. */
export type ShapeKey = `{${string}` | `~[${string}`;

/**
 * How a key spells what a type names by an object's identity rather than by its structure: by
 * the module's numbers in a checker's keys; by qualified names in lowering's table keys, which
 * never meet a type only a checker does.
 */
export interface IdentitySpelling {
  /** A nominal type's entity. */
  readonly entity: (entity: NominalEntity) => string;
  /** The trait an `any` type's constraint names. */
  readonly trait: (trait: TraitDeclaration) => string;
  /**
   * A type parameter, its parts keyed by `key`; of an instantiated type, only the `Self` an `any`
   * type's constraint names.
   */
  readonly parameter: (type: TypeParameterType, key: (part: Type) => string) => string;
  /**
   * A type only a checker meets, which an instantiation reduces: a mapped struct type not reduced
   * yet, or a use of a type `match` alias, its parts keyed by `key`.
   */
  readonly unreduced: (type: MappedType | MatchType, key: (part: Type) => string) => string;
}

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

/** `type`'s own key, with no parameter keyed by position: a part's key, never given a position. */
function ownKeyOf(type: Type): string {
  return typeKey(type);
}

/** `type`'s key, `positions` keying type parameters: canonical where it holds recursion. */
function keyAt(type: Type, positions: ReadonlyMap<ParameterKey, number> | undefined): string {
  if (positions === undefined) {
    return holdsRecursion(type)
      ? keptCanonicalKey(type)
      : keyWith(type, numberedIdentities, ownKeyOf);
  }
  return keyWith(type, numberedAt(positions), (each) => typeKey(each, positions));
}

/** `TypeKeys.keyWith`: a type holding recursion from its term graph built afresh. */
function keyWith(type: Type, spelling: IdentitySpelling, partKey: (part: Type) => string): string {
  const spell = (each: Type, eachPart: (part: Type) => string) =>
    structureKeyOf(each, spelling, eachPart);
  return holdsRecursion(type) ? canonicalKey(type, partKey, spell) : spell(type, partKey);
}

/** The canonical key of `type`, holding recursion, built once per pre-key (the banner). */
function keptCanonicalKey(type: Type): string {
  const { preKey, graph } = preKeyOf(type);
  if (graph === undefined) {
    // Only a mapped struct type's parts were reached, which it keys whole: nothing to keep it by.
    return keyWith(type, numberedIdentities, ownKeyOf);
  }
  const kept = memo(canonicalKeys, graph, () => new Map<string, string>());
  return memo(kept, preKey, () => keyWith(type, numberedIdentities, ownKeyOf));
}

/**
 * `type`'s pre-key (the banner): its structure, down to each recursive type it holds, spelled as
 * that type's graph and node; and the first graph it reaches.
 */
function preKeyOf(type: Type): { readonly preKey: string; readonly graph?: RecursiveGraph } {
  let graph: RecursiveGraph | undefined;
  const spell = (part: Type): string => {
    if (part.kind === 'recursive') {
      graph ??= part.graph;
      return `@${identityOf(part.graph)}#${part.node}`;
    }
    return holdsRecursion(part) ? structureKeyOf(part, numberedIdentities, spell) : typeKey(part);
  };
  const preKey = spell(type);
  return graph === undefined ? { preKey } : { preKey, graph };
}

/**
 * `type`'s key by its kind and parts, each part keyed by `key`, each identity it names spelled by
 * `spelling`: the one structural walk of a type every key is spelled by.
 */
function structureKeyOf(
  type: Type,
  spelling: IdentitySpelling,
  key: (each: Type) => string,
): string {
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'error':
      return '?';
    case 'parameter':
      return spelling.parameter(type, key);
    case 'mapped':
    case 'match':
      return spelling.unreduced(type, key);
    case 'nominal':
      return `#${spelling.entity(type.entity)}<${type.arguments.map(key).join(',')}>`;
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
          `${spelling.trait(trait)}<${typeArguments.map(key).join(',')}>`,
      );
      return `any{${constraints.sort().join('&')}}`;
    }
    case 'literal':
      return `=${literalText(type.value)}`;
    case 'union':
      return unionKeyOf(type.members.map(key).sort());
    case 'associated':
      return `${key(type.of)}.${type.name}`;
    case 'field':
      return `${key(type.of)}[${key(type.key)}]`;
    case 'keys':
      return `keyof(${key(type.of)})-${JSON.stringify(type.without)}`;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/** Identities by the module's numbers, type parameters in `positions` by their position there. */
function numberedAt(positions: ReadonlyMap<ParameterKey, number> | undefined): IdentitySpelling {
  return {
    entity: (entity) => String(identityOf(entity)),
    trait: (trait) => String(identityOf(trait)),
    parameter: (type, key) => parameterKeyOf(type, positions, key),
    unreduced: (type, key) =>
      type.kind === 'mapped' ? mappedKeyOf(type, positions) : useKeyOf(type, key),
  };
}

/** Identities by the module's numbers: a type's own key's. */
const numberedIdentities = numberedAt(undefined);

/**
 * A type parameter's key: its position in `positions`, else its declaration's identity, with the
 * keys it ranges over and the struct case it meets (index.ts, `TypeParameterType`).
 */
function parameterKeyOf(
  type: TypeParameterType,
  positions: ReadonlyMap<ParameterKey, number> | undefined,
  key: (each: Type) => string,
): string {
  const position = positions?.get(type.declaration);
  if (position !== undefined) {
    return `$${position}`;
  }
  const ranging = type.within === undefined ? '' : `in ${key(type.within)}`;
  const meeting = type.meeting === undefined ? '' : `@${identityOf(type.meeting.pattern)}`;
  return `'${identityOf(type.declaration)}${ranging}${meeting}`;
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

/**
 * The key of a function type: its kind, its parameters, by `&` or not, its pack, and its result.
 * The kind is keyed whole, a variable or either kind as surely as `live`, which its text leaves
 * out.
 */
function functionKeyOf(type: FunctionType, key: (type: Type) => string): string {
  const parameters = type.parameters.map(
    (parameter) => `${parameter.reference ? '&' : ''}${key(parameter.type)}`,
  );
  if (type.pack !== undefined) {
    parameters.push(`...${key(type.pack)}`);
  }
  const head = `fn<${key(type.mark)},${key(type.send)}>`;
  return `${head}(${parameters.join(',')})->${key(type.result)}`;
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
  return memo(spelledKeys, type, () => spelledWith(type, spelledKey));
}

/** `type`'s spelled key, each type it is built from spelled by `key`. */
function spelledWith(type: Type, key: (part: Type) => string): string {
  return `${spelledKindKey(type, key)}${aliasKeyOf(type.alias, key)}`;
}

/**
 * The spelling of a recursive type's graph (the banner): each node's body and label spelled, a
 * node of the graph reached again inside one as `~i`; computed once per graph, which never changes.
 */
function spelledGraph(graph: RecursiveGraph): string {
  return memo(spelledGraphs, graph, () => {
    const key = (part: Type): string => {
      if (part.kind === 'recursive' && part.graph === graph) {
        return `~${part.node}`;
      }
      return holdsRecursion(part) ? spelledWith(part, key) : spelledKey(part);
    };
    const nodes = graph.nodes.map(
      (body, index) => `${key(body)}${aliasKeyOf(graph.labels[index], key)}`,
    );
    return `~[${nodes.join(';')}]`;
  });
}

/**
 * `type`'s spelled key without the alias it was written through, its parts spelled by `key`: its
 * key, but for what it is spelled with besides (the banner).
 */
function spelledKindKey(type: Type, key: (part: Type) => string): string {
  switch (type.kind) {
    case 'recursive':
      return `${spelledGraph(type.graph)}#${type.node}`;
    case 'error':
      return type.unreduced === undefined ? '?' : `?${unreducedKeyOf(type.unreduced, key)}`;
    case 'anonymous':
      return `{@${identityOf(type.origin)}:${type.fields.map((field) => spelledFieldKey(field, key)).join(',')}}`;
    case 'any': {
      const constraints = type.constraints.map(
        ({ trait, arguments: typeArguments }) =>
          `${identityOf(trait)}<${typeArguments.map(key).join(',')}>`,
      );
      return `any{${constraints.join('&')}}`;
    }
    case 'union':
      return unionKeyOf(type.members.map(key));
    case 'mapped': {
      const named = type.named.map((field) => spelledFieldKey(field, key)).join(',');
      const written = `@${identityOf(type.origin)}'${identityOf(type.parameter)}`;
      return `*{${written}:${named}[${key(type.keys)}]:${key(type.value)}}`;
    }
    default:
      return structureKeyOf(type, numberedIdentities, key);
  }
}

/** A field's spelled key: its name and type, and where it is declared, with its type there. */
function spelledFieldKey(field: FieldMember, key: (part: Type) => string): string {
  const { declared } = field;
  const where =
    declared === undefined
      ? ''
      : `@${identityOf(declared.node)}/${declared.module}:${key(declared.type)}`;
  return `${field.name}${where}:${key(field.type)}`;
}

/**
 * What a type is written through, spelled, its types spelled by `key`: an alias with its
 * arguments, an owner, or keys.
 */
function aliasKeyOf(alias: AliasUse | undefined, key: (part: Type) => string): string {
  if (alias === undefined) {
    return '';
  }
  switch (alias.kind) {
    case 'alias':
      return ` as ${identityOf(alias.declaration)}<${alias.arguments.map(key).join(',')}>`;
    case 'associated':
      return ` as ${key(alias.of)}.${alias.name}`;
    case 'keys':
      return ` as keyof ${key(alias.of)}`;
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
  structureKey: (type, partKey) => structureKeyOf(type, numberedIdentities, partKey),
  keyWith,
  spelledKey,
};
