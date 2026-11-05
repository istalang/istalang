/**
 * What a String literal written as a key denotes (§3.1 Key types): the field of the struct whose
 * key it is, so going to a definition, finding references and renaming treat it as a name of that
 * field.
 *
 * - In code, checking decides it and records it with the body (`CheckedBody.keyOwnerOf`): a
 *   literal checked as a struct's keys or a member parameter within them, given for such a field or
 *   parameter (read through the instantiation), compared with a key, or matched against one.
 * - In a type, the type is the record: the key of `S["region"]` (or of `S["a" | "b"]`) is a key
 *   of `S`, and a literal type given as a type argument for a member parameter within a struct's
 *   keys, `Entry<Settings, "region">`, is a key of the struct the instantiation makes it.
 */

import type { ModuleId } from '../../program/program.ts';
import { type TypeParameters, typeParametersOf } from '../../syntax/declarations.ts';
import { literalNaming } from '../../syntax/expressions/built-types.ts';
import type { StringLiteral } from '../../syntax/expressions/literals.ts';
import { parentOf, type SyntaxNode, type SyntaxTree } from '../../syntax/tree.ts';
import type { LiteralType } from '../../syntax/types.ts';
import type { CheckerContext } from '../context.ts';
import type { Denotation } from '../denotation.ts';
import { givenKeysOwner } from '../types/key-types.ts';
import { parameterType } from '../types/resolve-type.ts';
import { substitutionFor } from '../types/substitution.ts';
import type { Type } from '../types/type.ts';
import { bodyHolding } from './holders.ts';

/** The field the String literal `literal` of `module` names as a key; none where it is no key. */
export function keyDenotationsOf(
  checker: CheckerContext,
  module: ModuleId,
  literal: StringLiteral,
): readonly Denotation[] {
  return keyedFieldDenotations(checker, keyOwnerAt(checker, module, literal), literal.value);
}

/** The field of `owner`, the struct a key is of, that the key `key` names; none for no such field. */
export function keyedFieldDenotations(
  checker: CheckerContext,
  owner: Type | undefined,
  key: string,
): readonly Denotation[] {
  const field =
    owner === undefined ? undefined : checker.fieldsOf(owner)?.find((each) => each.name === key);
  return field === undefined ? [] : [{ declared: { kind: 'field', field }, type: field.type }];
}

/** The struct `literal` is a key of: its type's, in a type; else what checking its body recorded. */
function keyOwnerAt(
  checker: CheckerContext,
  module: ModuleId,
  literal: StringLiteral,
): Type | undefined {
  const tree = checker.inputs.treeOf(module);
  const parent = parentOf(tree, literal);
  if (parent?.kind === 'LiteralType') {
    return typeKeyOwner(checker, module, tree, parent);
  }
  return bodyHolding(checker, module, literal)?.keyOwnerOf(literal);
}

/** The struct a literal type is a key of: `S["region"]`'s, or a type argument's within its keys. */
function typeKeyOwner(
  checker: CheckerContext,
  module: ModuleId,
  tree: SyntaxTree,
  literal: LiteralType,
): Type | undefined {
  let key: SyntaxNode = literal;
  let parent = parentOf(tree, literal);
  while (parent?.kind === 'UnionType' || parent?.kind === 'ParenthesizedType') {
    key = parent;
    parent = parentOf(tree, parent);
  }
  if (parent?.kind === 'IndexedType') {
    return parent.key === key ? checker.resolvedTypeOf(parent.owner) : undefined;
  }
  const given = parent === undefined ? undefined : instantiationAt(checker, module, tree, parent);
  const index =
    parent?.kind === 'NamedType' || parent?.kind === 'Call'
      ? parent.typeArguments.indexOf(key)
      : -1;
  const parameter = given === undefined ? undefined : typeParametersOf(given.parameters)[index];
  return parameter === undefined || given === undefined
    ? undefined
    : givenKeysOwner(
        checker.fitting,
        parameterType(parameter),
        substitutionFor(given.parameters, given.typeArguments),
      );
}

/**
 * What `node`, a type or call taking type arguments, instantiates, with the arguments it was given:
 * a nominal type or an alias written in a type, a struct literal's type, a generic call.
 */
function instantiationAt(
  checker: CheckerContext,
  module: ModuleId,
  tree: SyntaxTree,
  node: SyntaxNode,
): { readonly parameters: TypeParameters; readonly typeArguments: readonly Type[] } | undefined {
  if (node.kind === 'Call') {
    const body = bodyHolding(checker, module, node);
    const resolved = body?.resolved.get(node);
    return resolved?.kind === 'function'
      ? { parameters: resolved.function.typeParameters, typeArguments: resolved.typeArguments }
      : undefined;
  }
  if (node.kind !== 'NamedType') {
    return undefined;
  }
  const holder = parentOf(tree, node);
  const literal = literalNaming(holder, node);
  const named =
    literal === undefined
      ? checker.resolvedTypeOf(node)
      : bodyHolding(checker, module, literal)?.typeOf(literal);
  if (named?.alias?.kind === 'alias') {
    return {
      parameters: named.alias.declaration.typeParameters,
      typeArguments: named.alias.arguments,
    };
  }
  return named?.kind === 'nominal'
    ? { parameters: named.entity.declaration.typeParameters, typeArguments: named.arguments }
    : undefined;
}
