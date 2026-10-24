/**
 * Building structs and reading their fields (§3.1).
 *
 * A struct literal names its type; the literal's fields are checked by the path variants share
 * (literal-fields.ts), so a generic struct's type arguments are written, expected or inferred
 * alike. A literal naming a variant builds that variant (variants.ts). Reading `s.f` gives the
 * field's type, substituted for the struct's type arguments; through a type parameter, a field a
 * constraint requires (§3.10).
 *
 * `struct{…}` literals are reported as not supported until the feature that adds them. A member
 * that isn't a field, such as a method, is reported as unknown.
 */

import type { MemberAccess, StructLiteral } from '../../syntax/expressions.ts';
import { lastName } from '../../syntax/node.ts';
import type { NamedType } from '../../syntax/types.ts';
import type { BodyContext } from '../context.ts';
import { typeArgumentsFor } from '../declarations/resolve-type.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { frontier } from '../frontier.ts';
import { staticCandidates } from '../overloads/candidates.ts';
import { staticTargetOf } from '../traits/conformance.ts';
import { requiredFields, requiredFieldType } from '../traits/constraints.ts';
import { errorType, type NominalType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { checkLiteralFields } from './literal-fields.ts';
import { entityValueType } from './names.ts';
import { checkVariantLiteral, checkVariantName, namedType } from './variants.ts';

export function checkStructLiteral(
  context: BodyContext,
  node: StructLiteral,
  expected: Type | undefined,
): Type {
  const typeNode = node.type;
  if (typeNode === undefined) {
    return context.unsupported(node, frontier.anonymousStructLiteral);
  }
  const name = lastName(typeNode.path);
  const entity = context.entityOf(name);
  if (entity?.kind === 'variant' || entity?.kind === 'variants') {
    return checkVariantLiteral(context, node, entity, expected);
  }
  if (entity === undefined) {
    return errorType;
  }
  const declaration =
    entity.kind === 'type' && entity.declaration.kind === 'StructDeclaration'
      ? entity.declaration
      : undefined;
  if (declaration === undefined) {
    context.report(checkerDiagnostics.notStruct(typeNode.span, name.text));
    return errorType;
  }
  const typeEntity = entity as NominalType['entity'];
  return checkLiteralFields(
    context,
    node,
    {
      owner: declaration,
      fields: context.checker.declaredFieldsOf(declaration),
      typeOf: (typeArguments) => ({
        kind: 'nominal',
        entity: typeEntity,
        arguments: typeArguments,
      }),
    },
    knownArguments(context, typeNode, declaration, expected),
  );
}

/** The type arguments a struct literal is given: written, or those of the expected type. */
function knownArguments(
  context: BodyContext,
  typeNode: NamedType,
  declaration: NominalType['entity']['declaration'],
  expected: Type | undefined,
): readonly Type[] | undefined {
  if (typeNode.typeArguments.length > 0) {
    const written = typeNode.typeArguments.map((argument) => context.resolveType(argument));
    return typeArgumentsFor(context.checker, context.module, {
      at: typeNode.span,
      declaration,
      types: written,
    });
  }
  return expected?.kind === 'nominal' && expected.entity.declaration === declaration
    ? expected.arguments
    : undefined;
}

export function checkMemberAccess(
  context: BodyContext,
  node: MemberAccess,
  expected: Type | undefined,
): Type {
  if (node.isOptional) {
    return context.unsupported(node, frontier.optionalChaining);
  }
  const qualified = context.entityOf(node.member);
  if (qualified?.kind === 'variant') {
    return checkVariantName(context, node, qualified, expected);
  }
  if (qualified !== undefined) {
    return entityValueType(context, node.member, qualified, expected);
  }
  const owner = namedType(context, node.target);
  if (owner !== undefined) {
    return staticMember(context, node, owner);
  }
  const type = context.expression(node.target);
  if (type.kind === 'error') {
    return errorType;
  }
  const field = fieldOf(context, type, node.member.text);
  if (field === undefined) {
    context.report(
      checkerDiagnostics.unknownField(node.member.span, typeText(type), node.member.text),
    );
    return errorType;
  }
  return field;
}

/**
 * A static function named as a value through its type, which function values add; a name its
 * type has no static function of is reported here.
 */
function staticMember(context: BodyContext, node: MemberAccess, owner: Type): Type {
  const { checker, module } = context;
  const target = staticTargetOf(checker, owner);
  const found =
    target !== undefined && staticCandidates(checker, module, target, node.member.text).length > 0;
  if (!found) {
    context.report(
      checkerDiagnostics.noStaticFunction(node.member.span, typeText(owner), node.member.text),
    );
    return errorType;
  }
  return context.unsupported(node, frontier.staticMember);
}

/** The type of the field `name` of `type`, through a constraint for a type parameter. */
function fieldOf(context: BodyContext, type: Type, name: string): Type | undefined {
  const { checker } = context;
  if (type.kind === 'nominal') {
    return checker.fieldsOf(type)?.find((candidate) => candidate.name === name)?.type;
  }
  if (type.kind !== 'parameter' || type.declaration.kind !== 'TypeParameter') {
    return undefined;
  }
  for (const constraint of checker.constraintsOf(type.declaration)) {
    const field = requiredFields(constraint.trait).find((each) => each.name.text === name);
    if (field !== undefined) {
      return requiredFieldType(checker, constraint, field, type);
    }
  }
  return undefined;
}
