/**
 * Deferred calls, `g f(args)` (§3.14): `g` is given a function making the call `f(args)` later, with
 * everything written in it computed now. It is checked as `g` called with that function given after
 * its own arguments (`Call.given`, which binding places), a closure over constants:
 * `g(…, given: { const v… = <what runs now>; fn(): f(v…) })`, so its mark, sendability and captures
 * are a lambda's, checked against the parameter it fills.
 *
 * - What runs now, left to right: the value the call calls, or a method's receiver; then each
 *   argument computing something, a spread as what it collects (a pack whole, else an array of its
 *   items). A deferred call written as the call, `a b c(x)`, runs its own taker's parts now too, so
 *   `x` runs once, now, and its function is built inside.
 * - A value computed now is typed by what it is, as a constant's value is. An argument computing
 *   nothing, the same value made now or later (a literal, a lambda, a name of a function, variant or
 *   type, a literal of such parts), stays in the call, which types it as any call does.
 * - Whether `x.f(…)` reads a field value or calls a method is decided by `x`'s type, checked first,
 *   as any call decides it (constructs/expressions/calls.ts): the field `x.f` is computed now, else
 *   `x`. What a link of an optional chain computes now holds the chain's optional, so the link made
 *   later reads through it.
 * - A constant's name stands at the taker, and each function, which covers no text, where its call
 *   starts, so a function captures every constant and the code around it none: captures are found
 *   by where names are declared (constructs/closures/functions.ts).
 * - Refused here, which no core rule catches: what follows a taker isn't a call, and an argument
 *   passed by `&`, as no reference can be captured.
 * - Worded here: the taker a value and no function, as the comma likely missing after it
 *   (`[a b(c)]`); a receiver its method takes by `&self`, held in a constant, as the reference no
 *   function can capture.
 */

import type { Call, CallArgument, DeferredCall } from '../../syntax/expressions/calls.ts';
import type { Expression, Lambda } from '../../syntax/expressions/index.ts';
import { signedNumberOf } from '../../syntax/expressions/literals/numbers.ts';
import { constantTextOf } from '../../syntax/expressions/literals/templates.ts';
import {
  calledName,
  deferredOf,
  qualifiedPath,
  takerCallOf,
  unparenthesized,
} from '../../syntax/expressions/readings.ts';
import type { VariableDeclaration } from '../../syntax/statements/index.ts';
import { unqualified } from '../../syntax/tokens/modifiers.ts';
import type { SyntaxNode } from '../../syntax/tree/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import { spanBetween, startOf } from '../../syntax/tree/positions.ts';
import { readsThroughNamespace } from '../constructs/expressions/access/member-access.ts';
import { calleeRead, memberCalled } from '../constructs/expressions/calls.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import { synthesized } from '../contexts/synthesized.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { isPack } from '../types/type/function-types.ts';
import { presentType } from '../types/unions/unions.ts';
import { namedType } from '../types/written/named-types.ts';
import { afterConstants, heldConstant } from './constants.ts';
import type { Desugar } from './index.ts';

/** The parts a deferred call's core is built of, as its wording reads them. */
type Part = 'taker' | 'constant' | 'later' | 'function';

/** What one deferred call's core is built with: the context, the call, its constants so far. */
interface Building {
  readonly context: BodyContext;
  readonly sugar: DeferredCall;
  readonly constants: VariableDeclaration[];
}

export const deferredCalls: Desugar<DeferredCall> = {
  core: (context, node) => {
    const building: Building = { context, sugar: node, constants: [] };
    const made = madeLater(building, node);
    if (made === undefined) {
      return;
    }
    const given = afterConstants(building.constants, made, node.call.span, {
      sugar: node,
      role: 'constant',
    });
    const taker = takerCallOf(node);
    return built(building, 'taker', {
      kind: 'Call',
      span: node.span,
      callee: taker?.callee ?? node.taker,
      isOptional: false,
      arguments: taker?.arguments ?? [],
      given,
    } satisfies Call);
  },
  wording: {
    [checkerDiagnostics.notFunction.code]: (_context, diagnostic, { sugar, role }) => {
      if (role !== 'taker') {
        return diagnostic;
      }
      const name = qualifiedPath(calledName(sugar))?.map(({ text }) => text) ?? [];
      const gap = spanBetween(sugar.taker.span, sugar.call.span);
      return checkerDiagnostics.missingComma(gap, name.join('.'));
    },
    [checkerDiagnostics.constantChanged.code]: (_context, diagnostic, { role }) =>
      role === 'later' ? checkerDiagnostics.deferredReference(diagnostic.span) : diagnostic,
  },
};

/** `node`, built for `building`'s deferred call as its `part`. */
function built<Node extends SyntaxNode>({ sugar }: Building, part: Part, node: Node): Node {
  const named = part === 'function' ? 'a deferred call' : undefined;
  return synthesized({ sugar, role: part, ...(named === undefined ? {} : { named }) }, node);
}

/**
 * The function `deferred` gives its taker, a lambda making its call later from constants computed
 * now; undefined after refusing what follows a taker, which is no call.
 */
function madeLater(building: Building, deferred: DeferredCall): Lambda | undefined {
  const { context } = building;
  const call = deferredOf(deferred);
  if (call === undefined) {
    context.expression(deferred.call);
    context.report(checkerDiagnostics.deferredNeedsCall(deferred.call.span));
    return undefined;
  }
  // A deferred call written as the call runs its taker's parts now, and builds its function inside.
  const asCall =
    call.kind === 'Call'
      ? call
      : (takerCallOf(call) ?? {
          kind: 'Call',
          span: call.taker.span,
          callee: call.taker,
          isOptional: false,
          arguments: [],
        });
  const make = hoisted(building, asCall);
  const given = call.kind === 'Call' ? undefined : madeLater(building, call);
  if (call.kind === 'DeferredCall' && given === undefined) {
    return undefined;
  }
  const made = make(given);
  context.sugars.record(call, made);
  return built(building, 'function', {
    kind: 'Lambda',
    span: startOf(deferred.call.span),
    qualifiers: unqualified,
    name: undefined,
    parameters: [],
    returnType: undefined,
    body: made,
  });
}

/**
 * `call`'s parts that run now, each made a constant of `building` in the order they run, and how
 * the call made later from them is built, given the function it gives after its arguments, if any.
 */
function hoisted(building: Building, call: Call): (given: Expression | undefined) => Call {
  const { context } = building;
  const read = calleeRead(context, call);
  let { callee, isOptional } = call;
  if (read.kind === 'value') {
    callee = constant(building, call.callee);
  } else if (read.kind === 'member') {
    const { access } = read;
    const receiver = context.sugars.operand(context, access.target);
    // What a link of an optional chain computes now holds the chain's optional, read through later.
    const chained = access.isOptional || context.chains.chainOf(access.target) !== undefined;
    const looked = chained
      ? (presentType(receiver, context.checker.typeRules) ?? receiver)
      : receiver;
    const { field, methods } = memberCalled(context, access.member.text, looked, []);
    if (field !== undefined && methods.length === 0) {
      callee = constant(building, call.callee);
      isOptional ||= chained;
    } else {
      const target = constant(building, access.target);
      const member = built(building, 'later', { ...access, target, isOptional: chained });
      callee =
        call.callee.kind === 'TypeApplication'
          ? built(building, 'later', { ...call.callee, target: member })
          : member;
    }
  }
  const written = call.arguments.map((argument) => argumentHoisted(building, argument));
  return (given) =>
    built(building, 'later', {
      kind: 'Call',
      span: call.span,
      callee,
      isOptional,
      arguments: written,
      given,
    } satisfies Call);
}

/** `argument` as the call made later passes it: what it computes now read from a constant. */
function argumentHoisted(building: Building, argument: CallArgument): CallArgument {
  const { context } = building;
  switch (argument.kind) {
    case 'Spread': {
      const collected = isPack(context.sugars.operand(context, argument.expression))
        ? argument.expression
        : built(building, 'constant', {
            kind: 'ArrayLiteral',
            span: argument.expression.span,
            elements: [argument],
          } as const);
      return built(building, 'later', { ...argument, expression: constant(building, collected) });
    }
    case 'NamedArgument':
      return computesNothing(context, argument.value)
        ? argument
        : built(building, 'later', { ...argument, value: constant(building, argument.value) });
    case 'Reference':
      context.report(checkerDiagnostics.deferredReference(argument.span));
      return constant(building, argument);
    default:
      return computesNothing(context, argument) ? argument : constant(building, argument);
  }
}

/**
 * A constant of `building` holding `value`, computed now: a reference to it, at where `value` is
 * written. Its name stands at the deferred call's taker, outside every function it builds.
 */
function constant(building: Building, value: Expression): Identifier {
  const { sugar, constants } = building;
  const held = heldConstant(value, sugar.taker.span, { sugar, role: 'constant' });
  constants.push(held.declaration);
  return held.read({ sugar, role: 'later' });
}

/**
 * Whether `node` computes nothing, the same value made now or later: a literal, a lambda, a name
 * of a function, a variant or a type (given type arguments or not), or a literal of such parts.
 */
function computesNothing(context: BodyContext, node: Expression): boolean {
  const value = unparenthesized(node);
  switch (value.kind) {
    case 'IntegerLiteral':
    case 'FloatLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral':
    case 'DurationLiteral':
    case 'NoneLiteral':
    case 'Lambda':
      return true;
    case 'TypeApplication':
      return computesNothing(context, value.target);
    case 'Unary':
      return signedNumberOf(value) !== undefined;
    case 'TemplateLiteral':
      return constantTextOf(value) !== undefined;
    case 'Identifier':
      return context.entityOf(value)?.kind !== 'variable';
    case 'MemberAccess':
      // A namespace's or a type's member, as a call names one (calls.ts `calleeRead`), but a variable.
      return (
        (readsThroughNamespace(context, value) || namedType(context, value.target) !== undefined) &&
        context.entityOf(value.member)?.kind !== 'variable'
      );
    case 'ArrayLiteral':
    case 'Tuple':
      return value.elements.every(
        (each) => each.kind !== 'Spread' && computesNothing(context, each),
      );
    default:
      return false;
  }
}
