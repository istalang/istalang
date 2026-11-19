/**
 * Reading a member of a value (§5.2): `s.f`, or a name qualified by a type or a namespace.
 *
 * - Reading `s.f` gives the field's type, substituted for the struct's type arguments; through a
 *   type parameter, a field a constraint requires (§8.2). What else the name may mean is the
 *   receiver's (resolution/choosing/member-meaning.ts): a member that isn't a field may be a
 *   getter, read by calling it (rules/getters.ts), and a name no member has a key of a keyed
 *   `index`, read as `x["k"]` (§10.2); one that is none is reported as unknown here, listing the
 *   keys where keyed indexes take the receiver, or, when it is a field of the value behind a
 *   handle, as to be read with `->` (§10.2); a call of one is a method call (../calls.ts). How each read reaches its field is recorded for lowering
 *   (`FieldReads`, checked-field.ts). A name on a type means one member (§5.2): a use finding a
 *   getter beside a field, or beside a method taking the receiver, is reported where it is used
 *   (`readClash`, `callClash`), the getters and methods counted being those taking the receiver,
 *   and so is any member beside a keyed index taking the name.
 * - A member qualified by a namespace or a type is what it names there: a variant, a function as
 *   a value, a constant; a type's member naming nothing is no static function of it. One cut
 *   short or not exported was reported already, so it reads as nothing (`readsNothing`).
 */

import type { Diagnostic } from '../../../../../foundation/diagnostics/diagnostic.ts';
import { linkOperator } from '../../../../syntax/expressions/chains.ts';
import type { Expression, Index, MemberAccess } from '../../../../syntax/expressions/index.ts';
import { type Identifier, isMissingName } from '../../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { BodyContext, FieldReadRecord } from '../../../contexts/body-context.ts';
import type { Pass, Passes, PassTable } from '../../../contexts/passes.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { stoppedOperation } from '../../../resolution/calls/stopped-operations.ts';
import {
  candidatesOf,
  keyedIndexes,
  keyNamesOf,
} from '../../../resolution/choosing/keyed-indexes.ts';
import { membersNamed, type NamedMembers } from '../../../resolution/choosing/member-meaning.ts';
import { namedFunctions } from '../../../resolution/choosing/named-functions.ts';
import { readGetter, readKeyed } from '../../../rules/getters.ts';
import type { FieldRead, FieldReading, FoundField } from '../../../surface/checked-field.ts';
import { fieldOf } from '../../../types/traits/known-fields.ts';
import type { Type } from '../../../types/type/index.ts';
import { errorType, isPrimitive, neverType } from '../../../types/type/primitives.ts';
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
    const missed = { node, written: node.target, name: node.member.text, at: node.member.span };
    return missedStatic(context, missed, owner);
  }
  const type = context.chains.target(context, node);
  const stopped = stoppedOperation(context, node, [{ node: node.target, type }]);
  if (stopped !== undefined) {
    return stopped;
  }
  const members = membersNamed(context.checker, context.module, node.member.text, type);
  const clash = readClash(node.member, type, members);
  if (clash !== undefined) {
    context.report(clash);
    return errorType;
  }
  const { field, getters, methods, keyed } = members;
  if (field !== undefined) {
    recordFieldRead(context, node, field);
    return field.member.type;
  }
  const read = { link: node, access: node, receiver: type, expected };
  if (getters.met.length > 0) {
    return readGetter(context, read, getters.met);
  }
  if (keyed.length > 0) {
    return readKeyed(context, read, candidatesOf(keyed));
  }
  const isMethod = methods.met.length + methods.unmet.length > 0;
  const missed = missExplained(context, node, type, isMethod);
  // A getter whose constraints fail is reported as its call would be, where nothing else explains
  // the read.
  if (missed === undefined && getters.unmet.length > 0) {
    return readGetter(context, read, getters.unmet);
  }
  context.report(
    missed ??
      keyMissed(context, node.member, type) ??
      checkerDiagnostics.unknownField(node.member.span, typeText(type), node.member.text),
  );
  return errorType;
}

/**
 * What gives `x.name` a value to read: the field, else a getter, else a keyed index; none for
 * methods alone.
 */
export function valuedMember({
  field,
  getters,
  keyed,
}: NamedMembers): 'field' | 'getter' | 'keyed' | undefined {
  if (field !== undefined) {
    return 'field';
  }
  if (getters.met.length > 0) {
    return 'getter';
  }
  return keyed.length > 0 ? 'keyed' : undefined;
}

/** What `x.name` names among the members of its receiver: a field, a getter or a method taking it. */
function memberKind({
  field,
  getters,
  methods,
}: NamedMembers): 'field' | 'getter' | 'method' | undefined {
  if (field !== undefined) {
    return 'field';
  }
  if (getters.met.length > 0) {
    return 'getter';
  }
  return methods.met.length > 0 ? 'method' : undefined;
}

/**
 * Why reading `x.name` means two things on its receiver (§5.2): a field and a getter, any member
 * and a keyed index taking the name, or a getter beside a method taking the receiver; a read reads
 * a field whatever methods share its name.
 */
function readClash(
  name: Identifier,
  receiver: Type,
  members: NamedMembers,
): Diagnostic<AnchoredSpan> | undefined {
  const clash =
    fieldBesideGetter(name, receiver, members) ?? keyedBesideMember(name, receiver, members);
  return clash ?? (members.field === undefined ? besideMethod(name, receiver, members) : undefined);
}

/**
 * Why calling `x.name(…)` means two things on its receiver: a field and a getter, any member and a
 * keyed index taking the name, or a field or a getter beside a method taking the receiver, which
 * the call could call as well (§5.2, §6.2).
 */
export function callClash(
  name: Identifier,
  receiver: Type,
  members: NamedMembers,
): Diagnostic<AnchoredSpan> | undefined {
  return (
    fieldBesideGetter(name, receiver, members) ??
    keyedBesideMember(name, receiver, members) ??
    besideMethod(name, receiver, members)
  );
}

/** Why a keyed index taking `name` stands beside a member of the name (§5.2, §10.2). */
function keyedBesideMember(
  name: Identifier,
  receiver: Type,
  members: NamedMembers,
): Diagnostic<AnchoredSpan> | undefined {
  if (members.keyed.length === 0) {
    return undefined;
  }
  const member = memberKind(members);
  return member === undefined
    ? undefined
    : checkerDiagnostics.keyedOrMember(name.span, typeText(receiver), name.text, member);
}

function fieldBesideGetter(
  name: Identifier,
  receiver: Type,
  { field, getters }: NamedMembers,
): Diagnostic<AnchoredSpan> | undefined {
  return field !== undefined && getters.met.length > 0
    ? checkerDiagnostics.fieldOrGetter(name.span, typeText(receiver), name.text)
    : undefined;
}

/**
 * Why the field or getter `members` give `x.name` stands beside a method of the name taking the
 * receiver; a keyed index beside one is `keyedBesideMember`'s.
 */
function besideMethod(
  name: Identifier,
  receiver: Type,
  members: NamedMembers,
): Diagnostic<AnchoredSpan> | undefined {
  const valued = valuedMember(members);
  const beside = valued !== undefined && valued !== 'keyed' && members.methods.met.length > 0;
  return beside
    ? checkerDiagnostics.fieldOrMethod(name.span, typeText(receiver), name.text, valued)
    : undefined;
}

/**
 * A static member `name` no function of `owner`, the type `written` names in value position, is
 * (§6.2), read or called alike: through a pass over no field (§11.2), `Never`, `node` stops, as that pass never
 * runs; through a type indexed by a key naming no field of it, `S[Int].make` (§8.2), it is
 * reported at the key; through any other owner in error, nothing more; else as no static function
 * of the name, `at`.
 */
export function missedStatic(
  context: BodyContext,
  missed: {
    readonly node: Expression;
    readonly written: Expression;
    readonly name: string;
    readonly at: AnchoredSpan;
  },
  owner: Type,
): Type {
  if (isPrimitive(owner, 'Never')) {
    context.decisions.stopAt(missed.node, []);
    return neverType;
  }
  if (owner.kind !== 'error') {
    context.report(checkerDiagnostics.noStaticFunction(missed.at, typeText(owner), missed.name));
  } else if (missed.written.kind === 'Index') {
    reportNotKeyOf(context, missed.written);
  }
  return errorType;
}

/** A type indexed by a key naming none of its fields, reported at the key. */
function reportNotKeyOf(context: BodyContext, indexed: Index): void {
  const owner = namedType(context, indexed.target);
  const key = namedType(context, indexed.index);
  if (owner !== undefined && key !== undefined && owner.kind !== 'error' && key.kind !== 'error') {
    context.report(checkerDiagnostics.notKeyOf(indexed.index.span, typeText(key), typeText(owner)));
  }
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
 * Why `node` reads no field of `type`, where something explains it: it is behind the shared struct
 * `type` is (`->`), or inside the optional it is (`?.`, or `?->` for an optional shared struct), or
 * `node` names a method taking it (`isMethod`), read only by calling.
 */
function missExplained(
  context: BodyContext,
  node: MemberAccess,
  type: Type,
  isMethod: boolean,
): Diagnostic<AnchoredSpan> | undefined {
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
  return isMethod ? checkerDiagnostics.methodValue(span, name) : undefined;
}

/**
 * Why `name` names nothing on `receiver` where keyed indexes take it (§10.2): none takes the name,
 * so the keys they take are listed; undefined where none takes it.
 */
export function keyMissed(
  context: BodyContext,
  name: Identifier,
  receiver: Type,
): Diagnostic<AnchoredSpan> | undefined {
  const indexes = keyedIndexes(context.checker, context.module, receiver);
  if (indexes.length === 0) {
    return undefined;
  }
  const keys = [...new Set(indexes.flatMap(keyNamesOf))];
  return checkerDiagnostics.unknownKey(name.span, typeText(receiver), name.text, keys);
}
