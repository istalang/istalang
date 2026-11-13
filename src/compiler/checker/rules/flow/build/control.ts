/**
 * Control (§4, §8), as lowering writes it (lowering/constructs/expressions/control/):
 *
 * - `if`: each condition runs where the ones before failed, then its body or the next condition; a
 *   condition its operands' types decide (`decidedOf`) runs alone, ruling its body out when false
 *   and every later branch when true. A branch is a scope its condition binds into, ended on both
 *   of its paths. `match` tests each case's pattern and guard in turn, a failing guard ending the
 *   case's scope.
 * - `and`, `or` and `??` run their right side only sometimes; `e?` returns `e`'s error, and `e!`,
 *   read as `e ??` a panic, calls `panic` where `e` is none; both go on with the value inside
 *   otherwise.
 * - `await` hands what it waits on to its `onAwait`, suspends, and gives what it settled with. A
 *   `select` evaluates every case's awaitable and hands each to its `onAwait`; an awaiting one
 *   suspends on them all, one that doesn't await never suspends (§8). Then one case's body runs,
 *   what its own future gave bound, or the `else`.
 *
 * A construct giving a value gives it through a temporary each path copies its value into.
 */

import { wellKnown } from '../../../../../foundation/language/well-known/index.ts';
import {
  type ComparisonLink,
  comparisonLinkOf,
  comparisonLinksOf,
} from '../../../../syntax/expressions/comparisons.ts';
import type {
  Await,
  Binary,
  ChainedComparison,
  ConditionalBranch,
  If,
  Is,
  Match,
  Propagate,
  Select,
  SelectCase,
} from '../../../../syntax/expressions/index.ts';
import { binaryOperators } from '../../../../syntax/expressions/operators.ts';
import { casesOf, selectCasesOf } from '../../../../syntax/expressions/readings.ts';
import type { Block } from '../../../../syntax/statements/index.ts';
import type { SyntaxNode } from '../../../../syntax/tree/index.ts';
import { awaitedOf, wellKnownArguments } from '../../../types/type/well-known.ts';
import type { BlockId, ValueId } from '../flow-ir.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { implicitCall, resolvedCall } from './implicit-calls.ts';
import { bindTargets, matchPattern } from './parts.ts';

export function ifFlow(builder: FlowBuilder, node: If): ValueId {
  const given = { result: builder.temporaryOf(node), end: builder.newBlock() };
  const { decidedOf } = builder.body;
  // Past a condition always true, no branch is reached.
  const always = node.branches.findIndex((branch) => decidedOf(branch.condition) === true);
  const reached = always < 0 ? node.branches : node.branches.slice(0, always + 1);
  for (const branch of reached) {
    builder.scopes.inScope(branch, () => guardedBranch(builder, branch, given));
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

/**
 * An `if`'s branch, in its scope: its condition, then its body given as the `if`'s value, the scope
 * ended on the way out; where the condition may fail, the scope ends on that path too.
 */
function guardedBranch(builder: FlowBuilder, branch: ConditionalBranch, given: Given): void {
  builder.expression(branch.condition);
  const taken = () => {
    valueInto(builder, given.result, branch.body);
    builder.scopes.leave(branch);
    builder.end({ kind: 'goto', to: given.end });
  };
  const decided = builder.body.decidedOf(branch.condition);
  if (decided === undefined) {
    const [body, skipped] = builder.branch(2) as [BlockId, BlockId];
    builder.resumeIn(body);
    taken();
    builder.resumeIn(skipped);
  } else if (decided) {
    taken();
  }
}

export function matchFlow(builder: FlowBuilder, node: Match): ValueId {
  const subject = builder.expression(node.subject);
  const given = { result: builder.temporaryOf(node), end: builder.newBlock() };
  const cases = casesOf(node).filter((each) => !builder.body.isRuledOut(each.body));
  for (const each of cases) {
    const failed = builder.newBlock();
    builder.scopes.inScope(each, () => {
      matchPattern(builder, each.pattern, subject, failed);
      if (each.guard !== undefined) {
        builder.expression(each.guard);
        const [holds, fails] = builder.branch(2) as [BlockId, BlockId];
        builder.resumeIn(fails);
        builder.scopes.leave(each);
        builder.end({ kind: 'goto', to: failed });
        builder.resumeIn(holds);
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
  if (kind === 'coalesce') {
    return nullishFlow(builder, node);
  }
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
  if (kind === 'logic') {
    builder.paths([
      () => builder.emit({ op: 'copy', site: node, into: result, from: left, fit: undefined }),
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
  const result = builder.valueOf(operand).type;
  const [, errorOf] =
    (result && wellKnownArguments(builder.inputs.checker, wellKnown.result, result)) ?? [];
  const error = builder.temporary(node, errorOf);
  builder.emit({ op: 'read', site: node, into: error, from: operand, part: { kind: 'inside' } });
  builder.end({ kind: 'return', value: error, site: node });
  builder.resumeIn(ok);
  const inside = builder.temporaryOf(node);
  builder.emit({ op: 'read', site: node, into: inside, from: operand, part: { kind: 'inside' } });
  return inside;
}

/** `a ?? b`: the value inside `a`, or else `b`'s value, evaluated only then. */
function nullishFlow(builder: FlowBuilder, node: Binary): ValueId {
  const whole = builder.expression(node.left);
  const result = builder.temporaryOf(node);
  builder.paths([
    () =>
      builder.emit({ op: 'read', site: node, into: result, from: whole, part: { kind: 'inside' } }),
    () => {
      const right = builder.expression(node.right);
      builder.emit({ op: 'copy', site: node, into: result, from: right, fit: undefined });
    },
  ]);
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
  const futures = cases.map((each) => builder.expression(each.future));
  for (const [index, each] of cases.entries()) {
    awaitedAt(builder, each, futures[index] as ValueId);
  }
  if (node.awaits) {
    builder.emit({ op: 'suspend', site: node, awaited: futures });
  }
  const given = { result: builder.temporaryOf(node), end: builder.newBlock() };
  const otherwise = node.elseClause?.body;
  const starts = builder.branch(cases.length + (otherwise === undefined ? 0 : 1));
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
