/**
 * What a String literal written as a key denotes (§3.1 Key types): the field of the struct whose
 * key it is, read from what checking decided, so going to a definition, finding references and
 * renaming treat it as a name of that field.
 *
 * A key is a literal like any other once checked, so which struct it is a key of is read from where
 * it stands, never from its value alone:
 * - the index of a field read by key, `s["region"]` (§3.9), is a key of the struct indexed;
 * - in a type, the key of `S["region"]` is a key of `S`;
 * - a literal expected as `keyof S` (the union of `S`'s keys keeps that spelling, struct-keys.ts),
 *   or as a member parameter within it, is a key of `S`;
 * - a literal given to a field or parameter whose type is a member parameter within the keys of a
 *   type parameter, `Entry{key: "region"}` for `K in keyof S`, is a key of the struct the literal's
 *   or the call's instantiation makes `S`.
 */

import type { ModuleId } from '../../program/program.ts';
import type { StructLiteral } from '../../syntax/expressions/index.ts';
import type { StringLiteral } from '../../syntax/expressions/literals.ts';
import { parentOf, type SyntaxNode, type SyntaxTree } from '../../syntax/tree.ts';
import type { CheckedBody } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import type { Denotation } from '../denotation.ts';
import { parameterOfArgument } from '../resolved-call.ts';
import { type Substitution, substitute, substitutionFor } from '../types/substitution.ts';
import type { Type } from '../types/type.ts';
import { bodyHolding } from './holders.ts';

/** The field the String literal `literal` of `module` names as a key; none where it is no key. */
export function keyDenotationsOf(
  checker: CheckerContext,
  module: ModuleId,
  literal: StringLiteral,
): readonly Denotation[] {
  const owner = keyOwnerAt(checker, module, literal);
  const field =
    owner === undefined
      ? undefined
      : checker.fieldsOf(owner)?.find((each) => each.name === literal.value);
  return field === undefined ? [] : [{ declared: { kind: 'field', field }, type: field.type }];
}

/** The struct `literal` is a key of, where it stands. */
function keyOwnerAt(
  checker: CheckerContext,
  module: ModuleId,
  literal: StringLiteral,
): Type | undefined {
  const tree = checker.inputs.treeOf(module);
  const parent = parentOf(tree, literal);
  if (parent?.kind === 'LiteralType') {
    const indexed = parentOf(tree, parent);
    return indexed?.kind === 'IndexedType' && indexed.key === parent
      ? checker.resolvedTypeOf(indexed.owner)
      : undefined;
  }
  const body = bodyHolding(checker, module, literal);
  if (body === undefined) {
    return undefined;
  }
  if (parent?.kind === 'Index' && parent.index === literal) {
    return body.fieldReadOf(parent) === undefined ? undefined : body.typeOf(parent.target);
  }
  const given = givenTo(checker, body, { tree, literal, parent });
  return (
    keysOwner(body.expectedOf(literal)) ??
    (given && instantiatedKeysOwner(checker, given.declared, given.substitution))
  );
}

/** The struct whose keys `type` is: `keyof S` as reduced or opaque, or a member parameter within it. */
function keysOwner(type: Type | undefined): Type | undefined {
  if (type?.alias?.kind === 'keys') {
    return type.alias.of;
  }
  if (type?.kind === 'keys') {
    return type.of;
  }
  return type?.kind === 'parameter' ? keysOwner(type.within) : undefined;
}

/** A literal and where it stands. */
interface LiteralSite {
  readonly tree: SyntaxTree;
  readonly literal: StringLiteral;
  readonly parent: SyntaxNode | undefined;
}

/**
 * The declared type of what `literal` is given to, a field of a struct literal or a parameter of a
 * call, with the substitution the literal's or the call's instantiation makes; none elsewhere.
 */
function givenTo(
  checker: CheckerContext,
  body: CheckedBody,
  { tree, literal, parent }: LiteralSite,
): { readonly declared: Type | undefined; readonly substitution: Substitution } | undefined {
  if (parent?.kind === 'FieldInitializer' && parent.value === literal) {
    const holder = parentOf(tree, parent);
    const substitution = holder?.kind === 'StructLiteral' && literalSubstitution(body, holder);
    return substitution
      ? { declared: body.namedFieldOf(parent.name)?.declared?.type, substitution }
      : undefined;
  }
  const argument = parent?.kind === 'NamedArgument' ? parent : literal;
  const call = parent?.kind === 'NamedArgument' ? parentOf(tree, parent) : parent;
  const resolved = call?.kind === 'Call' ? body.resolved.get(call) : undefined;
  if (call?.kind !== 'Call' || resolved?.kind !== 'function') {
    return undefined;
  }
  const written = call.arguments.indexOf(argument);
  const parameter = parameterOfArgument(resolved.binding).get(
    written + (resolved.receiver === undefined ? 0 : 1),
  );
  return written < 0 || parameter === undefined
    ? undefined
    : {
        declared: checker.parametersOf(resolved.function)[parameter]?.type,
        substitution: substitutionFor(resolved.function.typeParameters, resolved.typeArguments),
      };
}

/** The keys a declared member parameter is within, substituted, as a struct. */
function instantiatedKeysOwner(
  checker: CheckerContext,
  declared: Type | undefined,
  substitution: Substitution | undefined,
): Type | undefined {
  if (declared?.kind !== 'parameter' || declared.declaration.kind !== 'TypeParameter') {
    return undefined;
  }
  const union = checker.memberUnionOf(declared.declaration);
  return union === undefined || substitution === undefined
    ? undefined
    : keysOwner(substitute(union, substitution, checker.typeRules));
}

/** The substitution a struct literal's type makes of its declaration's type parameters. */
function literalSubstitution(body: CheckedBody, literal: StructLiteral): Substitution | undefined {
  const type = body.typeOf(literal);
  return type?.kind === 'nominal'
    ? substitutionFor(type.entity.declaration.typeParameters, type.arguments)
    : undefined;
}
