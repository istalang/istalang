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
 *
 * A literal in an extern function's `@Keeps` names one of its parameters (§3.16), so it denotes
 * that parameter instead, which its annotation's check reads by name.
 */

import { wellKnown } from '../../../foundation/language/well-known/index.ts';
import type { ModuleId } from '../../program/program.ts';
import { type TypeParameters, typeParametersOf } from '../../syntax/declarations/index.ts';
import type { Call } from '../../syntax/expressions/calls.ts';
import { literalNaming } from '../../syntax/expressions/literals/built-types.ts';
import type { StringLiteral } from '../../syntax/expressions/literals/literals.ts';
import {
  ancestorsOf,
  parentOf,
  type SyntaxNode,
  type SyntaxTree,
} from '../../syntax/tree/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { LiteralType } from '../../syntax/types/index.ts';
import type { CheckerContext } from '../contexts/context.ts';
import { functionPlace } from '../surface/checked-annotation.ts';
import type { Denotation } from '../surface/denotation.ts';
import { calledVariant } from '../surface/named-variants.ts';
import type { ResolvedCall } from '../surface/resolved-call.ts';
import { substitutionFor } from '../types/parts/substitution.ts';
import type { Type } from '../types/type/index.ts';
import { membersOf } from '../types/type/index.ts';
import { givenKeysOwner } from '../types/written/key-types.ts';
import { parameterType } from '../types/written/resolve-type.ts';
import { bodyHolding } from './holders.ts';

/**
 * The field the String literal `literal` of `module` names as a key, or the parameter it names in a
 * `@Keeps`; none where it is neither.
 */
export function keyDenotationsOf(
  checker: CheckerContext,
  module: ModuleId,
  literal: StringLiteral,
): readonly Denotation[] {
  return (
    keptParameterDenotations(checker, module, literal) ??
    keyOwnersAt(checker, module, literal).flatMap((owner) =>
      keyedFieldDenotations(checker, owner, literal.value),
    )
  );
}

/**
 * The parameter `literal` names when it stands in the `@Keeps` of a function, none for a name no
 * parameter has; undefined where it stands anywhere else.
 */
function keptParameterDenotations(
  checker: CheckerContext,
  module: ModuleId,
  literal: StringLiteral,
): readonly Denotation[] | undefined {
  const path = ancestorsOf(checker.inputs.treeOf(module), literal);
  const at = path.findIndex((node) => node.kind === 'Annotation');
  const [annotation, declaration] = [path[at], path[at + 1]];
  if (annotation?.kind !== 'Annotation' || declaration?.kind !== 'FunctionDeclaration') {
    return undefined;
  }
  const keeps = checker.wellKnownEntity(wellKnown.keeps);
  const checked = checker.annotations.of(module, declaration, functionPlace(declaration));
  if (!checked.some(({ node, type }) => node === annotation && type.entity === keeps)) {
    return undefined;
  }
  const parameter = checker
    .parametersOf(declaration)
    .find(({ node }) => node.name?.text === literal.value);
  const name = parameter?.node.name;
  const entity = name === undefined ? undefined : checker.bindings.entityOf(module, name);
  return entity?.kind === 'variable'
    ? [{ declared: { kind: 'variable', entity }, type: parameter?.type }]
    : [];
}

/**
 * The field of `owner`, the struct a key is of, that the key `key` names; none for no such field.
 */
function keyedFieldDenotations(
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
    parent?.kind === 'NamedType' || parent?.kind === 'TypeApplication'
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

/** What a type or function taking type arguments instantiates, with the arguments it was given. */
interface Instantiated {
  readonly parameters: TypeParameters;
  readonly typeArguments: readonly Type[];
}

/**
 * What `node`, a type or a name taking type arguments, instantiates, with the arguments it was
 * given: a nominal type or an alias written in a type, a struct literal's type, what the call of a
 * name given type arguments makes (`callInstantiations`), the function such a name names as a
 * value (§3.14), or else the struct without fields it makes (§3.1).
 */
function instantiationsAt(
  checker: CheckerContext,
  module: ModuleId,
  tree: SyntaxTree,
  node: SyntaxNode,
): readonly Instantiated[] {
  if (node.kind !== 'TypeApplication') {
    return [instantiationOfType(checker, module, tree, node) ?? []].flat();
  }
  const call = parentOf(tree, node);
  if (call?.kind === 'Call' && call.callee === node) {
    return callInstantiations(checker, module, call);
  }
  const body = bodyHolding(checker, module, node);
  const calls = body?.functionValuesAt(node) ?? [];
  const made = body?.typeOf(node);
  return calls.length === 0 && made !== undefined
    ? membersOf(made).flatMap(nominalMade)
    : functionsInstantiated(calls);
}

/**
 * What `call` instantiates: each function a generic call calls, or the enum a variant without
 * fields called makes, its value, in each pass (§3.11).
 */
function callInstantiations(
  checker: CheckerContext,
  module: ModuleId,
  call: Call,
): readonly Instantiated[] {
  const body = bodyHolding(checker, module, call);
  const calls = body?.callsAt(call) ?? [];
  const made = body?.typeOf(call);
  if (calls.length === 0 && made !== undefined && body !== undefined) {
    const names = {
      entityOf: (name: Identifier) => checker.bindings.entityOf(module, name),
      chosenVariantOf: body.chosenVariantOf,
    };
    return calledVariant(names, call) === undefined ? [] : membersOf(made).flatMap(nominalMade);
  }
  return functionsInstantiated(calls);
}

/** What each of `calls` that calls a declared function instantiates: that function. */
function functionsInstantiated(calls: readonly ResolvedCall[]): readonly Instantiated[] {
  return calls.flatMap((each) =>
    each.kind === 'function'
      ? [{ parameters: each.function.typeParameters, typeArguments: each.typeArguments }]
      : [],
  );
}

/**
 * What `type` instantiates, made in one pass by a variant without fields called, its enum, or by a
 * struct without fields given type arguments, the struct.
 */
function nominalMade(type: Type): readonly Instantiated[] {
  return type.kind === 'nominal'
    ? [{ parameters: type.entity.declaration.typeParameters, typeArguments: type.arguments }]
    : [];
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
