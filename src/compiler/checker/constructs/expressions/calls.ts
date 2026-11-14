/**
 * Calls (§3.3, §3.7, §3.10): the callee names a set of candidates, and the arguments' types choose
 * one (resolution/). A callee is written as:
 *
 * - a function's name, plain or through a namespace (`m.f()`), which looks only in that module,
 *   with no argument-dependent lookup (§3.13);
 * - a type and a static function (`Duration.zero()`, `T.zero()`, `time.Duration.zero()`);
 * - a type alone, a conversion (`Float(3)`), which calls the type's static `from` (§3.10);
 * - a variant with fields, bare or qualified (`Ok(v)`, `Verdict.Rejected(by: "legal")`), which
 *   calls its constructor (structs/variants.ts, §3.11), its one candidate, as any generic call.
 *   A function value's parameters are known before its arguments, so each argument by position
 *   is checked against its parameter's type (closures/value-calls.ts).
 *
 * - a method called on a receiver (`x.f()`): a function whose first parameter is `self`, found by
 *   its name where the call is written and through the receiver's type (argument-dependent
 *   lookup), with the receiver as its first argument (§3.7). Which overload the receiver's type
 *   picks decides whether `self` is a reference, and only then must the receiver be a place that
 *   may change.
 * - a function value: a variable, a field of the receiver or what its getter gives (§3.1), or any
 *   other expression of a function type (constructs/closures/value-calls.ts), or of an optional
 *   one, called as `f?.(…)`, a link of an optional chain (access/optionals.ts). `x.f()` naming both
 *   a field or a getter and a method of `x`'s type is ambiguous, so it is reported; `(x.f)()` calls
 *   what the field holds or the getter gives.
 * - `worker.disposing()`, a method of the call an async function's own name is before a `.`
 *   (constructs/closures/own-calls.ts).
 *
 * An argument written `&x` passes the place `x` by reference, which must be a place that may change
 * (resolution/calls/places.ts). A named argument fills the parameter of its name, and a spread a
 * rest parameter (§3.3, resolution/choosing/binding.ts). An argument given by position after a
 * named one was reported by the parser, so it counts as the error type: the call still checks its
 * arguments and records the candidates a tool shows while the call is being written, and reports
 * nothing more.
 *
 * A call may give a function after its arguments (`Call.given`), which binding gives the first
 * parameter they leave unfilled of a function type taking nothing: a deferred call is checked as such
 * a call (checker/desugaring/deferred-calls.ts, §3.14), so every form of callee above may take one.
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import { staticName } from '../../../../foundation/language/static-names.ts';
import { conversionFunction } from '../../../../foundation/language/well-known/implicit-calls.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Entity } from '../../../binder/entities.ts';
import { misplacedArgument } from '../../../syntax/expressions/arguments.ts';
import type { Call } from '../../../syntax/expressions/calls.ts';
import type { MemberAccess } from '../../../syntax/expressions/index.ts';
import {
  calledName,
  callTypeArguments,
  writtenArgumentsOf,
} from '../../../syntax/expressions/readings.ts';
import { type Identifier, isMissingName } from '../../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { resolveCall, type WrittenArgument } from '../../resolution/calls/resolve/index.ts';
import { stoppedOperation, stops } from '../../resolution/calls/stopped-operations.ts';
import {
  callableThrough,
  callCandidates,
  receiverMembers,
  staticCandidates,
  staticTargetOf,
  topLevelCandidates,
} from '../../resolution/choosing/candidates.ts';
import { readGetter } from '../../rules/getters.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';
import { insideOptional } from '../../types/unions/inside-optional.ts';
import { namedType } from '../../types/written/named-types.ts';
import { checkValueCall, valueParameterTypes } from '../closures/value-calls.ts';
import {
  callClash,
  membersNamed,
  type NamedMembers,
  readsNothing,
  readsThroughNamespace,
  recordFieldRead,
} from './access/member-access.ts';
import { writtenArgument } from './call-arguments.ts';
import { checkVariantCall } from './structs/variants.ts';

/**
 * Checks a call in the current constraint scope (wiring/body/constraint-scope.ts); one continuing an
 * optional chain, whose value the chain carries and wraps (access/optionals.ts), in a scope of its
 * own, once what it is called on is read.
 */
export function checkCall(context: BodyContext, node: Call, expected: Type | undefined): Type {
  const value = calledValue(context, node);
  const check = () => checkCallMade(context, node, expected, value);
  return context.chains.continues(node) ? context.scopes.isolated(check) : check();
}

/**
 * Checks a call whose callee's value, if it has one, is read: its arguments, then what it calls.
 * One that can't be made gives the error type where its arguments go (`BodyContext.abandon`).
 */
function checkCallMade(
  context: BodyContext,
  node: Call,
  expected: Type | undefined,
  value: CalledValue | undefined,
): Type {
  const misplaced = misplacedArgument(node.arguments);
  const typeArguments = callTypeArguments(node)?.map((argument) => context.resolveType(argument));
  const known = valueParameterTypes(value?.type, node.arguments, typeArguments);
  const written = writtenArgumentsOf(node).map((argument, index): WrittenArgument => {
    if (argument === misplaced) {
      return { ...writtenArgument(context, argument, undefined), type: errorType };
    }
    const checked = writtenArgument(context, argument, known[index]);
    return argument === node.given ? { ...checked, isDeferred: true } : checked;
  });
  const call: WrittenCall = { node, expected, typeArguments, written };
  const type = calledBy(context, call, value);
  if (type.kind === 'error') {
    context.scopes.abandon(call.written.map((argument) => argument.type));
  }
  return type;
}

/** What `call` calls, by what its callee is, given what was read of its value. */
function calledBy(context: BodyContext, call: WrittenCall, value: CalledValue | undefined): Type {
  const { node } = call;
  const callee = calledName(node);
  if (node.isOptional) {
    return checkValueCall(context, call, callee, value?.type ?? errorType);
  }
  if (value !== undefined && value.member === undefined) {
    return checkValueCall(context, call, callee, value.type ?? errorType);
  }
  switch (callee.kind) {
    case 'Identifier':
      return callEntity(context, call, callee, context.entityOf(callee));
    case 'MemberAccess': {
      const nothing = readsNothing(context, call.node, callee);
      if (nothing !== undefined) {
        return nothing;
      }
      const entity = context.entityOf(callee.member);
      if (entity !== undefined) {
        return callEntity(context, call, callee, entity);
      }
      const owner = namedType(context, callee.target);
      return owner === undefined
        ? callMethod(context, call, callee, value)
        : callStatic(context, call, owner, callee.member.text);
    }
    default:
      return checkValueCall(context, call, callee);
  }
}

/**
 * What a call reads before its arguments, by its callee: a function value (a variable, an
 * expression other than a name, an optional call's target, §3.14), a member of a receiver, read
 * first (§3.7), or nothing, for a function named: a missing name, a namespace's member, a type's
 * static function, a function or a variant.
 */
export type CalleeRead =
  | { readonly kind: 'value' }
  | { readonly kind: 'member'; readonly access: MemberAccess }
  | { readonly kind: 'named' };

export function calleeRead(context: BodyContext, node: Call): CalleeRead {
  if (node.isOptional) {
    return { kind: 'value' };
  }
  const callee = calledName(node);
  switch (callee.kind) {
    case 'Identifier':
      return { kind: context.entityOf(callee)?.kind === 'variable' ? 'value' : 'named' };
    case 'MemberAccess':
      return isMissingName(callee.member) ||
        readsThroughNamespace(context, callee) ||
        context.entityOf(callee.member) !== undefined ||
        namedType(context, callee.target) !== undefined
        ? { kind: 'named' }
        : { kind: 'member', access: callee };
    default:
      return { kind: 'value' };
  }
}

/**
 * What a call calls, when its type is known before its arguments (`calleeRead`): a function
 * value's type, or for `x.f(…)` the receiver's, read once here for the call, with what `f` means
 * on it and the type of the value its field holds or its getter gives, the getter read now as a
 * field is (§3.1), unless the receiver stops the call or `f` means two things, which the call
 * reports.
 */
function calledValue(context: BodyContext, node: Call): CalledValue | undefined {
  const read = calleeRead(context, node);
  const callee = calledName(node);
  switch (read.kind) {
    case 'named':
      return undefined;
    case 'member': {
      const { access } = read;
      const receiver = context.chains.target(context, node);
      const members = membersNamed(context, access.member.text, receiver);
      const clash = callClash(context, access.member, receiver, members);
      const { field, getters } = members;
      const readsGetter =
        !stops(receiver) && clash === undefined && field === undefined && getters.length > 0;
      const getter = { link: node, access, receiver, getters, expected: undefined };
      return {
        type: readsGetter ? readGetter(context, getter) : field?.member.type,
        member: { receiver, members, clash },
      };
    }
    default:
      if (node.isOptional) {
        return { type: context.chains.target(context, node) };
      }
      return {
        type: callee.kind === 'Identifier' ? context.expression(callee) : context.settled(callee),
      };
  }
}

/**
 * The type of what a call calls, when it is known before its arguments, and for `x.f(…)` what was
 * read then of its member.
 */
interface CalledValue {
  readonly type: Type | undefined;
  readonly member?: MemberRead;
}

/** What `x.f(…)` reads before its arguments: the receiver's type, what `f` means on it, and why two. */
interface MemberRead {
  readonly receiver: Type;
  readonly members: NamedMembers;
  readonly clash: Diagnostic<AnchoredSpan> | undefined;
}

/**
 * `x.f(…)`: `f` called with `x` as its `self` (§3.7); also as a link of an optional chain, which
 * calls it on the value inside and never through `&self` (access/optionals.ts). A field or a getter
 * of that name gives a function value to call instead (§3.14), read before the arguments
 * (`calledValue`); either beside a method of that name is ambiguous.
 */
function callMethod(
  context: BodyContext,
  call: WrittenCall,
  callee: MemberAccess,
  read: CalledValue | undefined,
): Type {
  const { checker, module } = context;
  const receiver = callee.target;
  const {
    receiver: receiverType,
    members,
    clash,
  } = read?.member ?? unreachable('A method call reads its member before its arguments.');
  const stopped = stoppedOperation(context, call.node, [{ node: receiver, type: receiverType }]);
  if (stopped !== undefined) {
    return stopped;
  }
  if (clash !== undefined) {
    context.report(clash);
    return errorType;
  }
  const { field, getters } = members;
  if (field !== undefined) {
    recordFieldRead(context, callee, field);
    return checkValueCall(context, call, callee, field.member.type);
  }
  if (getters.length > 0) {
    return checkValueCall(context, call, callee, read?.type ?? errorType);
  }
  const name = callee.member.text;
  const written = [
    { node: receiver, passing: 'receiver', type: receiverType } as const,
    ...call.written,
  ];
  // The other arguments' types find methods too (§3.13), which a member's meaning leaves aside.
  const others = call.written.map(({ type }) => type);
  const { methods } = receiverMembers(
    checker,
    topLevelCandidates(checker, module, name, [receiverType, ...others]),
  );
  const candidates = callableThrough(checker, callee, methods);
  if (candidates.length === 0) {
    context.report(
      methods.length > 0
        ? checkerDiagnostics.receiverNotPlace(receiver.span, name)
        : checkerDiagnostics.noMember(callee.member.span, typeText(receiverType), name),
    );
    return errorType;
  }
  return resolveCall(context, {
    site: call.node,
    recorded: call.node,
    name,
    candidates,
    arguments: written,
    typeArguments: call.typeArguments,
    expected: call.expected,
    form: 'call',
    receiver,
    hint: () => insideOptional(receiver.span, receiverType, '.'),
  });
}

/** A call with plain arguments, each checked unless the chosen function decides its type. */
interface WrittenCall {
  readonly node: Call;
  readonly expected: Type | undefined;
  readonly typeArguments: readonly Type[] | undefined;
  readonly written: readonly WrittenArgument[];
}

function callEntity(
  context: BodyContext,
  call: WrittenCall,
  callee: Identifier | MemberAccess,
  entity: Entity | undefined,
): Type {
  const name = callee.kind === 'Identifier' ? callee.text : callee.member.text;
  switch (entity?.kind) {
    case 'functions': {
      const { checker } = context;
      const named = checker.bindings.overloadsOf(entity);
      const types = call.written.map(({ type }) => type);
      const throughNamespace = callee.kind === 'MemberAccess';
      const candidates = throughNamespace
        ? named.map((declaration) => ({ declaration }))
        : callCandidates(checker, named, name, types);
      return resolve(context, call, name, candidates);
    }
    case undefined:
      return errorType;
    case 'variable':
      return checkValueCall(context, call, callee);
    case 'variant':
    case 'variants':
      return checkVariantCall(context, call, callee, entity);
    case 'type':
    case 'primitive': {
      // A trait names no type, so nothing converts into it (§3.10): it can't be called.
      const owner = namedType(context, callee);
      if (owner !== undefined) {
        return callStatic(context, call, owner, conversionFunction);
      }
      break;
    }
    default:
      break;
  }
  context.report(checkerDiagnostics.notCallable(callee.span, name));
  return errorType;
}

/** A static call of `name` through the type `owner` (§3.7), a conversion being one (§3.10). */
function callStatic(context: BodyContext, call: WrittenCall, owner: Type, name: string): Type {
  const { checker, module } = context;
  const target = staticTargetOf(checker, owner);
  const candidates = target === undefined ? [] : staticCandidates(checker, module, target, name);
  if (candidates.length === 0) {
    if (owner.kind !== 'error') {
      context.report(checkerDiagnostics.noStaticFunction(call.node.span, typeText(owner), name));
    }
    return errorType;
  }
  return resolve(context, call, staticName(typeText(owner), name), candidates);
}

function resolve(
  context: BodyContext,
  call: WrittenCall,
  name: string,
  candidates: Parameters<typeof resolveCall>[1]['candidates'],
): Type {
  return resolveCall(context, {
    site: call.node,
    recorded: call.node,
    name,
    candidates,
    arguments: call.written,
    typeArguments: call.typeArguments,
    expected: call.expected,
    form: 'call',
  });
}
