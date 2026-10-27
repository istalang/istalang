/**
 * Matching a value against a checked pattern (§3.11; docs/arch/definition.md, "How each construct
 * lowers"): the pattern's tests, each jumping to a failure label, then its bindings.
 *
 * - Tests run in the order the checker gave them, so a variant is tested before its fields are
 *   read. Each reads its part of the subject along its path.
 * - A variant test is a `switch` whose targets are the failure label but for the variant tested.
 *   `==` is the built-in `equal`; any other comparison calls the `compare` the checker resolved
 *   at the pattern's comparison, then turns it into the relation with `order`, as `<` does.
 * - A binding reads its part into a fresh variable, a cell when it is referenced.
 */

import type { Register } from '../../definition/operands.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Span } from '../../text/span.ts';
import type { CheckedPattern, PatternTest, PatternValue } from '../checker/checked-pattern.ts';
import { binaryOperators } from '../syntax/operators.ts';
import type { Label } from './code-writer.ts';
import { constantValue } from './constants.ts';
import type { FunctionContext } from './context.ts';
import { call } from './expressions/calls.ts';
import { ordered } from './expressions/operators.ts';
import { branchOnVariant } from './expressions/variants.ts';
import { readPart } from './places.ts';
import { declareVariable } from './statements/variables.ts';

/** A value being matched, in a register, and the pattern it is matched against. */
export interface Matching {
  readonly subject: Register;
  readonly pattern: CheckedPattern;
}

/** Runs the pattern's tests on the subject, jumping to `fail` at the first that fails. */
export function lowerTests(
  context: FunctionContext,
  { subject, pattern }: Matching,
  fail: Label,
  span: Span,
): void {
  for (const test of pattern.tests) {
    const part = readPart(context, subject, test.path, span);
    const pass = context.code.newLabel();
    if (test.kind === 'variant') {
      const isVariant = { register: part, variant: test.variant };
      branchOnVariant(context, isVariant, { matched: pass, otherwise: fail }, span);
    } else {
      context.code.branch(passed(context, test, part, span), pass, fail, span);
    }
    context.code.place(pass);
  }
}

/** Declares each name the pattern binds, holding its part of the subject. */
export function lowerBindings(
  context: FunctionContext,
  { subject, pattern }: Matching,
  span: Span,
): void {
  for (const binding of pattern.bindings) {
    const part = readPart(context, subject, binding.path, span);
    const register = declareVariable(context, binding.name, binding.type);
    context.code.emit({ kind: 'move', span, dst: register, src: part });
  }
}

/** A register holding whether `part` passes a comparing test. */
function passed(
  context: FunctionContext,
  test: Exclude<PatternTest, { kind: 'variant' }>,
  part: Register,
  span: Span,
): Register {
  if (test.kind === 'compare') {
    const value = context.expression(test.site.value);
    const comparison = call(context, test.site, [part, value]);
    const { meaning } = binaryOperators[test.site.operator];
    if (meaning.kind !== 'order') {
      unreachable(`'${test.site.operator}' is an equal test; the checker should have made it one.`);
    }
    return ordered(context, span, comparison, meaning.relation);
  }
  const dst = context.code.allocate();
  context.code.emit({
    kind: 'equal',
    span,
    dst,
    left: part,
    right: comparedWith(context, test.value),
  });
  if (!test.negated) {
    return dst;
  }
  const negated = context.code.allocate();
  context.code.emit({ kind: 'not', span, dst: negated, src: dst });
  return negated;
}

/** The value an `equal` test compares the part with. */
function comparedWith(context: FunctionContext, value: PatternValue): Register {
  if (value.kind === 'expression') {
    return context.expression(value.node);
  }
  const form = context.checker.constantNamed(context.module, value.name)?.form;
  if (form === undefined) {
    unreachable(`'${value.name.text}' has no value; the checker should have said so.`);
  }
  return context.constant(constantValue(context.tables, form), value.name.span);
}
