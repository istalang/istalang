/**
 * Deferred calls, `g f(args)` (§3.14): `g` is given a function making the call `f(args)` later, with
 * everything written in it computed now. It is checked as `g` called with that function given after
 * its own arguments (`Call.given`, which binding places), a closure over constants:
 * `g(…, given: { const v… = <what runs now>; fn(): f(v…) })`, so its mark, sendability and captures
 * are a lambda's, checked against the parameter it fills.
 *
 * - What runs now, left to right: the value the call calls (a function value, a field `x.f` read
 *   whole) or a method's receiver, then each argument written, a spread as what it collects (a pack
 *   whole, else an array of its items). A call that is itself deferred, `a b c(x)`, brings the
 *   constants its own core declares and makes its own call inside, so `x` runs once, now.
 * - Each is typed as the call expects it: the call is checked first as a probe, which leaves nothing
 *   behind (BodyContext `probe`), so `g f(Array.empty())` infers; each is then checked once, with
 *   that guide, before the core reads it (`operand`).
 * - A constant's name stands at its deferred call's taker, and the function, which covers no text,
 *   where its call starts, so the function captures every constant and the code around it none:
 *   captures are found by where names are declared (constructs/closures/functions.ts).
 * - Refused here, which no core rule catches: what follows the taker isn't a call, and an argument
 *   passed by `&`, as no reference can be captured.
 * - Worded here: a taker that is a value and no function, as the comma likely missing after it
 *   (`[a b(c)]`); a receiver its method takes by `&self`, held in a constant, as the reference no
 *   function can capture.
 */

import { variableEntity } from '../../binder/entities.ts';
import { argumentValue } from '../../syntax/expressions/arguments.ts';
import type {
  Call,
  CallArgument,
  CallingNode,
  DeferredCall,
} from '../../syntax/expressions/calls.ts';
import type { Expression, Lambda } from '../../syntax/expressions/index.ts';
import { calledName, deferredOf, qualifiedPath } from '../../syntax/expressions/readings.ts';
import type { VariableDeclaration } from '../../syntax/statements/index.ts';
import { tailExpressionOf } from '../../syntax/statements/readings.ts';
import { unqualified } from '../../syntax/tokens/modifiers.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import { type AnchoredSpan, spanBetween, startOf } from '../../syntax/tree/positions.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import { bound, synthesized } from '../contexts/synthesized.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { CoreExpression } from '../surface/checked-body.ts';
import { isPack } from '../types/type/function-types.ts';
import type { Type } from '../types/type/index.ts';
import type { Desugar } from './index.ts';

/** A value the call made later computes now, with what the call expects of it. */
interface Operand {
  readonly value: Expression;
  readonly guide: Type | undefined;
  /** Whether it is what a spread collects. */
  readonly spread: boolean;
}

/** A constant a deferred call declared, with what its value was checked expecting. */
interface Declared {
  readonly declaration: VariableDeclaration;
  readonly guide: Type | undefined;
}

/** The call a deferred call makes later, as the probe checked it. */
interface Later {
  /** The call: the one written, or the core a deferred call written there was checked as. */
  readonly call: Call;
  readonly operands: readonly Operand[];
  /**
   * The constants a deferred call written there declared, which the function it gives reads, each
   * with what its value was checked expecting.
   */
  readonly declared: readonly Declared[];
  /** The function a deferred call written there gives its taker, built over those constants. */
  readonly given: Expression | undefined;
  /** The written calls the probe rebuilt inside that deferred call, with their core calls. */
  readonly rebuilt: readonly (readonly [Expression, CoreExpression])[];
}

export const deferredCalls: Desugar<DeferredCall> = {
  core: (context, node) => {
    const call = deferredOf(node);
    if (call === undefined) {
      context.expression(node.call);
      context.report(checkerDiagnostics.deferredNeedsCall(node.call.span));
      return;
    }
    const later = context.probe(() => laterOf(context, call));
    // A deferred call refusing itself gives its taker the error it is, reported once more here.
    if (later === undefined) {
      return takerCall(node, call);
    }
    for (const argument of argumentsOf(call)) {
      if (argument.kind === 'Reference') {
        context.report(checkerDiagnostics.deferredReference(argument.span));
      }
    }
    const constants = later.operands.map((operand) => constant(context, node, operand));
    for (const { declaration, guide } of later.declared) {
      context.sugars.operand(context, declaration.initializer, guide);
    }
    const read = (written: Expression) =>
      constants.find(({ operand }) => operand.value === written)?.read(written.span);
    const made = remade(node, later.call, read, later.given);
    context.sugars.record(call, made);
    for (const [written, core] of later.rebuilt) {
      context.sugars.record(written, core);
    }
    const lambda: Lambda = {
      kind: 'Lambda',
      span: startOf(node.call.span),
      qualifiers: unqualified,
      name: undefined,
      parameters: [],
      returnType: undefined,
      body: made,
    };
    const tail = { kind: 'ExpressionStatement', span: made.span, expression: lambda } as const;
    const statements = [
      ...constants.map(({ declaration }) => declaration),
      ...later.declared.map(({ declaration }) => declaration),
      synthesized(node, tail),
    ];
    const block = { kind: 'Block', span: node.call.span, statements } as const;
    const given = { kind: 'BlockExpression', span: node.call.span, block } as const;
    synthesized(node, lambda);
    synthesized(node, block);
    return takerCall(node, synthesized(node, given));
  },
  wording: {
    [checkerDiagnostics.notFunction.code]: (_context, diagnostic, node) => {
      const taker = calledName(node);
      if (diagnostic.span.from !== taker.span.from) {
        return diagnostic;
      }
      const name = qualifiedPath(taker)?.map(({ text }) => text) ?? [];
      const gap = spanBetween(node.taker.span, node.call.span);
      return checkerDiagnostics.missingComma(gap, name.join('.'));
    },
    [checkerDiagnostics.constantChanged.code]: (_context, diagnostic) =>
      checkerDiagnostics.deferredReference(diagnostic.span),
  },
};

/** The call to `node`'s taker, giving it `given` after the arguments its parentheses write. */
function takerCall(node: DeferredCall, given: Expression): Call {
  const taker = node.taker.kind === 'Call' ? node.taker : undefined;
  return synthesized(node, {
    kind: 'Call',
    span: node.span,
    callee: taker?.callee ?? node.taker,
    isOptional: false,
    arguments: taker?.arguments ?? [],
    given,
  });
}

/** The arguments `call` and the calls it defers in turn pass now. */
function argumentsOf(call: CallingNode): readonly CallArgument[] {
  if (call.kind === 'Call') {
    return call.arguments;
  }
  const taker = call.taker.kind === 'Call' ? call.taker.arguments : [];
  const inner = deferredOf(call);
  return inner === undefined ? taker : [...taker, ...argumentsOf(inner)];
}

/**
 * What `call` makes later, read from the probe's check of it; undefined for a deferred call refusing
 * itself.
 */
function laterOf(context: BodyContext, call: CallingNode): Later | undefined {
  context.expression(call);
  if (call.kind === 'Call') {
    return {
      call,
      operands: operandsOf(context, call),
      declared: [],
      given: undefined,
      rebuilt: [],
    };
  }
  const core = context.sugars.coreOf(call);
  const given = core?.kind === 'Call' ? core.given : undefined;
  if (core?.kind !== 'Call' || given?.kind !== 'BlockExpression') {
    return undefined;
  }
  const inner = deferredOf(call);
  const innerCore = inner === undefined ? undefined : context.sugars.coreOf(inner);
  return {
    call: core,
    operands: operandsOf(context, core),
    declared: given.block.statements
      .filter((each) => each.kind === 'VariableDeclaration')
      .map((declaration) => ({ declaration, guide: context.expectedOf(declaration.initializer) })),
    given: tailExpressionOf(given.block),
    rebuilt: inner === undefined || innerCore === undefined ? [] : [[inner, innerCore]],
  };
}

/** What `call`, as the probe checked it, computes now: its callee's value or receiver, then each argument. */
function operandsOf(context: BodyContext, call: Call): readonly Operand[] {
  const receiver = context.calls.of(call)?.receiver;
  const callee = context.valueCalls.has(call) ? calledName(call) : receiver;
  const calleeOperand =
    callee === undefined ? [] : [{ value: callee, guide: undefined, spread: false }];
  const written = call.arguments.map((argument): Operand => {
    if (argument.kind === 'Spread') {
      return { value: argument.expression, guide: undefined, spread: true };
    }
    const value = argumentValue(argument);
    return { value, guide: context.expectedOf(value), spread: false };
  });
  return [...calleeOperand, ...written];
}

/** A constant holding `operand`, computed now for the deferred call `node`, and how to read it. */
function constant(context: BodyContext, node: DeferredCall, operand: Operand) {
  const type = context.sugars.operand(context, operand.value, operand.guide);
  const value =
    operand.spread && !isPack(type)
      ? synthesized(node, {
          kind: 'ArrayLiteral',
          span: operand.value.span,
          elements: [
            synthesized(node, {
              kind: 'Spread',
              span: operand.value.span,
              expression: operand.value,
            }),
          ],
        } as const)
      : operand.value;
  const at = node.taker.span;
  const text = operand.value.kind === 'Identifier' ? operand.value.text : 'value';
  const name = synthesized(node, { kind: 'Identifier', span: at, text } satisfies Identifier);
  const pattern = synthesized(node, {
    kind: 'NamePattern',
    span: at,
    path: [name],
    typeArguments: [],
  } as const);
  const declaration = synthesized(node, {
    kind: 'VariableDeclaration',
    span: operand.value.span,
    hold: undefined,
    isMutable: false,
    targets: [pattern],
    type: undefined,
    initializer: value,
  } as const);
  const entity = variableEntity(name, declaration);
  bound(name, entity);
  const read = (span: AnchoredSpan): Expression =>
    bound(synthesized(node, { kind: 'Identifier', span, text } satisfies Identifier), entity);
  return { operand, declaration, read };
}

/**
 * `call` made from what was computed now: each operand `read` gives a constant for replaced by
 * it, a spread spreading it; the function `given`, if any, given after its arguments.
 */
function remade(
  node: DeferredCall,
  call: Call,
  read: (written: Expression) => Expression | undefined,
  given: Expression | undefined,
): Call {
  const callee = read(call.callee) ?? remadeCallee(node, call.callee, read);
  const argumentRemade = (argument: CallArgument): CallArgument => {
    switch (argument.kind) {
      case 'Spread':
        return synthesized(node, {
          ...argument,
          expression: read(argument.expression) ?? argument.expression,
        });
      case 'NamedArgument':
        return synthesized(node, { ...argument, value: read(argument.value) ?? argument.value });
      default:
        return read(argument) ?? argument;
    }
  };
  return synthesized(node, {
    kind: 'Call',
    span: call.span,
    callee,
    isOptional: call.isOptional,
    arguments: call.arguments.map(argumentRemade),
    given,
  });
}

/** A callee whose receiver `read` gives a constant for, read from it; else as written. */
function remadeCallee(
  node: DeferredCall,
  callee: Expression,
  read: (written: Expression) => Expression | undefined,
): Expression {
  switch (callee.kind) {
    case 'MemberAccess': {
      const target = read(callee.target);
      return target === undefined ? callee : synthesized(node, { ...callee, target });
    }
    case 'TypeApplication': {
      const target = remadeCallee(node, callee.target, read);
      return target === callee.target
        ? callee
        : synthesized(node, { ...callee, target } as typeof callee);
    }
    default:
      return callee;
  }
}
