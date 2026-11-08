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
} from '../../../syntax/expressions/index.ts';
import {
  calledName,
  callTypeArguments,
  unparenthesized,
} from '../../../syntax/expressions/readings.ts';
import type { Identifier } from '../../../syntax/tree/node.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { knownParameterTypes } from '../../resolution/calls/known-parameters.ts';
import { checkChangedPlace } from '../../resolution/calls/places.ts';
import { resolveCall, type WrittenArgument } from '../../resolution/calls/resolve.ts';
import { stoppedOperation } from '../../resolution/calls/stopped-operations.ts';
import { boundArgumentOf } from '../../resolution/choosing/binding.ts';
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
import { insideOptional } from '../../types/unions/inside-optional.ts';
import { writtenLiteral } from '../../types/unions/unions.ts';
import { namedType } from '../../types/written/named-types.ts';
import { checkValueCall } from '../closures/value-calls.ts';
import { readsNothing, recordFieldRead } from './access/member-access.ts';
import { spreadArgumentType } from './collections/collections.ts';
import { calledConstructor, checkVariantCall } from './structs/variants.ts';

export function checkCall(context: BodyContext, node: Call, expected: Type | undefined): Type {
  const misplaced = misplacedArgument(node.arguments);
  const typeArguments = callTypeArguments(node)?.map((argument) => context.resolveType(argument));
  const constructs = calledConstructor(context, node, expected);
  const known =
    constructs === undefined
      ? []
      : knownParameterTypes(context.checker, constructs, {
          typeArguments,
          expected,
          arguments: node.arguments.map(boundArgumentOf),
        });
  const call: WrittenCall = {
    node,
    expected,
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
    return checkValueCall(context, call, callee, context.chains.target(context, node));
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
        ? callMethod(context, call, callee)
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
      return {
        node: argument.expression,
        passing: 'value',
        type: spreadArgumentType(context, argument, known),
        isSpread: true,
      };
    case 'NamedArgument':
      return { ...valueArgument(context, argument.value, known), name: argument.name };
    default:
      return valueArgument(context, argument, known);
  }
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
  const part = context.argumentPart(argument);
  if (part.kind === 'decided') {
    return { node: argument, passing: 'value', type: undefined, literal, accepts: part.accepts };
  }
  const type = context.expression(argument);
  const { builds } = context.checkedPart(argument);
  return { node: argument, passing: 'value', type, literal, builds };
}

/**
 * `x.f(…)`: `f` called with `x` as its `self` (§3.7); also as a link of an optional chain, which
 * calls it on the value inside and never through `&self` (access/optionals.ts).
 */
function callMethod(context: BodyContext, call: WrittenCall, callee: MemberAccess): Type {
  const { checker, chains } = context;
  const receiver = callee.target;
  const receiverType = chains.target(context, call.node);
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
  });
}
