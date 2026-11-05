/**
 * Reading a member of a value (§3.1): `s.f`, or a name qualified by a type or a namespace.
 *
 * - Reading `s.f` gives the field's type, substituted for the struct's type arguments; through a
 *   type parameter, a field a constraint requires (§3.10). A member that isn't a field is
 *   reported as unknown here, or, when it is a field of the value behind a handle, as to be read
 *   with `->` (§3.9); a call of one is a method call (calls.ts). How each read reaches its field
 *   is recorded for lowering (`FieldReads`, checked-field.ts).
 * - A member qualified by a namespace or a type is what it names there: a variant, a function as
 *   a value, a constant; a type's member naming nothing is no static function of it. One cut
 *   short or not exported was reported already, so it reads as nothing (`readsNothing`).
 */

import type { Diagnostic } from '../../../diagnostics/diagnostic.ts';
import { isMethod as isMethodDeclaration } from '../../syntax/declarations.ts';
import { linkOperator } from '../../syntax/expressions/chains.ts';
import type { Expression, MemberAccess } from '../../syntax/expressions/index.ts';
import { isMissingName } from '../../syntax/node.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { Accepts, BodyContext, FieldReadRecord } from '../body-context.ts';
import type { FieldRead, FoundField } from '../checked-field.ts';
import {
  checkFunctionValue,
  functionsAccepted,
  namedFunctions,
} from '../closures/function-values.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { topLevelCandidates } from '../resolution/candidates.ts';
import { namedType, nameNodeOf } from '../resolution/named.ts';
import { fieldOf } from '../traits/known-constraints.ts';
import { insideOptional } from '../types/inside-optional.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { optionalInner } from '../types/unions.ts';
import { entityValueType } from './names.ts';
import { checkVariantName } from './variants.ts';

export function checkMemberAccess(
  context: BodyContext,
  node: MemberAccess,
  expected: Type | undefined,
): Type {
  const nothing = readsNothing(context, node, node);
  if (nothing !== undefined) {
    return nothing;
  }
  const qualified = node.isOptional ? undefined : context.entityOf(node.member);
  if (qualified?.kind === 'variant') {
    return checkVariantName(context, node, qualified, expected);
  }
  const functions = namedFunctions(context, node);
  if (functions !== undefined) {
    return checkFunctionValue(context, functions, expected);
  }
  if (qualified !== undefined) {
    return entityValueType(context, node.member, qualified, expected);
  }
  const owner = node.isOptional ? undefined : namedType(context, node.target);
  if (owner !== undefined) {
    context.report(
      checkerDiagnostics.noStaticFunction(node.member.span, typeText(owner), node.member.text),
    );
    return errorType;
  }
  const type = context.chains.target(context, node);
  if (type.kind === 'error') {
    return errorType;
  }
  const field = fieldOf(context.checker, type, node.member.text);
  if (field === undefined) {
    context.report(noField(context, node, type));
    return errorType;
  }
  recordFieldRead(context, node, field);
  return field.member.type;
}

/**
 * The type of a member read by `link` (`access` itself, or a call through it) that names nothing
 * for a reason already reported, so nothing more is: a name cut short (`x.`), which the parser
 * reported, or one a namespace doesn't export, which the binder did. A value before a cut-short
 * dot is checked all the same, for its own errors and for what tools ask of it; a type or a
 * namespace before a plain `.` qualifies only. Undefined for any other member, still to check.
 */
export function readsNothing(
  context: BodyContext,
  link: Expression,
  access: MemberAccess,
): Type | undefined {
  const qualifier = nameNodeOf(access.target);
  const throughNamespace =
    !access.isOptional &&
    qualifier !== undefined &&
    context.entityOf(qualifier)?.kind === 'namespace';
  if (throughNamespace) {
    return context.entityOf(access.member) === undefined ? errorType : undefined;
  }
  if (!isMissingName(access.member)) {
    return undefined;
  }
  if (access.isOptional || namedType(context, access.target) === undefined) {
    context.chains.target(context, link);
  }
  return errorType;
}

/** Records how `access` reads the field `found`, and the field its member's name names. */
export function recordFieldRead(
  context: BodyContext,
  access: MemberAccess,
  found: FoundField,
): void {
  context.fieldReads.record(access, found.read);
  context.recordField(access.member, found.member);
}

/** The field reads of one body, recorded as each is checked. */
export class FieldReads implements FieldReadRecord {
  readonly #reads = new Map<MemberAccess, FieldRead>();

  record(access: MemberAccess, read: FieldRead): void {
    this.#reads.set(access, read);
  }

  of(access: MemberAccess): FieldRead | undefined {
    return this.#reads.get(access);
  }
}

/**
 * Why `node` reads no field of `type`: it is behind the shared struct `type` is (`->`), or inside
 * the optional it is (`?.`, or `?->` for an optional shared struct), or `node` names a method,
 * read only by calling.
 */
function noField(context: BodyContext, node: MemberAccess, type: Type): Diagnostic<AnchoredSpan> {
  const { checker } = context;
  const { span, text: name } = node.member;
  const behind = (owner: Type) => {
    const sharedValue = checker.sharedValueOf(owner);
    return sharedValue !== undefined && fieldOf(checker, sharedValue, name) !== undefined;
  };
  if (behind(type)) {
    const operator = linkOperator('->', node.isOptional);
    return checkerDiagnostics.fieldBehindShared(span, typeText(type), name, operator);
  }
  const inner = optionalInner(type);
  const reach = inner !== undefined && checker.sharedValueOf(inner) !== undefined ? '->' : '.';
  const inside = insideOptional(span, type, reach);
  if (inside !== undefined) {
    return inside;
  }
  const isMethod = topLevelCandidates(checker, context.module, name, [type]).some(
    ({ declaration }) => isMethodDeclaration(declaration),
  );
  return isMethod
    ? checkerDiagnostics.methodValue(span, name)
    : checkerDiagnostics.unknownField(span, typeText(type), name);
}

/** Which types a member passed to a call can take when the call decides it: a function's (names.ts). */
export function memberAccepts(context: BodyContext, node: MemberAccess): Accepts | undefined {
  const functions = namedFunctions(context, node);
  return functions === undefined ? undefined : functionsAccepted(context, functions);
}
