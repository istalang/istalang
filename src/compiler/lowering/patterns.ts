/**
 * Matching a value against a checked pattern (§3.11; docs/arch/definition.md, "How each construct
 * lowers"): the pattern's tests, each jumping to a failure label, then its bindings.
 *
 * - Tests run in the order the checker gave them, so a variant is tested before its fields are
 *   read, and an array's length before its items. Each reads its part of the subject along its
 *   path: fields and tuple elements as places, an array's items and rest through the prelude calls
 *   the checker made at the array pattern.
 * - A variant test is a `switch` whose targets are the failure label but for the variant tested.
 *   `==` is the built-in `equal`; any other comparison calls the `compare` the checker resolved
 *   at the pattern's comparison, then turns it into the relation with `order`, as `<` does. A
 *   length test compares the array's `length` with its fixed count, by `equal`, or with a rest by
 *   the `compare` made for it; a range's bound calls the `compare` made at the bound.
 * - An `or` test tries each alternative's tests in turn, and writes which one matched into a
 *   register. Its names are bound from that alternative once every test has passed, so nothing is
 *   read for a pattern that fails.
 * - A binding reads its part into a fresh variable, a cell when it is referenced.
 */

import type { Register } from '../../definition/operands.ts';
import { unreachable } from '../../structures/unreachable.ts';
import {
  type CheckedPattern,
  namesBound,
  type PartStep,
  type PatternTest,
  type PatternValue,
} from '../checker/checked-pattern.ts';
import type { Identifier } from '../syntax/node.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import type { Label } from './code-writer.ts';
import { constantValue } from './constants.ts';
import type { FunctionContext } from './context.ts';
import { emitImplicitCall } from './emit-call.ts';
import { equal, ordered } from './expressions/operators.ts';
import { branchOnVariant } from './expressions/variants.ts';
import { declareVariable } from './statements/variables.ts';

/** A value being matched, in a register, and the pattern it is matched against. */
export interface Matching {
  readonly subject: Register;
  readonly pattern: CheckedPattern;
}

/** Where a pattern's tests stand: the subject, where a failing test jumps, and each `or`'s choice. */
interface Run {
  readonly subject: Register;
  readonly span: AnchoredSpan;
  readonly fail: Label;
  readonly choices: Map<PatternTest, Register>;
}

/**
 * Runs the pattern's tests on the subject, jumping to `fail` at the first that fails, then declares
 * each name it binds, holding its part of the subject.
 */
export function lowerMatching(
  context: FunctionContext,
  { subject, pattern }: Matching,
  fail: Label,
  span: AnchoredSpan,
): void {
  const run: Run = { subject, span, fail, choices: new Map() };
  lowerTests(context, pattern.tests, run);
  const variables = new Map<Identifier, Register>();
  for (const { name, type } of namesBound(pattern)) {
    variables.set(name, declareVariable(context, name, type));
  }
  bind(context, pattern, run, variables);
}

function lowerTests(context: FunctionContext, tests: readonly PatternTest[], run: Run): void {
  for (const test of tests) {
    if (test.kind === 'or') {
      lowerAlternatives(context, test, run);
    } else {
      const part = readPartAlong(context, run.subject, test.path, run.span);
      const pass = context.code.newLabel();
      lowerTest(context, test, part, { matched: pass, otherwise: run.fail, span: run.span });
      context.code.place(pass);
    }
  }
}

/** Each alternative's tests in turn, until one passes, which then is the test's choice. */
function lowerAlternatives(
  context: FunctionContext,
  test: Extract<PatternTest, { kind: 'or' }>,
  run: Run,
): void {
  const { code } = context;
  const choice = code.allocate();
  const matched = code.newLabel();
  for (const [index, alternative] of test.alternatives.entries()) {
    const next = code.newLabel();
    lowerTests(context, alternative.tests, { ...run, fail: next });
    const chosen = context.constant(BigInt(index), run.span);
    code.emit({ kind: 'move', span: run.span, dst: choice, src: chosen });
    code.jump(matched, run.span);
    code.place(next);
  }
  code.jump(run.fail, run.span);
  code.place(matched);
  run.choices.set(test, choice);
}

/** Where a test jumps: to `matched` when its part passes, else to `otherwise`. */
interface Branch {
  readonly matched: Label;
  readonly otherwise: Label;
  readonly span: AnchoredSpan;
}

function lowerTest(
  context: FunctionContext,
  test: Exclude<PatternTest, { kind: 'or' }>,
  part: Register,
  { matched, otherwise, span }: Branch,
): void {
  if (test.kind === 'variant' || test.kind === 'downcast') {
    const variant =
      test.kind === 'variant' ? test.variant : context.tables.types.anyVariant(test.from, test.to);
    branchOnVariant(context, { register: part, variant }, { matched, otherwise }, span);
    return;
  }
  context.code.branch(passed(context, test, part, span), matched, otherwise, span);
}

/** A register holding whether `part` passes a comparing test. */
function passed(
  context: FunctionContext,
  test: Exclude<PatternTest, { kind: 'variant' | 'downcast' | 'or' }>,
  part: Register,
  span: AnchoredSpan,
): Register {
  const value = comparedWith(context, test.value, span);
  if (test.kind === 'equal') {
    return equal(context, span, [part, value], test.negated);
  }
  const comparison = emitImplicitCall(context, test.site, 'compare', [part, value]);
  return ordered(context, span, comparison, test.relation);
}

/**
 * Moves each part the pattern binds into its variable: the parts outside its `or` tests, then for
 * each of those the alternative its choice names.
 */
function bind(
  context: FunctionContext,
  pattern: CheckedPattern,
  run: Run,
  variables: ReadonlyMap<Identifier, Register>,
): void {
  for (const binding of pattern.bindings) {
    const part = readPartAlong(context, run.subject, binding.path, run.span);
    const variable = variables.get(binding.name);
    if (variable === undefined) {
      unreachable(`'${binding.name.text}' binds nothing; the checker should have declared it.`);
    }
    context.code.emit({ kind: 'move', span: run.span, dst: variable, src: part });
  }
  for (const test of pattern.tests) {
    if (test.kind === 'or') {
      bindChosen(context, test, run, variables);
    }
  }
}

function bindChosen(
  context: FunctionContext,
  test: Extract<PatternTest, { kind: 'or' }>,
  run: Run,
  variables: ReadonlyMap<Identifier, Register>,
): void {
  const { code } = context;
  const choice = run.choices.get(test);
  if (choice === undefined) {
    unreachable("An 'or' test was bound before it ran.");
  }
  const end = code.newLabel();
  for (const [index, alternative] of test.alternatives.entries()) {
    const chosen = code.newLabel();
    const next = code.newLabel();
    const isChosen = equal(context, run.span, [choice, context.constant(BigInt(index), run.span)]);
    code.branch(isChosen, chosen, next, run.span);
    code.place(chosen);
    bind(context, alternative, run, variables);
    code.jump(end, run.span);
    code.place(next);
  }
  code.place(end);
}

/**
 * The part of `subject` along `path`: fields and tuple elements read as a place, and an array's
 * item or rest through the call the checker made at its pattern.
 */
function readPartAlong(
  context: FunctionContext,
  subject: Register,
  path: readonly PartStep[],
  span: AnchoredSpan,
): Register {
  let value = subject;
  let positions: number[] = [];
  for (const step of path) {
    if (typeof step === 'number') {
      positions.push(step);
    } else {
      const array = context.code.readPath(value, positions, span);
      const constants = stepOffsets(step).map((offset) => context.constant(BigInt(offset), span));
      value = emitImplicitCall(context, step.site, step.kind, [array, ...constants]);
      positions = [];
    }
  }
  return context.code.readPath(value, positions, span);
}

function stepOffsets(step: Exclude<PartStep, number>): readonly number[] {
  if (step.kind === 'length') {
    return [];
  }
  return step.kind === 'item' ? [step.offset] : [step.before, step.after];
}

/** The value an `equal` or `compare` test compares the part with. */
function comparedWith(context: FunctionContext, value: PatternValue, span: AnchoredSpan): Register {
  if (value.kind === 'expression') {
    return context.expression(value.node);
  }
  if (value.kind === 'int') {
    return context.constant(value.value, span);
  }
  const form = context.checker.constantNamed(context.module, value.name)?.form;
  if (form === undefined) {
    unreachable(`'${value.name.text}' has no value; the checker should have said so.`);
  }
  return context.constant(constantValue(context.tables, form), value.name.span);
}
