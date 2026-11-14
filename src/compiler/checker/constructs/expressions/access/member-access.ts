/**
 * Reading a member of a value (§3.1): `s.f`, or a name qualified by a type or a namespace.
 *
 * - Reading `s.f` gives the field's type, substituted for the struct's type arguments; through a
 *   type parameter, a field a constraint requires (§3.10). A member that isn't a field may be a
 *   getter, read by calling it (rules/getters.ts); one that is neither is reported as unknown here,
 *   or, when it is a field of the value behind a handle, as to be read with `->` (§3.9); a call of
 *   one is a method call (../calls.ts). How each read reaches its field is recorded for lowering
 *   (`FieldReads`, checked-field.ts). A name on a type means one member (§3.1): a use finding a
 *   getter beside a field, or beside a method taking the receiver, is reported where it is used
 *   (`readClash`, `callClash`), the getters and methods counted being those taking the receiver.
 * - A member qualified by a namespace or a type is what it names there: a variant, a function as
 *   a value, a constant; a type's member naming nothing is no static function of it. One cut
 *   short or not exported was reported already, so it reads as nothing (`readsNothing`).
 */

import type { Diagnostic } from '../../../../../foundation/diagnostics/diagnostic.ts';
import { linkOperator } from '../../../../syntax/expressions/chains.ts';
import type { Expression, MemberAccess } from '../../../../syntax/expressions/index.ts';
import { type Identifier, isMissingName } from '../../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { BodyContext, FieldReadRecord } from '../../../contexts/body-context.ts';
import type { Pass, Passes, PassTable } from '../../../contexts/passes.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { stoppedOperation } from '../../../resolution/calls/stopped-operations.ts';
import {
  type Candidate,
  receiverMembers,
  topLevelCandidates,
} from '../../../resolution/choosing/candidates.ts';
import { namedFunctions } from '../../../resolution/choosing/named-functions.ts';
import { takesAsSelf } from '../../../resolution/choosing/receivers.ts';
import { readGetter } from '../../../rules/getters.ts';
import type { FieldRead, FieldReading, FoundField } from '../../../surface/checked-field.ts';
import { fieldOf } from '../../../types/traits/known-fields.ts';
import type { Type } from '../../../types/type/index.ts';
import { errorType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';
import { insideOptional } from '../../../types/unions/inside-optional.ts';
import { optionalInner } from '../../../types/unions/unions.ts';
import { namedType, nameNodeOf } from '../../../types/written/named-types.ts';
import { checkFunctionValue } from '../../closures/function-values.ts';
import { checkVariantValue } from '../structs/variants.ts';
import { entityValueType } from './names.ts';

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
    return checkVariantValue(context, node, qualified, expected);
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
  const stopped = stoppedOperation(context, node, [{ node: node.target, type }]);
  if (stopped !== undefined) {
    return stopped;
  }
  const members = membersNamed(context, node.member.text, type);
  const clash = readClash(context, node.member, type, members);
  if (clash !== undefined) {
    context.report(clash);
    return errorType;
  }
  const { field, getters, methods } = members;
  if (field !== undefined) {
    recordFieldRead(context, node, field);
    return field.member.type;
  }
  if (getters.length > 0) {
    return readGetter(context, { link: node, access: node, receiver: type, getters, expected });
  }
  context.report(noField(context, node, type, methods));
  return errorType;
}

/** What a member's name may mean through a receiver (§3.1, §3.7). */
export interface NamedMembers {
  readonly field: FoundField | undefined;
  /** The getters of the name taking the receiver as `self`. */
  readonly getters: readonly Candidate[];
  /** The methods of the name the receiver's type finds, which a call chooses among. */
  readonly methods: readonly Candidate[];
}

/** What gives `x.name` a value to read: the field, else a getter; none for methods alone. */
export function valuedMember({ field, getters }: NamedMembers): 'field' | 'getter' | undefined {
  if (field !== undefined) {
    return 'field';
  }
  return getters.length > 0 ? 'getter' : undefined;
}

/**
 * What `x.name` may mean on a receiver of type `receiver`: its field of that name, and the getters
 * and methods of that name its type finds (§3.7), as a member of the type, whatever a call's other
 * arguments find.
 */
export function membersNamed(context: BodyContext, name: string, receiver: Type): NamedMembers {
  const { checker, module } = context;
  const candidates = topLevelCandidates(checker, module, name, [receiver]);
  const { methods, getters } = receiverMembers(checker, candidates);
  return {
    field: fieldOf(checker, receiver, name),
    getters: getters.filter((getter) => takesAsSelf(checker, getter, receiver)),
    methods,
  };
}

/**
 * Why reading `x.name` means two things on its receiver (§3.1): a field and a getter, or a getter
 * beside a method taking the receiver; a read reads a field whatever methods share its name.
 */
function readClash(
  context: BodyContext,
  name: Identifier,
  receiver: Type,
  members: NamedMembers,
): Diagnostic<AnchoredSpan> | undefined {
  const clash = fieldBesideGetter(name, receiver, members);
  return (
    clash ??
    (members.field === undefined ? besideMethod(context, name, receiver, members) : undefined)
  );
}

/**
 * Why calling `x.name(…)` means two things on its receiver: a field and a getter, or either beside
 * a method taking the receiver, which the call could call as well (§3.1, §3.7).
 */
export function callClash(
  context: BodyContext,
  name: Identifier,
  receiver: Type,
  members: NamedMembers,
): Diagnostic<AnchoredSpan> | undefined {
  return (
    fieldBesideGetter(name, receiver, members) ?? besideMethod(context, name, receiver, members)
  );
}

function fieldBesideGetter(
  name: Identifier,
  receiver: Type,
  { field, getters }: NamedMembers,
): Diagnostic<AnchoredSpan> | undefined {
  return field !== undefined && getters.length > 0
    ? checkerDiagnostics.fieldOrGetter(name.span, typeText(receiver), name.text)
    : undefined;
}

/** Why the value `members` give `x.name` stands beside a method of the name taking the receiver. */
function besideMethod(
  context: BodyContext,
  name: Identifier,
  receiver: Type,
  members: NamedMembers,
): Diagnostic<AnchoredSpan> | undefined {
  const valued = valuedMember(members);
  const beside =
    valued !== undefined &&
    members.methods.some((method) => takesAsSelf(context.checker, method, receiver));
  return beside
    ? checkerDiagnostics.fieldOrMethod(name.span, typeText(receiver), name.text, valued)
    : undefined;
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
  if (readsThroughNamespace(context, access)) {
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

/** Whether `access` reads a namespace's member, `math.parse`, rather than a value's. */
export function readsThroughNamespace(context: BodyContext, access: MemberAccess): boolean {
  const qualifier = nameNodeOf(access.target);
  return (
    !access.isOptional &&
    qualifier !== undefined &&
    context.entityOf(qualifier)?.kind === 'namespace'
  );
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

/** The field reads of one body, by name or by key, recorded as each is checked. */
export class FieldReads implements FieldReadRecord {
  readonly #reads: PassTable<FieldReading, FieldRead>;

  constructor(passes: Passes) {
    this.#reads = passes.table();
  }

  record(reading: FieldReading, read: FieldRead): void {
    this.#reads.set(reading, read);
  }

  of(reading: FieldReading, pass?: Pass): FieldRead | undefined {
    return this.#reads.get(reading, pass);
  }
}

/**
 * Why `node` reads no field of `type`: it is behind the shared struct `type` is (`->`), or inside
 * the optional it is (`?.`, or `?->` for an optional shared struct), or `node` names one of
 * `methods`, read only by calling.
 */
function noField(
  context: BodyContext,
  node: MemberAccess,
  type: Type,
  methods: readonly Candidate[],
): Diagnostic<AnchoredSpan> {
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
  return methods.length > 0
    ? checkerDiagnostics.methodValue(span, name)
    : checkerDiagnostics.unknownField(span, typeText(type), name);
}
