/**
 * What a literal naming a type builds (§5.2, §4.6): a declared struct, with the type arguments
 * written or expected; or, through an alias of a shape, the shape, the alias's own type parameters
 * inferred from the values as a generic struct's are, so a generic alias names a family of shapes
 * a literal picks one of (structs.ts checks the literal). An alias names a struct declaration only
 * as a type: its literal names the struct itself. Where a union is expected, the literal builds
 * the one member its items fit (§4.2).
 */

import type { Entity, TypeEntity } from '../../../../binder/entities.ts';
import { type DeclaredStruct, isDeclaredStruct } from '../../../../syntax/declarations/index.ts';
import type { FieldsLiteral } from '../../../../syntax/expressions/index.ts';
import { itemName, itemValue, unparenthesized } from '../../../../syntax/expressions/readings.ts';
import type { NamedType } from '../../../../syntax/types/index.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { itemField } from '../../../surface/struct-items.ts';
import { builtFrom } from '../../../types/fitting/expected.ts';
import { substitute, substitutionFor } from '../../../types/parts/substitution.ts';
import { aliasedAs } from '../../../types/type/alias-uses.ts';
import { unfolded } from '../../../types/type/computed-types.ts';
import {
  type AnonymousStructType,
  isNominalEntity,
  type NominalEntity,
  type Type,
} from '../../../types/type/index.ts';
import { literalOrBase, writtenLiteral } from '../../../types/unions/unions.ts';
import { typeArgumentsFor } from '../../../types/written/type-arguments.ts';
import type { LiteralShape } from './literal-fields/items.ts';

/** What a literal naming a type builds: a declared struct, or a shape an alias names. */
type Built =
  | {
      readonly kind: 'declared';
      readonly entity: NominalEntity;
      readonly struct: DeclaredStruct;
      readonly known: readonly Type[] | undefined;
      /** What it is expected to be, the member of an expected union it builds, if any. */
      readonly expected: Type | undefined;
    }
  | { readonly kind: 'shape'; readonly shape: LiteralShape; readonly expected: Type | undefined };

/**
 * The type arguments a literal of `owner` is given before its items: those written after the
 * type's name, its defaults completing them. What it is expected to be only advises, as a call's
 * expected type does (design.md §4).
 */
function knownArguments(
  context: BodyContext,
  typeNode: NamedType,
  owner: Exclude<LiteralShape['owner'], undefined>,
): readonly Type[] | undefined {
  if (typeNode.typeArguments.length === 0) {
    return undefined;
  }
  const written = typeNode.typeArguments.map((argument) => context.resolveType(argument));
  const list = { at: typeNode.span, declaration: owner, types: written };
  return typeArgumentsFor(context, list);
}

/**
 * What a literal naming `entity` builds: a declared struct, with the type arguments written, or
 * the shape an alias names, with the member of an expected union it builds; undefined for anything
 * else.
 */
export function builtThrough(
  context: BodyContext,
  node: FieldsLiteral & { readonly type: NamedType },
  entity: Entity,
  expected: Type | undefined,
): Built | undefined {
  if (entity.kind !== 'type') {
    return undefined;
  }
  const { declaration } = entity;
  const target = builtMember(context, node, declaration, builtFrom(expected));
  if (isNominalEntity(entity) && isDeclaredStruct(declaration)) {
    const known = knownArguments(context, node.type, declaration);
    return { kind: 'declared', entity, struct: declaration, known, expected: target };
  }
  const aliased = aliasedShape(context, declaration);
  if (declaration.kind !== 'TypeAliasDeclaration' || aliased === undefined) {
    return undefined;
  }
  const known = knownArguments(context, node.type, declaration);
  const typeOf = (typeArguments: readonly Type[]): Type =>
    aliasedAs(
      substitute(
        aliased,
        substitutionFor(declaration.typeParameters, typeArguments),
        context.checker.typeRules,
      ),
      { kind: 'alias', declaration, arguments: typeArguments },
    );
  const shape = { owner: declaration, known, fields: aliased.fields, typeOf };
  return { kind: 'shape', shape, expected: target };
}

/**
 * The shape the alias `declaration` names, with its own type parameters, a recursive one's as it
 * unfolds (§4.6); undefined for any other declaration, or an alias of anything but a shape.
 */
function aliasedShape(
  context: BodyContext,
  declaration: TypeEntity['declaration'],
): AnonymousStructType | undefined {
  if (declaration.kind !== 'TypeAliasDeclaration') {
    return undefined;
  }
  const aliased = unfolded(context.checker.aliasedType(declaration));
  return aliased.kind === 'anonymous' ? aliased : undefined;
}

/**
 * What a literal of `declaration` builds where `expected` is expected (§4.2): of a union, its one
 * member of `declaration`'s type, or the one of several whose fields the literal's items fit, as
 * `Entry{key: "region", …}` against `Entry<S, "retries"> | Entry<S, "region">` builds the second;
 * else `expected` itself, which fitting then judges.
 */
function builtMember(
  context: BodyContext,
  node: FieldsLiteral,
  declaration: TypeEntity['declaration'],
  expected: Type | undefined,
): Type | undefined {
  if (expected?.kind !== 'union') {
    return expected;
  }
  const own = expected.members.filter(
    (member) => member.kind === 'nominal' && member.entity.declaration === declaration,
  );
  const fitting = own.length > 1 ? own.filter((member) => itemsFit(context, node, member)) : own;
  const [only] = fitting;
  return fitting.length === 1 ? only : expected;
}

/**
 * Whether each item of `node` gives a field of `type` a value fitting it, as far as is known before
 * checking it: a literal with its literal type where the field expects one (§4.3), and a value that
 * needs what is expected of it as it can be one (../postponed.ts).
 */
function itemsFit(context: BodyContext, node: FieldsLiteral, type: Type): boolean {
  const fields = context.checker.fieldsOf(type) ?? [];
  return node.items.every((item) => {
    if (item.kind === 'Invalid' || item.kind === 'Spread' || item.kind === 'StructComprehension') {
      return true;
    }
    const field = fields[itemField(itemName(item), fields)];
    if (field === undefined) {
      return false;
    }
    const value = itemValue(item);
    const literal = writtenLiteral(unparenthesized(value));
    if (literal !== undefined) {
      return (
        context.checker.fitOf(
          literalOrBase(literal.value, field.type, context.checker.fitting),
          field.type,
        ) !== undefined
      );
    }
    const admits = context.admitsOf(value);
    return admits === undefined || admits(field.type, () => false);
  });
}
