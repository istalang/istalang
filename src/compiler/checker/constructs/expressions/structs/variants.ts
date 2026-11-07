/**
 * Enum variants and `none` as values (§3.11), and names of types in value position.
 *
 * - A bare variant (`Expired`, `Ok(1)`) needs an enum type to be expected that has it; a qualified
 *   one (`Decision.Expired`) names its enum, whose type arguments come from the expected type when
 *   it is the same enum, else from the fields and defaults (literal-fields.ts).
 * - A variant with fields is a function of its enum, its constructor (§3.11,
 *   syntax/declarations/field-defaults.ts): a call binds its arguments to the fields as any call's
 *   to parameters (§3.3), and builds what the literal with those fields builds. Named without a
 *   call, it is that function as a value (§3.14, closures/function-values.ts) wherever no enum is
 *   expected of it: qualified, or bare where an expected function type's result gives its enum.
 *   A variant without fields is a value, so `Expired()` is `Expired`.
 * - A variant's fields are given in braces by name only: `Ok{42}` is written `Ok(42)`
 *   (literal-fields.ts).
 * - `none` needs an optional type to be expected (§3.11).
 * - Where a call's chosen function decides an argument's type, `none`, a bare variant and a call
 *   of one wait for it (§3.5), so `f(none)` reads like `const x: T? = none`.
 */

import { staticName } from '../../../../../foundation/language/static-names.ts';
import type { Entity, VariantNaming, VariantsEntity } from '../../../../binder/entities.ts';
import {
  declaredFunctionName,
  fieldsFunctionOf,
} from '../../../../syntax/declarations/field-defaults.ts';
import type { EnumDeclaration } from '../../../../syntax/declarations/index.ts';
import type { Call, FieldsLiteral, MemberAccess } from '../../../../syntax/expressions/index.ts';
import { type Identifier, lastName } from '../../../../syntax/tree/node.ts';
import type { Accepts, BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { resolveCall, type WrittenArgument } from '../../../resolution/calls/resolve.ts';
import { functionsAccepted, namedFunctions } from '../../../resolution/choosing/named-functions.ts';
import {
  enumsExpected,
  expectedNominal,
  sameNominal,
  writtenNominal,
} from '../../../types/fitting/expected.ts';
import { type NominalType, nominalType, type Type } from '../../../types/type/index.ts';
import { errorType, noneType } from '../../../types/type/primitives.ts';
import { chooseVariant, nominalEntityOf } from '../../../types/written/named-types.ts';
import { checkFunctionValue } from '../../closures/function-values.ts';
import { checkLiteralFields } from './literal-fields.ts';
import { knownArguments } from './literal-types.ts';

/**
 * The types `none` can take, as an argument a call's chosen function decides: any it fits, a
 * union holding `None`, so a literal holding it, such as `(none, 1)`, is built from the parameter.
 */
export function noneAccepted(context: BodyContext): Accepts {
  return (expected) => context.checker.fitOf(noneType, expected) !== undefined;
}

/** For a bare variant's name, the enum types that have a variant of that name. */
export function variantsAccepted(
  context: BodyContext,
  naming: Entity | undefined,
): Accepts | undefined {
  if (naming?.kind !== 'variants') {
    return undefined;
  }
  const { checker } = context;
  return (expected) =>
    checker.inputs.variantNamed(naming.name, enumsExpected(expected)) !== undefined;
}

/**
 * For a bare variant's name passed to a call that decides it (§3.5), the types it can take: an
 * enum having a variant of that name, or a function type its constructor can be.
 */
export function variantNameAccepts(
  context: BodyContext,
  node: Identifier,
  naming: VariantsEntity,
): Accepts {
  const constructors = namedFunctions(context, node);
  const asFunction =
    constructors === undefined ? undefined : functionsAccepted(context, constructors);
  const asValue = variantsAccepted(context, naming);
  return (expected, isOpen) =>
    asValue?.(expected, isOpen) === true || asFunction?.(expected, isOpen) === true;
}

/** For a call of a bare variant, `Ok(v)`, the enum types that have a variant of that name. */
export function variantCallAccepts(context: BodyContext, node: Call): Accepts | undefined {
  return node.callee.kind === 'Identifier' && !node.isOptional
    ? variantsAccepted(context, context.entityOf(node.callee))
    : undefined;
}

/**
 * `none`, the one value of `None` (§2), whatever is expected: it goes into a union as its member.
 */
export function checkNone(): Type {
  return noneType;
}

/**
 * The type of a variant named without a call, bare or qualified: its constructor as a function
 * value where no enum is expected and its enum is known (§3.14), else the variant as a value.
 */
export function checkVariantValue(
  context: BodyContext,
  node: Identifier | MemberAccess,
  naming: VariantNaming,
  expected: Type | undefined,
): Type {
  const constructors = namedFunctions(context, node);
  return constructors !== undefined &&
    enumsExpected(expected).length === 0 &&
    constructors.candidates(expected).length > 0
    ? checkFunctionValue(context, constructors, expected)
    : checkVariantName(context, node, naming, expected);
}

/** The type of a variant named as a value, which needs it to have no fields. */
function checkVariantName(
  context: BodyContext,
  node: Identifier | MemberAccess,
  naming: VariantNaming,
  expected: Type | undefined,
): Type {
  const name = node.kind === 'Identifier' ? node : node.member;
  const chosen = chooseVariant(context, { span: node.span, name }, naming, expected);
  if (chosen === undefined) {
    return errorType;
  }
  if (chosen.variant.fields.length > 0) {
    context.report(checkerDiagnostics.variantFields(node.span, name.text, `${name.text}(…)`));
    return errorType;
  }
  return expectedNominal(
    context,
    node.span,
    nominalEntityOf(context.checker, chosen.enum),
    expected,
  );
}

/** A call naming a variant, as written: its arguments, any type arguments, what is expected. */
export interface VariantCall {
  readonly node: Call;
  readonly expected: Type | undefined;
  readonly typeArguments: readonly Type[] | undefined;
  readonly written: readonly WrittenArgument[];
}

/**
 * `Ok(v)`, `Verdict.Rejected(by: "legal")`: a call of the variant's constructor, chosen and
 * instantiated as any call's function is (§3.3, §3.5). With no type arguments written, the
 * expected type's are given when it is the variant's enum, so an argument fits its field as it
 * would in the literal. A variant without fields is called with no arguments, as the value it
 * names, its written type arguments completed and constrained as a written type's are.
 */
export function checkVariantCall(
  context: BodyContext,
  call: VariantCall,
  callee: Identifier | MemberAccess,
  naming: VariantNaming,
): Type {
  const name = callee.kind === 'Identifier' ? callee : callee.member;
  const chosen = chooseVariant(context, { span: callee.span, name }, naming, call.expected);
  if (chosen === undefined) {
    return errorType;
  }
  const constructs = fieldsFunctionOf(chosen.enum, chosen.variant);
  if (constructs !== undefined) {
    return resolveCall(context, {
      site: call.node,
      name: declaredFunctionName(constructs),
      candidates: [{ declaration: constructs }],
      arguments: call.written,
      typeArguments: call.typeArguments ?? expectedArguments(call.expected, chosen.enum),
      expected: call.expected,
      form: 'call',
    });
  }
  const entity = nominalEntityOf(context.checker, chosen.enum);
  if (call.written.length > 0) {
    const qualified = staticName(chosen.enum.name.text, chosen.variant.name.text);
    const count = call.written.length;
    context.report(checkerDiagnostics.argumentCount(call.node.span, qualified, 0, count, false));
    return errorType;
  }
  return call.typeArguments === undefined
    ? expectedNominal(context, callee.span, entity, call.expected)
    : writtenNominal(context, call.node.span, entity, call.typeArguments);
}

/** The type arguments of `expected` when it is a generic `declaration`'s type; else none. */
function expectedArguments(
  expected: Type | undefined,
  declaration: EnumDeclaration,
): readonly Type[] | undefined {
  const target = sameNominal(expected, declaration);
  return target === undefined || target.arguments.length === 0 ? undefined : target.arguments;
}

/**
 * The type of a variant built with braces, `Rejected{by: "legal"}`, whose fields are named
 * (literal-fields.ts says what a field given by position reads as).
 */
export function checkVariantLiteral(
  context: BodyContext,
  node: FieldsLiteral,
  naming: VariantNaming,
  expected: Type | undefined,
): Type {
  const typeNode = node.type;
  if (typeNode === undefined) {
    return errorType;
  }
  const name = lastName(typeNode.path);
  const chosen = chooseVariant(context, { span: node.span, name }, naming, expected);
  if (chosen === undefined) {
    return errorType;
  }
  const { checker } = context;
  const target = sameNominal(expected, chosen.enum);
  const fields = checker
    .declaredVariantsOf(chosen.enum)
    .find((candidate) => candidate.name === chosen.variant.name.text)?.fields;
  const shape = {
    owner: chosen.enum,
    defaults: fieldsFunctionOf(chosen.enum, chosen.variant),
    known: knownArguments(context, typeNode, chosen.enum, target),
    fields: fields ?? [],
    typeOf: (typeArguments: readonly Type[]) => enumType(context, chosen.enum, typeArguments),
  };
  return checkLiteralFields(context, node, shape);
}

function enumType(
  context: BodyContext,
  declaration: EnumDeclaration,
  typeArguments: readonly Type[],
): NominalType {
  return nominalType(nominalEntityOf(context.checker, declaration), typeArguments);
}
