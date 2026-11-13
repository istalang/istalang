/**
 * Enum variants and `none` as values (§3.11), and names of types in value position.
 *
 * - A bare variant (`Expired`, `Ok(1)`) needs an enum type to be expected that has it; a qualified
 *   one (`Decision.Expired`) names its enum, whose type arguments come from the expected type when
 *   it is the same enum, else from the arguments and defaults.
 * - A variant with fields is a function of its enum, its constructor (§3.11,
 *   syntax/declarations/field-defaults.ts), and is built only by calling it: a call binds its
 *   arguments to the fields as any call's to parameters (§3.3), as any generic call is, its type
 *   arguments inferred. Named without a call, it is that function as a value (§3.14,
 *   closures/function-values.ts) wherever no enum is expected of it: qualified, or bare where an
 *   expected function type's result gives its enum. A variant without fields is a value, so
 *   `Expired()` is `Expired`.
 * - `none` needs no expected type: alone, its type is `None` (§2).
 * - Where a call's chosen function decides an argument's type, `none`, a bare variant and a call
 *   of one wait for it (§3.5), so `f(none)` reads like `const x: T? = none`.
 */

import { staticName } from '../../../../../foundation/language/static-names.ts';
import type { VariantNaming, VariantsEntity } from '../../../../binder/entities.ts';
import {
  declaredFunctionName,
  fieldsFunctionOf,
} from '../../../../syntax/declarations/field-defaults.ts';
import { typeParametersOf } from '../../../../syntax/declarations/index.ts';
import type { Call, CallingNode } from '../../../../syntax/expressions/calls.ts';
import type { MemberAccess } from '../../../../syntax/expressions/index.ts';
import { calledName } from '../../../../syntax/expressions/readings.ts';
import type { Identifier } from '../../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { resolveCall, type WrittenArgument } from '../../../resolution/calls/resolve/index.ts';
import { functionsAccepted, namedFunctions } from '../../../resolution/choosing/named-functions.ts';
import type { Admits } from '../../../types/fitting/expected.ts';
import { enumsExpected, expectedNominal, writtenNominal } from '../../../types/fitting/expected.ts';
import type { Type } from '../../../types/type/index.ts';
import { membersOf } from '../../../types/type/index.ts';
import { errorType, noneType } from '../../../types/type/primitives.ts';
import { chooseVariant, nominalEntityOf } from '../../../types/written/named-types.ts';
import { checkFunctionValue } from '../../closures/function-values.ts';

/**
 * For a bare variant's name passed to a call that decides it (§3.5), the types it can take: an
 * enum having a variant of that name without fields, the value it names, or a function type the
 * constructor of one with fields can be.
 */
export function variantNameAccepts(
  context: BodyContext,
  node: Identifier,
  naming: VariantsEntity,
): Admits {
  const { checker } = context;
  const constructors = namedFunctions(context, node);
  const asFunction =
    constructors === undefined ? undefined : functionsAccepted(context, constructors);
  return (expected, isOpen) =>
    checker.inputs.variantNamed(naming.name, enumsExpected(expected))?.variant.fields.length ===
      0 || asFunction?.(expected, isOpen) === true;
}

/**
 * For a qualified variant without fields of a generic enum, `Options.Empty`, passed to a call that
 * decides it (§3.5): the instances of its enum, whose type arguments its name alone can't give;
 * undefined for any other member access.
 */
export function qualifiedVariantAccepts(
  context: BodyContext,
  node: MemberAccess,
): Admits | undefined {
  const naming = context.entityOf(node.member);
  if (
    naming?.kind !== 'variant' ||
    naming.variant.fields.length > 0 ||
    typeParametersOf(naming.enum.typeParameters).length === 0
  ) {
    return undefined;
  }
  return (expected) => enumsExpected(expected).includes(naming.enum);
}

/** For a call of a bare variant, `Ok(v)`, the enum types that have a variant of that name. */
export function variantCallAccepts(context: BodyContext, node: Call): Admits | undefined {
  const callee = calledName(node);
  const naming =
    callee.kind === 'Identifier' && !node.isOptional ? context.entityOf(callee) : undefined;
  if (naming?.kind !== 'variants') {
    return undefined;
  }
  const { checker } = context;
  return (expected) =>
    checker.inputs.variantNamed(naming.name, enumsExpected(expected)) !== undefined;
}

/**
 * `none`, the one value of `None` (§2), whatever is expected: it goes into a union as its member.
 */
export function checkNone(): Type {
  return noneType;
}

/**
 * The type of a variant named without a call, bare or qualified: its constructor as a function
 * value where its enum is known and isn't asked for (§3.14), else the variant as a value.
 */
export function checkVariantValue(
  context: BodyContext,
  node: Identifier | MemberAccess,
  naming: VariantNaming,
  expected: Type | undefined,
): Type {
  const constructors = namedFunctions(context, node);
  return constructors !== undefined &&
    !asksForVariant(expected, naming) &&
    constructors.candidates(expected).length > 0
    ? checkFunctionValue(context, constructors, expected)
    : checkVariantName(context, node, naming, expected);
}

/**
 * Whether `expected` asks for a value of an enum `naming` may name and for no function, so the
 * variant named there is that value (§3.11): a qualified variant's own enum, or, for a bare name,
 * which chooses among the enums so expected, any.
 */
function asksForVariant(expected: Type | undefined, naming: VariantNaming): boolean {
  const members = expected === undefined ? [] : membersOf(expected);
  const enums = enumsExpected(expected);
  return (
    members.every((member) => member.kind !== 'function') &&
    (naming.kind === 'variant' ? enums.includes(naming.enum) : enums.length > 0)
  );
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
  readonly node: CallingNode;
  readonly expected: Type | undefined;
  readonly typeArguments: readonly Type[] | undefined;
  readonly written: readonly WrittenArgument[];
}

/**
 * `Ok(v)`, `Verdict.Rejected(by: "legal")`: a call of the variant's constructor, chosen and
 * instantiated as any call's function is (§3.3, §3.5). With no type arguments written, the
 * expected type's are given when it is the variant's enum, so an argument fits its field as it
 * would in the literal. A variant without fields is called with no arguments, as the value it
 * names, its written type arguments completed and constrained as a written type's are; with none,
 * the `()` says nothing its name alone doesn't, so it is warned of (§3.11).
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
      recorded: call.node,
      name: declaredFunctionName(constructs),
      candidates: [{ declaration: constructs }],
      arguments: call.written,
      typeArguments: call.typeArguments,
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
  if (call.typeArguments === undefined) {
    context.report(checkerDiagnostics.fieldlessCalled(call.node.span, name.text));
    return expectedNominal(context, callee.span, entity, call.expected);
  }
  return writtenNominal(context, call.node.span, entity, call.typeArguments);
}

/**
 * Refuses a variant named before braces or a block, `Rejected{by: "legal"}` or `Rejected:` (§3.11),
 * a variant being built only by its call; its caller checks the values alone. A bare one the
 * expected type chooses is still recorded, so tools read what it names.
 */
export function refuseVariantLiteral(
  context: BodyContext,
  at: AnchoredSpan,
  name: Identifier,
  { naming, expected }: { readonly naming: VariantNaming; readonly expected: Type | undefined },
): Type {
  context.report(checkerDiagnostics.variantInBraces(at, name.text));
  const chosen =
    naming.kind === 'variants'
      ? context.checker.inputs.variantNamed(naming.name, enumsExpected(expected))
      : undefined;
  if (chosen !== undefined) {
    context.recordVariant(name, chosen);
  }
  return errorType;
}
