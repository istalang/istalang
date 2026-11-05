/**
 * What a literal naming a type builds (§3.1, §3.17): a declared struct, with the type arguments
 * written or expected; or, through an alias of a shape, the shape, the alias's own type parameters
 * inferred from the values as a generic struct's are, so a generic alias names a family of shapes
 * a literal picks one of (structs.ts checks the literal). An alias names a struct declaration only
 * as a type: its literal names the struct itself. Where a union is expected, the literal builds
 * the one member its items fit (§2).
 */

import type { Entity, TypeEntity } from '../../binder/entities.ts';
import { type DeclaredStruct, isDeclaredStruct } from '../../syntax/declarations.ts';
import {
  type FieldsLiteral,
  itemName,
  itemValue,
  unparenthesized,
} from '../../syntax/expressions/index.ts';
import type { NamedType } from '../../syntax/types.ts';
import type { BodyContext } from '../body-context.ts';
import { itemField } from '../struct-items.ts';
import { builtFrom } from '../types/expected.ts';
import { substitute, substitutionFor } from '../types/substitution.ts';
import { aliasedAs, isNominalEntity, type NominalEntity, type Type } from '../types/type.ts';
import { literalOrBase, writtenLiteral } from '../types/unions.ts';
import { knownArguments, type LiteralShape } from './literal-fields.ts';

/** What a literal naming a type builds: a declared struct, or a shape an alias names. */
export type Built =
  | {
      readonly kind: 'declared';
      readonly entity: NominalEntity;
      readonly struct: DeclaredStruct;
      readonly known: readonly Type[] | undefined;
    }
  | { readonly kind: 'shape'; readonly shape: LiteralShape };

/**
 * What a literal naming `entity` builds: a declared struct, with the type arguments written or
 * expected, or the shape an alias names; undefined for anything else.
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
    const known = knownArguments(context, node.type, declaration, target);
    return { kind: 'declared', entity, struct: declaration, known };
  }
  if (declaration.kind !== 'TypeAliasDeclaration') {
    return undefined;
  }
  const aliased = context.checker.aliasedType(declaration);
  const known = knownArguments(context, node.type, declaration, target);
  const typeOf = (typeArguments: readonly Type[]): Type =>
    aliasedAs(
      substitute(
        aliased,
        substitutionFor(declaration.typeParameters, typeArguments),
        context.checker.typeRules,
      ),
      { kind: 'alias', declaration, arguments: typeArguments },
    );
  return aliased.kind === 'anonymous'
    ? { kind: 'shape', shape: { owner: declaration, known, fields: aliased.fields, typeOf } }
    : undefined;
}

/**
 * What a literal of `declaration` builds where `expected` is expected (§2): of a union, its one
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
 * checking it: a literal with its literal type where the field expects one (§2), a value the
 * field decides as it accepts, and one of a type of its own as it fits.
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
        context.checker.fitOf(literalOrBase(literal.value, field.type), field.type) !== undefined
      );
    }
    const part = context.acceptedPart(value);
    if (part.kind === 'decided') {
      return part.accepts(field.type, () => false);
    }
    return part.type === undefined || context.checker.fitOf(part.type, field.type) !== undefined;
  });
}
