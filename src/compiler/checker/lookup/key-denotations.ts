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
import { type TypeParameters, typeParametersOf } from '../../syntax/declarations/index.ts';
import { literalNaming } from '../../syntax/expressions/literals/built-types.ts';
import type { StringLiteral } from '../../syntax/expressions/literals/literals.ts';
import { parentOf, type SyntaxNode, type SyntaxTree } from '../../syntax/tree/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { LiteralType } from '../../syntax/types/index.ts';
import type { CheckerContext } from '../contexts/context.ts';
import type { Denotation } from '../surface/denotation.ts';
import { calledVariant } from '../surface/named-variants.ts';
import { substitutionFor } from '../types/parts/substitution.ts';
import type { Type } from '../types/type/index.ts';
import { givenKeysOwner } from '../types/written/key-types.ts';
import { parameterType } from '../types/written/resolve-type.ts';
import { bodyHolding } from './holders.ts';

/** The field the String literal `literal` of `module` names as a key; none where it is no key. */
export function keyDenotationsOf(
  checker: CheckerContext,
  module: ModuleId,
  literal: StringLiteral,
): readonly Denotation[] {
  return keyOwnersAt(checker, module, literal).flatMap((owner) =>
    keyedFieldDenotations(checker, owner, literal.value),
  );
}

/**
 * The field of `owner`, the struct a key is of, that the key `key` names; none for no such field.
 */
export function keyedFieldDenotations(
  checker: CheckerContext,
  owner: Type | undefined,
  key: string,
): readonly Denotation[] {
  const field =
    owner === undefined ? undefined : checker.fieldsOf(owner)?.find((each) => each.name === key);
  return field === undefined ? [] : [{ declared: { kind: 'field', field }, type: field.type }];
}

/**
 * The structs `literal` is a key of: its type's, in a type, one for each function a call taking it
 * as a type argument calls; else what checking its body recorded.
 */
function keyOwnersAt(
  checker: CheckerContext,
  module: ModuleId,
  literal: StringLiteral,
): readonly Type[] {
  const tree = checker.inputs.treeOf(module);
  const parent = parentOf(tree, literal);
  if (parent?.kind === 'LiteralType') {
    return typeKeyOwners(checker, module, tree, parent);
  }
  return [bodyHolding(checker, module, literal)?.keyOwnerOf(literal) ?? []].flat();
}

/**
 * The structs a literal type is a key of: `S["region"]`'s, or a type argument's within its keys.
 */
function typeKeyOwners(
  checker: CheckerContext,
  module: ModuleId,
  tree: SyntaxTree,
  literal: LiteralType,
): readonly Type[] {
  let key: SyntaxNode = literal;
  let parent = parentOf(tree, literal);
  while (parent?.kind === 'UnionType' || parent?.kind === 'ParenthesizedType') {
    key = parent;
    parent = parentOf(tree, parent);
  }
  if (parent?.kind === 'IndexedType') {
    return parent.key === key ? [checker.resolvedTypeOf(parent.owner) ?? []].flat() : [];
  }
  const index =
    parent?.kind === 'NamedType' || parent?.kind === 'Call'
      ? parent.typeArguments.indexOf(key)
      : -1;
  const given = parent === undefined ? [] : instantiationsAt(checker, module, tree, parent);
  return given.flatMap(({ parameters, typeArguments }) => {
    const parameter = typeParametersOf(parameters)[index];
    const owner =
      parameter &&
      givenKeysOwner(
        checker.fitting,
        parameterType(parameter),
        substitutionFor(parameters, typeArguments),
      );
    return owner ?? [];
  });
}

/** What a type or call taking type arguments instantiates, with the arguments it was given. */
interface Instantiated {
  readonly parameters: TypeParameters;
  readonly typeArguments: readonly Type[];
}

/**
 * What `node`, a type or call taking type arguments, instantiates, with the arguments it was given:
 * a nominal type or an alias written in a type, a struct literal's type, each function a generic
 * call calls, or the enum a variant without fields called makes, its value (§3.11).
 */
function instantiationsAt(
  checker: CheckerContext,
  module: ModuleId,
  tree: SyntaxTree,
  node: SyntaxNode,
): readonly Instantiated[] {
  if (node.kind === 'Call') {
    const body = bodyHolding(checker, module, node);
    const calls = body?.callsAt(node) ?? [];
    const made = body?.typeOf(node);
    if (calls.length === 0 && made?.kind === 'nominal' && body !== undefined) {
      const names = {
        entityOf: (name: Identifier) => checker.bindings.entityOf(module, name),
        chosenVariantOf: body.chosenVariantOf,
      };
      return calledVariant(names, node) === undefined
        ? []
        : [{ parameters: made.entity.declaration.typeParameters, typeArguments: made.arguments }];
    }
    return calls.flatMap((call) =>
      call.kind === 'function'
        ? [{ parameters: call.function.typeParameters, typeArguments: call.typeArguments }]
        : [],
    );
  }
  return [instantiationOfType(checker, module, tree, node) ?? []].flat();
}

/**
 * What `node`, a nominal type or an alias written in a type or naming a literal's, instantiates.
 */
function instantiationOfType(
  checker: CheckerContext,
  module: ModuleId,
  tree: SyntaxTree,
  node: SyntaxNode,
): Instantiated | undefined {
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
