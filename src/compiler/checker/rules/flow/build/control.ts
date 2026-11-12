/**
 * Control (§4, §8), as lowering writes it (lowering/constructs/expressions/control/):
 *
 * - `if`: each condition runs where the ones before failed, then its body or the next condition; a
 *   condition its operands' types decide (`decidedOf`) runs alone, ruling its body out when false
 *   and every later branch when true. `match` tests each case's pattern and guard in turn.
 * - `and`, `or` and `??` run their right side only sometimes; `e?` returns `e`'s error, `e!` calls
 *   `panic` where `e` is none, and both go on with the value inside otherwise.
 * - `await` hands what it waits on to its `onAwait` and suspends; `select` evaluates every case's
 *   awaitable, hands each to its `onAwait`, suspends on them all, then runs one case's body, with
 *   what it gave bound, or the `else`.
 *
 * A construct giving a value gives it through a temporary each path copies its value into.
 */

import {
  type ComparisonLink,
  comparisonLinkOf,
  comparisonLinksOf,
} from '../../../../syntax/expressions/comparisons.ts';
import type {
  Await,
  Binary,
  ChainedComparison,
  If,
  Is,
  Match,
  Propagate,
  Select,
  Unwrap,
} from '../../../../syntax/expressions/index.ts';
import { binaryOperators } from '../../../../syntax/expressions/operators.ts';
import { casesOf, selectCasesOf } from '../../../../syntax/expressions/readings.ts';
import type { Block } from '../../../../syntax/statements/index.ts';
import type { SyntaxNode } from '../../../../syntax/tree/index.ts';
import type { BlockId, ValueId } from '../flow-ir.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { implicitCall, resolvedCall } from './implicit-calls.ts';
import { bindTargets, constant, matchPattern } from './parts.ts';

export function ifFlow(builder: FlowBuilder, node: If): ValueId {
  const given = { result: builder.temporaryOf(node), end: builder.newBlock() };
  const { decidedOf } = builder.body;
  // Past a condition always true, no branch is reached.
  const always = node.branches.findIndex((branch) => decidedOf(branch.condition) === true);
  const reached = always < 0 ? node.branches : node.branches.slice(0, always + 1);
  for (const { condition, body } of reached) {
    builder.expression(condition);
    const decided = decidedOf(condition);
    if (decided === true) {
      giveInto(builder, given, body);
    } else if (decided === undefined) {
      const [taken, skipped] = builder.branch(2) as [BlockId, BlockId];
      builder.resumeIn(taken);
      giveInto(builder, given, body);
      builder.resumeIn(skipped);
    }
  }
  const otherwise = node.elseClause?.body;
  if (otherwise !== undefined && !builder.body.isRuledOut(otherwise)) {
    giveInto(builder, given, otherwise);
  } else {
    builder.emit({ op: 'compute', site: node, into: given.result, operands: [] });
    builder.end({ kind: 'goto', to: given.end });
  }
  builder.resumeIn(given.end);
  return given.result;
}

export function matchFlow(builder: FlowBuilder, node: Match): ValueId {
  const subject = builder.expression(node.subject);
  const given = { result: builder.temporaryOf(node), end: builder.newBlock() };
  const cases = casesOf(node).filter((each) => !builder.body.isRuledOut(each.body));
  for (const each of cases) {
    const failed = builder.newBlock();
    builder.inScope(each, () => {
      matchPattern(builder, each.pattern, subject, failed);
      if (each.guard !== undefined) {
        builder.expression(each.guard);
        branchOr(builder, failed);
      }
      valueInto(builder, given.result, each.body);
    });
    builder.end({ kind: 'goto', to: given.end });
    builder.resumeIn(failed);
  }
  builder.end({ kind: 'stop' });
  builder.resumeIn(given.end);
  return given.result;
}

export function isFlow(builder: FlowBuilder, node: Is): ValueId {
  const subject = builder.expression(node.subject);
  const result = builder.temporaryOf(node);
  const failed = builder.newBlock();
  const end = builder.newBlock();
  matchPattern(builder, node.pattern, subject, failed);
  builder.emit({ op: 'compute', site: node, into: result, operands: [] });
  builder.end({ kind: 'goto', to: end });
  builder.resumeIn(failed);
  builder.emit({ op: 'compute', site: node, into: result, operands: [] });
  builder.continueIn(end);
  return result;
}

export function binaryFlow(builder: FlowBuilder, node: Binary): ValueId {
  const { kind } = binaryOperators[node.operator].meaning;
  const left = builder.expression(node.left);
  const result = builder.temporaryOf(node);
  const link = comparisonLinkOf(node);
  if (link !== undefined) {
    const right = builder.expression(node.right);
    if (builder.body.decidedOf(node) === undefined) {
      compared(builder, link, [left, right], result);
    } else {
      builder.emit({ op: 'compute', site: node, into: result, operands: [] });
    }
    return result;
  }
  if (kind === 'logic' || kind === 'coalesce') {
    const inside = kind === 'coalesce' ? builder.temporary(node.left, undefined) : left;
    builder.paths([
      () => {
        if (kind === 'coalesce') {
          builder.emit({
            op: 'read',
            site: node,
            into: inside,
            from: left,
            part: { kind: 'inside' },
          });
        }
        builder.emit({ op: 'copy', site: node, into: result, from: inside, fit: undefined });
      },
      () => {
        const right = builder.expression(node.right);
        builder.emit({ op: 'copy', site: node, into: result, from: right, fit: undefined });
      },
    ]);
    return result;
  }
  const right = builder.expression(node.right);
  const call = builder.body.resolved.get(node);
  if (call === undefined) {
    builder.emit({ op: 'compute', site: node, into: result, operands: [left, right] });
  } else {
    const passed = [left, right].map((value) => ({ kind: 'value', value }) as const);
    resolvedCall(builder, call, { site: node, passed, into: result });
  }
  return result;
}

export function chainedComparison(builder: FlowBuilder, node: ChainedComparison): ValueId {
  const result = builder.temporaryOf(node);
  const evaluated = new Map<SyntaxNode, ValueId>();
  const operand = (expression: ChainedComparison['operands'][number]) => {
    const value = evaluated.get(expression) ?? builder.expression(expression);
    evaluated.set(expression, value);
    return value;
  };
  const end = builder.newBlock();
  for (const [index, link] of comparisonLinksOf(node).entries()) {
    if (index > 0) {
      const [next, done] = builder.branch(2) as [BlockId, BlockId];
      builder.resumeIn(done);
      builder.end({ kind: 'goto', to: end });
      builder.resumeIn(next);
    }
    compared(builder, link, [operand(link.left), operand(link.right)], result);
  }
  builder.continueIn(end);
  return result;
}

/**
 * Whether `link` holds, into `result`: the built-in `==`, or the `compare` or `includes` checking
 * made at its right operand, `includes` taking the collection first.
 */
function compared(
  builder: FlowBuilder,
  link: ComparisonLink,
  [left, right]: readonly [ValueId, ValueId],
  result: ValueId,
): void {
  const { meaning } = binaryOperators[link.operator];
  if (meaning.kind === 'equality') {
    builder.emit({ op: 'compute', site: link.right, into: result, operands: [left, right] });
    return;
  }
  const role = meaning.kind === 'membership' ? 'includes' : 'compare';
  const passed = role === 'includes' ? [right, left] : [left, right];
  implicitCall(builder, role, { site: link.right, passed, into: result });
}

export function propagate(builder: FlowBuilder, node: Propagate): ValueId {
  const operand = builder.expression(node.operand);
  const [failed, ok] = builder.branch(2) as [BlockId, BlockId];
  builder.resumeIn(failed);
  const error = builder.temporary(node, undefined);
  builder.emit({ op: 'read', site: node, into: error, from: operand, part: { kind: 'inside' } });
  builder.end({ kind: 'return', value: error, site: node });
  builder.resumeIn(ok);
  const inside = builder.temporaryOf(node);
  builder.emit({ op: 'read', site: node, into: inside, from: operand, part: { kind: 'inside' } });
  return inside;
}

export function unwrap(builder: FlowBuilder, node: Unwrap): ValueId {
  const operand = builder.expression(node.operand);
  const [none, some] = builder.branch(2) as [BlockId, BlockId];
  builder.resumeIn(none);
  implicitCall(builder, 'panic', { site: node, passed: [constant(builder, node)] });
  builder.end({ kind: 'stop' });
  builder.resumeIn(some);
  const inside = builder.temporaryOf(node);
  builder.emit({ op: 'read', site: node, into: inside, from: operand, part: { kind: 'inside' } });
  return inside;
}

export function awaitFlow(builder: FlowBuilder, node: Await): ValueId {
  const future = builder.expression(node.operand);
  awaitedAt(builder, node, future);
  const result = builder.temporaryOf(node);
  builder.emit({ op: 'suspend', site: node, into: result, awaited: [future] });
  return result;
}

export function selectFlow(builder: FlowBuilder, node: Select): ValueId {
  const cases = selectCasesOf(node);
  const futures = cases.map((each) => builder.expression(each.future));
  for (const [index, each] of cases.entries()) {
    awaitedAt(builder, each, futures[index] as ValueId);
  }
  const awaited = builder.temporary(node, undefined);
  builder.emit({ op: 'suspend', site: node, into: awaited, awaited: futures });
  const given = { result: builder.temporaryOf(node), end: builder.newBlock() };
  const otherwise = node.elseClause?.body;
  const starts = builder.branch(cases.length + (otherwise === undefined ? 0 : 1));
  for (const [index, each] of cases.entries()) {
    builder.resumeIn(starts[index] as BlockId);
    builder.inScope(each, () => {
      if (each.binding !== undefined) {
        bindTargets(builder, each, awaited);
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
function awaitedAt(builder: FlowBuilder, node: Await | Select['cases'][number], future: ValueId) {
  if (node.kind !== 'Invalid') {
    implicitCall(builder, 'onAwait', { site: node, passed: [future] });
  }
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

/** Goes on, or to `failed`: a guard that may not hold. */
function branchOr(builder: FlowBuilder, failed: BlockId): void {
  const [holds, fails] = builder.branch(2) as [BlockId, BlockId];
  builder.resumeIn(fails);
  builder.end({ kind: 'goto', to: failed });
  builder.resumeIn(holds);
}
