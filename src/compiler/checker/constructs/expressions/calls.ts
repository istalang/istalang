/**
 * Calls (§3.3, §3.7, §3.10): the callee names a set of candidates, and the arguments' types choose
 * one (resolution/). A callee is written as:
 *
 * - a function's name, plain or through a namespace (`m.f()`), which looks only in that module,
 *   with no argument-dependent lookup (§3.13);
 * - a type and a static function (`Duration.zero()`, `T.zero()`, `time.Duration.zero()`);
 * - a type alone, a conversion (`Float(3)`), which calls the type's static `from` (§3.10);
 * - a variant with fields, bare or qualified (`Ok(v)`, `Verdict.Rejected(by: "legal")`), which
 *   calls its constructor (structs/variants.ts, §3.11), its one candidate, whose parameters, its
 *   fields, are known before the arguments where its type arguments are: each argument filling
 *   one is checked against it, a misfit reported there (resolution/calls/known-parameters.ts).
 *   A function value's parameters are known before its arguments alike, so each argument by
 *   position is checked against its parameter's type (closures/value-calls.ts).
 *
 * - a method called on a receiver (`x.f()`): a function whose first parameter is `self`, found by
 *   its name where the call is written and through the receiver's type (argument-dependent
 *   lookup), with the receiver as its first argument (§3.7). Which overload the receiver's type
 *   picks decides whether `self` is a reference, and only then must the receiver be a place that
 *   may change.
 * - a function value: a variable, a field of the receiver, or any other expression of a function
 *   type (constructs/closures/value-calls.ts), or of an optional one, called as `f?.(…)`, a link of
 *   an optional chain (access/optionals.ts). `x.f()` naming both a field and a method of `x`'s type
 *   is ambiguous, so it is reported; `(x.f)()` calls the field.
 * - `worker.disposing()`, a method of the call an async function's own name is before a `.`
 *   (constructs/closures/own-calls.ts).
 *
 * An argument written `&x` passes the place `x` by reference, which must be a place that may change
 * (resolution/calls/places.ts). A named argument fills the parameter of its name, and a spread a
 * rest parameter (§3.3, resolution/choosing/binding.ts). An argument given by position after a
 * named one was reported by the parser, so it counts as the error type: the call still checks its
 * arguments and records the candidates a tool shows while the call is being written, and reports
 * nothing more.
 */

import { staticName } from '../../../../foundation/language/static-names.ts';
import { conversionFunction } from '../../../../foundation/language/well-known/implicit-calls.ts';
import type { Entity } from '../../../binder/entities.ts';
import { isMethod } from '../../../syntax/declarations/methods.ts';
import { misplacedArgument } from '../../../syntax/expressions/arguments.ts';
import type {
  Call,
  CallArgument,
  Expression,
  MemberAccess,
  Spread,
} from '../../../syntax/expressions/index.ts';
import {
  calledName,
  callTypeArguments,
  unparenthesized,
} from '../../../syntax/expressions/readings.ts';
import { type Identifier, isMissingName } from '../../../syntax/tree/node.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { JoinPlace } from '../../resolution/applying/joint.ts';
import { checkChangedPlace } from '../../resolution/calls/places.ts';
import { resolveCall, type WrittenArgument } from '../../resolution/calls/resolve.ts';
import { stoppedOperation } from '../../resolution/calls/stopped-operations.ts';
import {
  callableThrough,
  callCandidates,
  staticCandidates,
  staticTargetOf,
  topLevelCandidates,
} from '../../resolution/choosing/candidates.ts';
import { fieldOf } from '../../types/traits/known-fields.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType } from '../../types/type/primitives.ts';
import { typeText } from '../../types/type/type-text.ts';
import { arrayElement } from '../../types/type/well-known.ts';
import { insideOptional } from '../../types/unions/inside-optional.ts';
import { writtenLiteral } from '../../types/unions/unions.ts';
import { namedType } from '../../types/written/named-types.ts';
import { writtenInputs } from '../closures/lambdas.ts';
import { checkValueCall, valueParameterTypes } from '../closures/value-calls.ts';
import { readsNothing, readsThroughNamespace, recordFieldRead } from './access/member-access.ts';
import { spreadArgumentType } from './collections/collections.ts';
import { checkJoiningArray, checkJoiningMap } from './collections/joining-literals.ts';
import { checkStructLiteral } from './structs/structs.ts';
import { checkVariantCall } from './structs/variants.ts';

/**
 * Checks a call; at `place`, where it may join the call it is passed to (resolution/applying/
 * joint.ts), it does unless it continues an optional chain, whose value its own ends.
 */
export function checkCall(
  context: BodyContext,
  node: Call,
  expected: Type | undefined,
  place?: JoinPlace,
): Type {
  const misplaced = misplacedArgument(node.arguments);
  const typeArguments = callTypeArguments(node)?.map((argument) => context.resolveType(argument));
  const value = calledValue(context, node);
  const known = valueParameterTypes(value?.type, node.arguments, typeArguments);
  const call: WrittenCall = {
    node,
    expected,
    place,
    typeArguments,
    written: node.arguments.map((argument, index) => {
      if (argument === misplaced) {
        return { ...writtenArgument(context, argument, undefined), type: errorType };
      }
      return writtenArgument(context, argument, known[index]);
    }),
  };
  const callee = calledName(node);
  if (node.isOptional) {
    return checkValueCall(context, call, callee, value?.type ?? errorType);
  }
  if (value !== undefined && value.receiver === undefined) {
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
        ? callMethod(context, call, callee, value?.receiver)
        : callStatic(context, call, owner, callee.member.text);
    }
    default:
      return checkValueCall(context, call, callee);
  }
}

/**
 * An argument as written: `&x` passes the place `x`, checked as a place that may change; a spread,
 * its items, as an array literal's spread gives them (§2), or a pack's value, as it is (§3.5); any
 * other is a value, checked now unless the chosen function decides its type, a literal with its
 * literal type beside, which it has where its parameter expects one (§2), and a literal of items
 * read once those whose types only checking tells are checked (`argumentPart`). A named argument
 * is its value, named.
 */
/**
 * A call's argument as choosing takes it; one whose parameter's type is known before choosing,
 * `known` (known-parameters.ts; a spread's items' type), is checked against it.
 */
function writtenArgument(
  context: BodyContext,
  argument: CallArgument,
  known: Type | undefined,
): WrittenArgument {
  switch (argument.kind) {
    case 'Spread':
      return spreadArgument(context, argument, known);
    case 'NamedArgument':
      return { ...valueArgument(context, argument.value, known), name: argument.name };
    default:
      return valueArgument(context, argument, known);
  }
}

/**
 * A spread argument: its items, which fit the rest parameter's element exactly. An array literal
 * spread joins the call (design.md §4), its items its element, copied whole as built.
 */
function spreadArgument(
  context: BodyContext,
  argument: Spread,
  known: Type | undefined,
): WrittenArgument {
  const { expression } = argument;
  const place = new JoinPlace(expression);
  const joined =
    known === undefined && expression.kind === 'ArrayLiteral'
      ? checkJoining(context, expression, place)
      : undefined;
  const items = joined === undefined ? undefined : arrayElement(context.checker, joined);
  if (items === undefined) {
    const type = spreadArgumentType(context, argument, known);
    return { node: expression, passing: 'value', type, isSpread: true };
  }
  context.iterations.record(argument, { kind: 'copied' });
  return { node: expression, passing: 'value', type: items, isSpread: true, place };
}

function valueArgument(
  context: BodyContext,
  argument: Expression,
  known: Type | undefined,
): WrittenArgument {
  if (argument.kind === 'Reference') {
    const type = checkChangedPlace(context, argument.expression, 'referenced');
    return { node: argument, passing: 'reference', type };
  }
  const literal = writtenLiteral(unparenthesized(argument));
  if (known !== undefined) {
    const type = context.expression(argument, known);
    // Reported here, as a literal's field is, so an argument beside one in error is still judged;
    // it then counts as the error type, so the call reports nothing more of it.
    if (type.kind !== 'error' && context.checker.fitOf(type, known) === undefined) {
      context.fit(type, known, argument);
      return { node: argument, passing: 'value', type: errorType, literal };
    }
    return { node: argument, passing: 'value', type, literal };
  }
  // A collection literal's items are checked once, where it joins the call, so none ahead.
  const part =
    argument.kind === 'ArrayLiteral' || argument.kind === 'MapLiteral'
      ? context.acceptedPart(argument)
      : context.argumentPart(argument);
  // `none` passed alone is `None`, a type like any other the call's inference joins (§3.5); inside
  // a composite it still waits for the call, as its siblings decide where it goes.
  if (part.kind === 'decided' && part.alone === undefined) {
    const lambda = unparenthesized(argument);
    const inputs = lambda.kind === 'Lambda' ? writtenInputs(context, lambda) : undefined;
    return {
      node: argument,
      passing: 'value',
      type: undefined,
      literal,
      accepts: part.accepts,
      inputs,
    };
  }
  const place = new JoinPlace(argument);
  const joined = checkJoining(context, argument, place);
  if (joined !== undefined) {
    return { node: argument, passing: 'value', type: joined, literal, place };
  }
  const type = context.expression(argument);
  const { builds } = context.checkedPart(argument);
  return { node: argument, passing: 'value', type, literal, builds };
}

/**
 * Checks `node` at `place`, where it may join the call it is passed to (design.md §4,
 * resolution/applying/joint.ts): a call, a literal naming its type, or a non-empty array or map
 * literal, whose items may join it in turn; its type, open where it joined. Undefined for anything else,
 * which is checked as ever.
 */
function checkJoining(context: BodyContext, node: Expression, place: JoinPlace): Type | undefined {
  switch (node.kind) {
    case 'Call':
      return context.checkWith(node, () => checkCall(context, node, undefined, place));
    case 'StructLiteral':
      return node.type === undefined
        ? undefined
        : context.checkWith(node, () =>
            checkStructLiteral(context, node, undefined, {
              place,
              joining: (item, at) => checkJoining(context, item, at),
            }),
          );
    case 'ArrayLiteral':
      return node.elements.length === 0
        ? undefined
        : context.checkWith(node, () =>
            checkJoiningArray(context, node, place, (item, at) => checkJoining(context, item, at)),
          );
    case 'MapLiteral':
      return node.entries.length === 0
        ? undefined
        : context.checkWith(node, () =>
            checkJoiningMap(context, node, place, (item, at) => checkJoining(context, item, at)),
          );
    default:
      return undefined;
  }
}

/**
 * What a call calls, when its type is known before its arguments: a variable, an expression other
 * than a name, or an optional call's target (§3.14), and a receiver's field (`receiverField`),
 * which a method of the same name makes an error the call reports.
 */
function calledValue(context: BodyContext, node: Call): CalledValue | undefined {
  if (node.isOptional) {
    return { type: context.chains.target(context, node) };
  }
  const callee = calledName(node);
  switch (callee.kind) {
    case 'Identifier':
      return context.entityOf(callee)?.kind === 'variable'
        ? { type: context.expression(callee) }
        : undefined;
    case 'MemberAccess':
      return receiverField(context, node, callee);
    default:
      return { type: context.expression(callee) };
  }
}

/**
 * What `x.f(…)` reads of its receiver before its arguments: the receiver's type, read once here
 * for the call, and the type of the field `f` names, if any. Undefined where the callee names no
 * receiver's member: a missing name, a namespace's member, a type's static function.
 */
function receiverField(
  context: BodyContext,
  node: Call,
  callee: MemberAccess,
): CalledValue | undefined {
  if (
    isMissingName(callee.member) ||
    readsThroughNamespace(context, callee) ||
    context.entityOf(callee.member) !== undefined ||
    namedType(context, callee.target) !== undefined
  ) {
    return undefined;
  }
  const receiver = context.chains.target(context, node);
  return { type: fieldOf(context.checker, receiver, callee.member.text)?.member.type, receiver };
}

/**
 * The type of what a call calls, when it is known before its arguments, and for `x.f(…)` the
 * receiver's type, read then.
 */
interface CalledValue {
  readonly type: Type | undefined;
  readonly receiver?: Type;
}

/**
 * `x.f(…)`: `f` called with `x` as its `self` (§3.7); also as a link of an optional chain, which
 * calls it on the value inside and never through `&self` (access/optionals.ts).
 */
function callMethod(
  context: BodyContext,
  call: WrittenCall,
  callee: MemberAccess,
  read: Type | undefined,
): Type {
  const { checker, chains } = context;
  const receiver = callee.target;
  const receiverType = read ?? chains.target(context, call.node);
  const stopped = stoppedOperation(context, call.node, [{ node: receiver, type: receiverType }]);
  if (stopped !== undefined) {
    return stopped;
  }
  const name = callee.member.text;
  const field = fieldOf(checker, receiverType, name);
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
    recordFieldRead(context, callee, field);
    return checkValueCall(context, call, callee, field.member.type);
  }
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
    name,
    candidates,
    arguments: written,
    typeArguments: call.typeArguments,
    expected: call.expected,
    form: 'call',
    receiver,
    hint: () => insideOptional(receiver.span, receiverType, '.'),
    place: chains.continues(call.node) ? undefined : call.place,
  });
}

/** A call with plain arguments, each checked unless the chosen function decides its type. */
interface WrittenCall {
  readonly node: Call;
  readonly expected: Type | undefined;
  /** Where the call may join the call it is passed to, if it may. */
  readonly place?: JoinPlace | undefined;
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
      const owner = namedType(context, callee);
      return owner === undefined ? errorType : callStatic(context, call, owner, conversionFunction);
    }
    default:
      context.report(checkerDiagnostics.notCallable(callee.span, name));
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
    name,
    candidates,
    arguments: call.written,
    typeArguments: call.typeArguments,
    expected: call.expected,
    form: 'call',
    place: call.place,
  });
}
