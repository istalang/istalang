/**
 * Calls (§3.3, §3.7, §3.10): the callee names a set of candidates, and the arguments' types choose
 * one (resolution/, calls/). A callee is written as:
 *
 * - a function's name, plain or through a namespace (`m.f()`), which looks only in that module,
 *   with no argument-dependent lookup (§3.13);
 * - a type and a static function (`Duration.zero()`, `T.zero()`, `time.Duration.zero()`);
 * - a type alone, a conversion (`float(3)`), which calls the type's static `from` (§3.10).
 *
 * - a method called on a receiver (`x.f()`): a function whose first parameter is `self`, found by
 *   its name where the call is written and through the receiver's type (argument-dependent
 *   lookup), with the receiver as its first argument (§3.7). Which overload the receiver's type
 *   picks decides whether `self` is a reference, and only then must the receiver be a place that
 *   may change.
 * - a function value: a variable, a field of the receiver, or any other expression of a function
 *   type (closures/value-calls.ts), or of an optional one, called as `f?.(…)`, a link of an
 *   optional chain (optionals.ts). `x.f()` naming both a field and a method of `x`'s type is
 *   ambiguous, so it is reported; `(x.f)()` calls the field.
 * - `worker.disposing()`, a method of the call an async function's own name is before a `.`
 *   (closures/own-calls.ts).
 *
 * An argument written `&x` passes the place `x` by reference, which must be a place that may
 * change (calls/places.ts). Spread arguments are reported as not supported until the feature that
 * adds them.
 */

import { conversionFunction } from '../../../language/well-known.ts';
import type { Entity } from '../../binder/entities.ts';
import { isMethod } from '../../syntax/declarations.ts';
import type { Call, Expression, MemberAccess } from '../../syntax/expressions.ts';
import { checkChangedPlace } from '../calls/places.ts';
import { resolveCall, type WrittenArgument } from '../calls/resolve.ts';
import { checkValueCall } from '../closures/value-calls.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { frontier } from '../frontier.ts';
import {
  callCandidates,
  staticCandidates,
  staticTargetOf,
  topLevelCandidates,
} from '../resolution/candidates.ts';
import { namedType } from '../resolution/named.ts';
import { errorType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';

export function checkCall(context: BodyContext, node: Call, expected: Type | undefined): Type {
  const argumentNodes: Expression[] = [];
  for (const argument of node.arguments) {
    if (argument.kind === 'Spread') {
      return context.unsupported(argument, frontier.spreadArgument);
    }
    argumentNodes.push(argument);
  }
  const call: WrittenCall = {
    node,
    expected,
    typeArguments:
      node.typeArguments.length === 0
        ? undefined
        : node.typeArguments.map((argument) => context.resolveType(argument)),
    written: argumentNodes.map((argument) => writtenArgument(context, argument)),
  };
  const { callee } = node;
  if (node.isOptional) {
    return checkValueCall(context, call, callee, context.chains.target(context, node));
  }
  switch (callee.kind) {
    case 'Identifier':
      return callEntity(context, call, callee.text, context.entityOf(callee));
    case 'MemberAccess': {
      const entity = context.entityOf(callee.member);
      if (entity !== undefined) {
        return callEntity(context, call, callee.member.text, entity);
      }
      const owner = namedType(context, callee.target);
      return owner === undefined
        ? callMethod(context, call, callee)
        : callStatic(context, call, owner, callee.member.text);
    }
    default:
      return checkValueCall(context, call, callee);
  }
}

/**
 * An argument as written: `&x` passes the place `x`, checked as a place that may change; any
 * other is a value, checked now unless the chosen function decides its type.
 */
function writtenArgument(context: BodyContext, argument: Expression): WrittenArgument {
  if (argument.kind === 'Reference') {
    const type = checkChangedPlace(context, argument.expression, 'referenced');
    return { node: argument, passing: 'reference', type };
  }
  const accepts = context.accepts(argument);
  return {
    node: argument,
    passing: 'value',
    type: accepts === undefined ? context.expression(argument) : undefined,
    accepts,
  };
}

/**
 * `x.f(…)`: `f` called with `x` as its `self` (§3.7); also as a link of an optional chain, which
 * calls it on the value inside and never through `&self` (optionals.ts).
 */
function callMethod(context: BodyContext, call: WrittenCall, callee: MemberAccess): Type {
  const { checker, chains } = context;
  const receiver = callee.target;
  const receiverType = chains.target(context, call.node);
  const chained = chains.continues(call.node);
  if (receiverType.kind === 'error') {
    return errorType;
  }
  const name = callee.member.text;
  const field = checker.fieldsOf(receiverType)?.find((each) => each.name === name);
  const written = [
    { node: receiver, passing: 'receiver', type: receiverType } as const,
    ...call.written,
  ];
  const types = written.map(({ type }) => type);
  const methods = topLevelCandidates(checker, context.module, name, types).filter(
    ({ declaration }) => isMethod(declaration),
  );
  if (field !== undefined && methods.length > 0) {
    context.report(
      checkerDiagnostics.fieldOrMethod(callee.member.span, typeText(receiverType), name),
    );
    return errorType;
  }
  if (field !== undefined) {
    return checkValueCall(context, call, callee, field.type);
  }
  const candidates = chained
    ? methods.filter(({ declaration }) => checker.parametersOf(declaration)[0]?.reference !== true)
    : methods;
  if (candidates.length === 0) {
    context.report(
      methods.length > 0
        ? checkerDiagnostics.chainNotPlace(callee.member.span)
        : checkerDiagnostics.noMember(callee.member.span, typeText(receiverType), name),
    );
    return errorType;
  }
  return resolveCall(context, {
    site: call.node,
    name,
    candidates,
    arguments: written,
    typeArguments: call.typeArguments,
    expected: call.expected,
    form: 'call',
    receiver,
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
  name: string,
  entity: Entity | undefined,
): Type {
  switch (entity?.kind) {
    case 'functions': {
      const { checker } = context;
      const named = checker.bindings.overloadsOf(entity);
      const types = call.written.map(({ type }) => type);
      const throughNamespace = call.node.callee.kind === 'MemberAccess';
      const candidates = throughNamespace
        ? named.map((declaration) => ({ declaration }))
        : callCandidates(checker, named, name, types);
      return resolve(context, call, name, candidates);
    }
    case undefined:
      return errorType;
    case 'variable':
      return checkValueCall(context, call, call.node.callee);
    case 'type':
    case 'primitive': {
      const owner = namedType(context, call.node.callee);
      return owner === undefined ? errorType : callStatic(context, call, owner, conversionFunction);
    }
    default:
      context.report(checkerDiagnostics.notCallable(call.node.callee.span, name));
      return errorType;
  }
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
  return resolve(context, call, `${typeText(owner)}.${name}`, candidates);
}

function resolve(
  context: BodyContext,
  call: WrittenCall,
  name: string,
  candidates: Parameters<typeof resolveCall>[1]['candidates'],
): Type {
  return resolveCall(context, {
    site: call.node,
    name,
    candidates,
    arguments: call.written,
    typeArguments: call.typeArguments,
    expected: call.expected,
    form: 'call',
  });
}
