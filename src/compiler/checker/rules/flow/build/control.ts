/**
 * Control (§4, §8), as lowering writes it (lowering/constructs/expressions/control/):
 *
 * - `if`: each condition runs where the ones before failed, then its body or the next condition; a
 *   condition its operands' types decide (`decidedOf`) runs alone, ruling its body out when false
 *   and every later branch when true. A branch is a scope its condition binds into, ended on both
 *   of its paths. `match` tests each case's pattern and guard in turn, a failing guard ending the
 *   case's scope.
 * - `and`, `or` and `??` run their right side only sometimes. `e?` tests `e` for `Ok`, going on
 *   with its value, else returning a new `Err` of the function's own `Result`, holding `e`'s
 *   error converted to the function's error type, as checking fits it (§3.12).
 * - A comparison its operands' types decide is that constant, its operands still run; any other is
 *   the built-in `==`, or what the `compare` or `includes` checking made gives, related or negated.
 * - `await` hands what it waits on to its `onAwait`, suspends, and gives what it settled with. A
 *   `select` evaluates every case's awaitable, each holding the temporaries it computed, which a
 *   case losing releases and the scope around the `select` releases otherwise, and hands each to
 *   its `onAwait`; an awaiting one suspends on them all, one that doesn't await never suspends
 *   (§8). Then one case's body runs, what its own future gave bound, or the `else`.
 *
 * A construct giving a value gives it through a temporary each path copies its value into.
 */

import { wellKnown } from '../../../../../foundation/language/well-known/index.ts';
import { resultVariants } from '../../../../../foundation/language/well-known/variants.ts';
import { type Comparison, isComparison } from '../../../../syntax/expressions/comparisons.ts';
import type {
  Await,
  Binary,
  Expression,
  If,
  Is,
  Match,
  Propagate,
  Select,
  SelectCase,
  Unary,
} from '../../../../syntax/expressions/index.ts';
import { binaryOperators, unaryOperators } from '../../../../syntax/expressions/operators.ts';
import { casesOf, selectCasesOf } from '../../../../syntax/expressions/readings.ts';
import type { Block } from '../../../../syntax/statements/index.ts';
import type { SyntaxNode } from '../../../../syntax/tree/index.ts';
import { unitForm } from '../../../surface/constant-form.ts';
import type { BlockId, ValueId } from '../../../surface/flow-ir.ts';
import type { Type } from '../../../types/type/index.ts';
import { boolType } from '../../../types/type/primitives.ts';
import { awaitedOf, wellKnownArguments } from '../../../types/type/well-known.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { implicitCall, resolvedCall } from './implicit-calls.ts';
import { bindTargets, matchPattern, payload, readAlong } from './parts.ts';
import { madeVariant, variantTest } from './variants.ts';

export function ifFlow(builder: FlowBuilder, node: If): ValueId {
  const given = { result: builder.temporaryOf(node), end: builder.newBlock() };
  const { decidedOf } = builder.body;
  // Past a condition always true, no branch is reached.
  const always = node.branches.findIndex((branch) => decidedOf(branch.condition) === true);
  const reached = always < 0 ? node.branches : node.branches.slice(0, always + 1);
  for (const branch of reached) {
    if (decidedOf(branch.condition) === false) {
      builder.expression(branch.condition);
    } else {
      guarded(builder, {
        scope: branch,
        condition: branch.condition,
        body: () => valueInto(builder, given.result, branch.body),
        leave: () => builder.end({ kind: 'goto', to: given.end }),
      });
    }
  }
  const otherwise = node.elseClause?.body;
  if (otherwise !== undefined && !builder.body.isRuledOut(otherwise)) {
    giveInto(builder, given, otherwise);
  } else {
    builder.compute(given.result, node, { kind: 'constant', form: unitForm });
    builder.end({ kind: 'goto', to: given.end });
  }
  builder.resumeIn(given.end);
  return given.result;
}

/**
 * A scope entered through a condition that may not hold (§3.4, §7), as lowering writes it
 * (`lowerGuarded`): an `if`'s branch, a `while`'s pass, a guarded case.
 */
interface Guarded {
  readonly scope: SyntaxNode;
  /** What runs in the scope before the condition: a case's pattern. */
  readonly before?: () => void;
  readonly condition: Expression;
  /** What runs where the condition holds, after its temporaries are released. */
  readonly body: () => void;
  /** Where the body goes once its scope has ended. */
  readonly leave: () => void;
}

/**
 * Builds `guarded`, going on where its condition fails: there, the scope's variables so far and
 * the condition's temporaries are released, as they are before the body where it holds.
 */
export function guarded(
  builder: FlowBuilder,
  { scope, before, condition, body, leave }: Guarded,
): void {
  const otherwise = builder.newBlock();
  builder.scopes.inScope(scope, () => {
    before?.();
    const { result: value, temporaries } = builder.temporariesIn(() =>
      builder.expression(condition),
    );
    const header = builder.scopes.claim(temporaries);
    const [holds, fails] = builder.branch({ kind: 'condition', value }) as [BlockId, BlockId];
    builder.resumeIn(fails);
    builder.scopes.leave(condition, header);
    builder.end({ kind: 'goto', to: otherwise });
    builder.resumeIn(holds);
    builder.scopes.release(header, condition);
    body();
  });
  leave();
  builder.resumeIn(otherwise);
}

/**
 * Each case not ruled out, in turn: its pattern tested and bound, then its guard; where they hold,
 * the subject's temporaries are released and its body gives the `match`'s value.
 */
export function matchFlow(builder: FlowBuilder, node: Match): ValueId {
  const { result: subject, temporaries } = builder.temporariesIn(() =>
    builder.expression(node.subject),
  );
  const header = builder.scopes.claim(temporaries);
  const given = { result: builder.temporaryOf(node), end: builder.newBlock() };
  const cases = casesOf(node).filter((each) => !builder.body.isRuledOut(each.body));
  for (const each of cases) {
    const failed = builder.newBlock();
    const tested = () => matchPattern(builder, each.pattern, subject, failed);
    const body = () => {
      builder.scopes.release(header, node.subject);
      valueInto(builder, given.result, each.body);
    };
    const leave = () => builder.end({ kind: 'goto', to: given.end });
    if (each.guard === undefined) {
      builder.scopes.inScope(each, () => {
        tested();
        body();
      });
      leave();
    } else {
      guarded(builder, { scope: each, before: tested, condition: each.guard, body, leave });
      builder.end({ kind: 'goto', to: failed });
    }
    builder.resumeIn(failed);
  }
  builder.end({ kind: 'stop' });
  builder.resumeIn(given.end);
  return given.result;
}

/** `x is P`: whether `x` matches `P`, `false` where its type rules the match out (§4). */
export function isFlow(builder: FlowBuilder, node: Is): ValueId {
  const subject = builder.expression(node.subject);
  const result = builder.temporaryOf(node);
  const holds = (value: boolean) =>
    builder.compute(result, node, { kind: 'constant', form: { kind: 'primitive', value } });
  if (builder.body.decidedOf(node) === false) {
    return holds(false);
  }
  const failed = builder.newBlock();
  const end = builder.newBlock();
  matchPattern(builder, node.pattern, subject, failed);
  holds(true);
  builder.end({ kind: 'goto', to: end });
  builder.resumeIn(failed);
  holds(false);
  builder.continueIn(end);
  return result;
}

export function binaryFlow(builder: FlowBuilder, node: Binary): ValueId {
  const { kind } = binaryOperators[node.operator].meaning;
  if (kind === 'coalesce') {
    return nullishFlow(builder, node);
  }
  const left = builder.expression(node.left);
  const result = builder.temporaryOf(node);
  if (isComparison(node)) {
    const right = builder.expression(node.right);
    const decided = builder.body.decidedOf(node);
    if (decided === undefined) {
      compared(builder, node, [left, right], result);
    } else {
      builder.compute(result, node, {
        kind: 'constant',
        form: { kind: 'primitive', value: decided },
      });
    }
    return result;
  }
  if (kind === 'logic') {
    // `and` goes on to its right side where its left is true, `or` where it is false.
    builder.emit({ op: 'copy', site: node, into: result, from: left, fit: undefined });
    const { rightWhen } = binaryOperators[node.operator].meaning as { readonly rightWhen: boolean };
    const [whenTrue, whenFalse] = builder.branch({ kind: 'condition', value: left }) as [
      BlockId,
      BlockId,
    ];
    const end = rightWhen ? whenFalse : whenTrue;
    builder.resumeIn(rightWhen ? whenTrue : whenFalse);
    const right = builder.expression(node.right);
    builder.emit({ op: 'copy', site: node, into: result, from: right, fit: undefined });
    builder.continueIn(end);
    return result;
  }
  const right = builder.expression(node.right);
  const passed = [left, right].map((value) => ({ kind: 'value', value }) as const);
  return resolvedCall(builder, builder.body.resolved.get(node), {
    site: node,
    passed,
    into: result,
  });
}

/** `not x` is the language's own; any other unary operator is the call checking resolved. */
export function unaryFlow(builder: FlowBuilder, node: Unary): ValueId {
  const operand = builder.expression(node.operand);
  const into = builder.temporaryOf(node);
  if (unaryOperators[node.operator].meaning.kind === 'negation') {
    return builder.compute(into, node, { kind: 'not' }, [operand]);
  }
  return resolvedCall(builder, builder.body.resolved.get(node), {
    site: node,
    passed: [operand],
    into,
  });
}

/**
 * Whether `node` holds, into `result`: the built-in `==`, `!=` negated; whether the `includes`
 * checking made at its right operand, which takes the collection first, gives true, negated for
 * `not in`; or whether the `compare` made there gives a result in its relation.
 */
function compared(
  builder: FlowBuilder,
  node: Comparison,
  [left, right]: readonly [ValueId, ValueId],
  result: ValueId,
): void {
  const { meaning } = binaryOperators[node.operator];
  if (meaning.kind === 'equality') {
    builder.compute(result, node, { kind: 'equal', negated: meaning.negated }, [left, right]);
  } else if (meaning.kind === 'membership') {
    const site = node.right;
    const into = meaning.negated ? builder.temporary(site, boolType) : result;
    const includes = implicitCall(builder, 'includes', { site, passed: [right, left], into });
    if (meaning.negated) {
      builder.compute(result, node, { kind: 'not' }, [includes]);
    }
  } else if (meaning.kind === 'order') {
    const comparison = implicitCall(builder, 'compare', {
      site: node.right,
      passed: [left, right],
    });
    builder.compute(result, node, { kind: 'order', relation: meaning.relation }, [comparison]);
  }
}

export function propagate(builder: FlowBuilder, node: Propagate): ValueId {
  const operand = builder.expression(node.operand);
  const { checker } = builder.inputs;
  const argumentsOf = (type: Type | undefined) =>
    (type && wellKnownArguments(checker, wellKnown.result, type)) ?? [];
  const [, error] = argumentsOf(builder.valueOf(operand).type);
  const test = variantTest(builder, operand, resultVariants.ok);
  const [ok, failed] = builder.branch(test) as [BlockId, BlockId];
  builder.resumeIn(failed);
  const passed = readAlong(builder, operand, [payload(error)], node);
  const [, returned] = argumentsOf(builder.result);
  const converted = builder.temporary(node, returned);
  const fit = error && returned && checker.fitOf(error, returned);
  builder.emit({ op: 'copy', site: node, into: converted, from: passed, fit });
  const err = { site: node, type: builder.result, name: resultVariants.err };
  const value = madeVariant(builder, err, [converted]);
  builder.end({ kind: 'return', value, site: node });
  builder.resumeIn(ok);
  return readAlong(builder, operand, [payload(builder.body.typeOf(node))], node);
}

/** `a ?? b`: the value inside `a`, or else `b`'s value, evaluated only then. */
function nullishFlow(builder: FlowBuilder, node: Binary): ValueId {
  const whole = builder.expression(node.left);
  const result = builder.temporaryOf(node);
  const join = builder.newBlock();
  builder.presentOr(whole, { site: node, into: result }, () => {
    const right = builder.expression(node.right);
    builder.emit({ op: 'copy', site: node, into: result, from: right, fit: undefined });
    builder.end({ kind: 'goto', to: join });
  });
  builder.continueIn(join);
  return result;
}

export function awaitFlow(builder: FlowBuilder, node: Await): ValueId {
  const future = builder.expression(node.operand);
  awaitedAt(builder, node, future);
  builder.emit({ op: 'suspend', site: node, awaited: [future] });
  return givenBy(builder, node, future);
}

/** What `future` gave, once it has settled, read at `site`. */
function givenBy(builder: FlowBuilder, site: Await | SelectCase, future: ValueId): ValueId {
  const awaited = builder.valueOf(future).type;
  const given =
    site.kind === 'Await'
      ? builder.temporaryOf(site)
      : builder.temporary(site, awaited && awaitedOf(builder.inputs.checker, awaited)?.value);
  builder.emit({ op: 'read', site, into: given, from: future, part: { kind: 'given' } });
  return given;
}

export function selectFlow(builder: FlowBuilder, node: Select): ValueId {
  const cases = selectCasesOf(node);
  const evaluated = cases.map((each) =>
    builder.temporariesIn(() => builder.expression(each.future)),
  );
  const futures = evaluated.map(({ result }) => result);
  const holds = evaluated.map(({ temporaries }) => temporaries);
  for (const held of holds.flat()) {
    builder.scopes.declare(held);
  }
  for (const [index, each] of cases.entries()) {
    awaitedAt(builder, each, futures[index] as ValueId);
  }
  if (node.awaits) {
    builder.emit({ op: 'suspend', site: node, awaited: futures });
  }
  const given = { result: builder.temporaryOf(node), end: builder.newBlock() };
  const otherwise = node.elseClause?.body;
  const count = cases.length + (otherwise === undefined ? 0 : 1);
  const starts = builder.branch({ kind: 'select', node, holds }, count);
  for (const [index, each] of cases.entries()) {
    builder.resumeIn(starts[index] as BlockId);
    builder.scopes.inScope(each, () => {
      if (each.binding !== undefined) {
        bindTargets(builder, each, givenBy(builder, each, futures[index] as ValueId));
      }
      valueInto(builder, given.result, each.body);
    });
    builder.end({ kind: 'goto', to: given.end });
  }
  if (otherwise !== undefined) {
    builder.resumeIn(starts[cases.length] as BlockId);
    giveInto(builder, given, otherwise);
  }
  builder.resumeIn(given.end);
  return given.result;
}

/** `node` handing `future` to its `onAwait`, with the wait's resolver, which is no value. */
function awaitedAt(builder: FlowBuilder, node: Await | SelectCase, future: ValueId) {
  implicitCall(builder, 'onAwait', { site: node, passed: [future] });
}

/** Where a construct's paths give their value: its result, and the block they meet at. */
interface Given {
  readonly result: ValueId;
  readonly end: BlockId;
}

/** `body`'s value copied into `result`. */
function valueInto(builder: FlowBuilder, result: ValueId, body: Block): void {
  const value = builder.block(body);
  if (value !== undefined) {
    builder.emit({ op: 'copy', site: body, into: result, from: value, fit: undefined });
  }
}

/** `body`'s value given as the construct's, then on to where its paths meet. */
function giveInto(builder: FlowBuilder, given: Given, body: Block): void {
  valueInto(builder, given.result, body);
  builder.end({ kind: 'goto', to: given.end });
}
