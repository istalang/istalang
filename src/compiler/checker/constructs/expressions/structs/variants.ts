/**
 * Enum variants and `none` as values (§3.11), and names of types in value position.
 *
 * - A bare variant (`Expired`, `Ok(1)`) needs an enum type to be expected that has it; a qualified
 *   one (`Decision.Expired`) names its enum, whose type arguments come from the expected type when
 *   it is the same enum, else from the arguments and defaults.
 * - A variant with fields is a function of its enum, its constructor (§3.11,
 *   syntax/declarations/field-defaults.ts), and is built only by calling it: a call binds its
 *   arguments to the fields as any call's to parameters (§3.3). Once its type arguments are known
 *   before its arguments, each argument is checked against its field's type
 *   (`variantFieldTypes`). Named without a call, it is that function as a value (§3.14,
 *   closures/function-values.ts) wherever no enum is expected of it: qualified, or bare where an
 *   expected function type's result gives its enum. A variant without fields is a value, so
 *   `Expired()` is `Expired`.
 * - `none` needs an optional type to be expected (§3.11).
 * - Where a call's chosen function decides an argument's type, `none`, a bare variant and a call
 *   of one wait for it (§3.5), so `f(none)` reads like `const x: T? = none`.
 */

import { staticName } from '../../../../../foundation/language/static-names.ts';
import type { VariantEntity, VariantNaming, VariantsEntity } from '../../../../binder/entities.ts';
import {
  declaredFunctionName,
  fieldsFunctionOf,
} from '../../../../syntax/declarations/field-defaults.ts';
import { type EnumDeclaration, typeParametersOf } from '../../../../syntax/declarations/index.ts';
import type { Call, MemberAccess } from '../../../../syntax/expressions/index.ts';
import type { Identifier } from '../../../../syntax/tree/node.ts';
import type { Accepts, BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { resolveCall, type WrittenArgument } from '../../../resolution/calls/resolve.ts';
import { bindArguments, isBinding } from '../../../resolution/choosing/binding.ts';
import type { SignatureSlot } from '../../../resolution/choosing/call-arguments.ts';
import { signatureOf } from '../../../resolution/choosing/choice.ts';
import { functionsAccepted, namedFunctions } from '../../../resolution/choosing/named-functions.ts';
import type { Binding } from '../../../surface/resolved-call.ts';
import {
  enumsExpected,
  expectedNominal,
  sameNominal,
  writtenNominal,
} from '../../../types/fitting/expected.ts';
import { substitutionFor } from '../../../types/parts/substitution.ts';
import type { Type } from '../../../types/type/index.ts';
import { errorType, noneType } from '../../../types/type/primitives.ts';
import { membersOf } from '../../../types/unions/unions.ts';
import { chooseVariant, nominalEntityOf } from '../../../types/written/named-types.ts';
import { checkFunctionValue } from '../../closures/function-values.ts';

/**
 * The types `none` can take, as an argument a call's chosen function decides: any it fits, a
 * union holding `None`, so a literal holding it, such as `(none, 1)`, is built from the parameter.
 */
export function noneAccepted(context: BodyContext): Accepts {
  return (expected) => context.checker.fitOf(noneType, expected) !== undefined;
}

/**
 * For a bare variant's name passed to a call that decides it (§3.5), the types it can take: an
 * enum having a variant of that name without fields, the value it names, or a function type the
 * constructor of one with fields can be.
 */
export function variantNameAccepts(
  context: BodyContext,
  node: Identifier,
  naming: VariantsEntity,
): Accepts {
  const { checker } = context;
  const constructors = namedFunctions(context, node);
  const asFunction =
    constructors === undefined ? undefined : functionsAccepted(context, constructors);
  return (expected, isOpen) =>
    checker.inputs.variantNamed(naming.name, enumsExpected(expected))?.variant.fields.length ===
      0 || asFunction?.(expected, isOpen) === true;
}

/** For a call of a bare variant, `Ok(v)`, the enum types that have a variant of that name. */
export function variantCallAccepts(context: BodyContext, node: Call): Accepts | undefined {
  const naming =
    node.callee.kind === 'Identifier' && !node.isOptional
      ? context.entityOf(node.callee)
      : undefined;
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
  if (call.typeArguments === undefined) {
    context.report(checkerDiagnostics.fieldlessCalled(call.node.span, name.text));
    return expectedNominal(context, callee.span, entity, call.expected);
  }
  return writtenNominal(context, call.node.span, entity, call.typeArguments);
}

/**
 * By argument written, the type of the field each argument of a call of a variant with fields gives
 * (§3.11), once the enum's type arguments are known before the arguments: written, else the
 * expected type's when it is the same enum, or none for an enum without type parameters. Each
 * argument is checked against it, so a value that takes its type from where it stands
 * (`Item{value: "s"}`, `Options.Empty`) takes it from its field. Undefined when they aren't known
 * or the arguments don't bind, which choosing then reports.
 */
export function variantFieldTypes(
  context: BodyContext,
  node: Call,
  expected: Type | undefined,
  typeArguments: readonly Type[] | undefined,
): readonly (Type | undefined)[] | undefined {
  const chosen = variantCalled(context, node, expected);
  const constructs =
    chosen === undefined ? undefined : fieldsFunctionOf(chosen.enum, chosen.variant);
  if (chosen === undefined || constructs === undefined) {
    return undefined;
  }
  const known = typeArguments ?? expectedArguments(expected, chosen.enum) ?? [];
  if (known.length !== typeParametersOf(chosen.enum.typeParameters).length) {
    return undefined;
  }
  const { parameters } = signatureOf(
    context.checker,
    constructs,
    substitutionFor(chosen.enum.typeParameters, known),
  );
  const binding = bindArguments(
    parameters,
    node.arguments.map((argument) => ({
      name: argument.kind === 'NamedArgument' ? argument.name.text : undefined,
      isSpread: argument.kind === 'Spread',
    })),
  );
  return isBinding(binding) ? argumentTypes(parameters, binding, node.arguments.length) : undefined;
}

/**
 * The variant `node` calls, as the expected type chooses a bare one; undefined for any other call.
 */
function variantCalled(
  context: BodyContext,
  node: Call,
  expected: Type | undefined,
): VariantEntity | undefined {
  const { callee } = node;
  if (node.isOptional || (callee.kind !== 'Identifier' && callee.kind !== 'MemberAccess')) {
    return undefined;
  }
  const naming = context.entityOf(callee.kind === 'Identifier' ? callee : callee.member);
  if (naming?.kind === 'variant') {
    return naming;
  }
  return naming?.kind === 'variants'
    ? context.checker.inputs.variantNamed(naming.name, enumsExpected(expected))
    : undefined;
}

/** By argument, the type of the parameter `binding` passes it to; an item's for a rest's item. */
function argumentTypes(
  parameters: readonly SignatureSlot[],
  binding: Binding,
  count: number,
): readonly (Type | undefined)[] {
  const types: (Type | undefined)[] = Array.from({ length: count }, () => undefined);
  for (const [index, source] of binding.entries()) {
    const slot = parameters[index];
    if (source.kind === 'argument') {
      types[source.index] = slot?.type;
    } else if (source.kind === 'rest' && slot?.rest?.kind === 'array') {
      for (const item of source.items) {
        types[item.index] = item.isSpread ? slot.type : slot.rest.item;
      }
    }
  }
  return types;
}

/** The type arguments of `expected` when it is a generic `declaration`'s type; else none. */
function expectedArguments(
  expected: Type | undefined,
  declaration: EnumDeclaration,
): readonly Type[] | undefined {
  const target = sameNominal(expected, declaration);
  return target === undefined || target.arguments.length === 0 ? undefined : target.arguments;
}
