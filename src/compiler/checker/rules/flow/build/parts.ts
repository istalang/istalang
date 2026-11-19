/**
 * Taking values apart (§6.1, §11.3, §4.5): parameters, declarations' and loops' targets, and
 * patterns, read along the steps checking recorded (`targetsOf`, `patternOf`).
 *
 * - A step through an array (its length, an item, the items between) is the implicit call its
 *   site makes in that role; any other step is a `read` of the part.
 * - A pattern's tests run in order, each failing one going on to what follows a failed match: a
 *   test of what its part holds by type branches on it (`TypeTest`); `==` is the built-in one, any
 *   other comparison the `compare` checking made, related as the test says. An `or` tries each
 *   alternative, binding the names of the one that matches. What reaches the end matched, and the
 *   pattern's names are bound there, each a copy into its variable at its name.
 */

import type { Pattern } from '../../../../syntax/patterns.ts';
import type { LabelledScope } from '../../../../syntax/statements/index.ts';
import type { NodeOf } from '../../../../syntax/tree/node.ts';
import type { SignatureParameter } from '../../../check.ts';
import type {
  ArrayStep,
  CheckedPattern,
  PartBinding,
  PartStep,
  PatternTest,
  PatternValue,
  TargetBinding,
  TargetOwner,
} from '../../../surface/checked-pattern.ts';
import type { ConstantForm } from '../../../surface/constant-form.ts';
import type { BlockId, BranchTest, ValueId } from '../../../surface/flow-ir.ts';
import type { Type } from '../../../types/type/index.ts';
import {
  boolType,
  errorType,
  intType,
  literalType,
  tupleElements,
} from '../../../types/type/primitives.ts';
import type { FlowBuilder } from './flow-builder.ts';
import { implicitCall } from './implicit-calls.ts';

/** Where a name a target binds lives until: its scope, a `hold`'s, or the function's end. */
export type Lifetime = LabelledScope | 'function' | undefined;

/**
 * The function's parameters, as checked: a named one is its variable; one written as a pattern is
 * an argument of its type, taken apart into the names it binds.
 */
export function bindParameters(
  builder: FlowBuilder,
  parameters: readonly SignatureParameter[],
): void {
  for (const { node, type } of parameters) {
    const entity = node.name === undefined ? undefined : builder.entityOf(node.name);
    const argument =
      entity === undefined ? builder.temporary(node, type) : builder.variable(entity);
    builder.parameters.push(argument);
    if (node.pattern !== undefined) {
      bindTargets(builder, node, argument, 'function');
    }
  }
}

/** The names `owner`'s targets bind, each its part of `value`. */
export function bindTargets(
  builder: FlowBuilder,
  owner: TargetOwner,
  value: ValueId,
  lifetime?: Lifetime,
): void {
  bind(builder, builder.body.targetsOf(owner), value, lifetime);
}

/**
 * Tests `pattern` against `subject`: a failing test goes to `failed`; what goes on matched, the
 * names the pattern binds bound and declared in the scope open now.
 */
export function matchPattern(
  builder: FlowBuilder,
  pattern: Pattern,
  subject: ValueId,
  failed: BlockId,
): void {
  const checked = builder.body.patternOf(pattern);
  if (checked === undefined) {
    // A pattern checking found a mistake in may match or not.
    branchTo(builder, { kind: 'unknown' }, failed);
    return;
  }
  const matching = { subject, failed, pattern, choices: new Map() };
  testAll(builder, checked.tests, matching);
  bindMatched(builder, checked, matching);
}

/**
 * A pattern being matched: its subject, where a failing test goes, the pattern's node, and the
 * value saying which alternative of each `or` test matched.
 */
interface Matching {
  readonly subject: ValueId;
  readonly failed: BlockId;
  readonly pattern: NodeOf<string>;
  readonly choices: Map<PatternTest, ValueId>;
}

/**
 * The part of `from` that `path` reaches, read step by step at `site`: an array's through the call
 * its site makes, any other step a `read` of the type the step reaches (`partTypeAt`).
 */
export function readAlong(
  builder: FlowBuilder,
  from: ValueId,
  path: readonly PartStep[],
  site: NodeOf<string>,
): ValueId {
  let part = from;
  for (const step of path) {
    if (typeof step === 'object' && isArrayStep(step)) {
      const offsets = offsetsOf(step).map((offset) =>
        builder.constant(step.site, intType, { kind: 'primitive', value: BigInt(offset) }),
      );
      part = implicitCall(builder, step.kind, { site: step.site, passed: [part, ...offsets] });
    } else {
      const read = builder.temporary(site, partTypeAt(builder, step, builder.valueOf(part).type));
      builder.emit({ op: 'read', site, into: read, from: part, part: { kind: 'step', step } });
      part = read;
    }
  }
  return part;
}

/** The step to the one field of the variant `variant`, of `type`: an `Ok`'s, a `Next`'s. */
export function payload(variant: string, type: Type | undefined): PartStep {
  return { kind: 'variantField', variant, index: 0, type: type ?? errorType };
}

/** The type of the part `step` reaches in a value of type `within`. */
function partTypeAt(
  builder: FlowBuilder,
  step: Exclude<PartStep, ArrayStep>,
  within: Type | undefined,
): Type | undefined {
  if (typeof step === 'number') {
    return within && tupleElements(within)?.[step];
  }
  switch (step.kind) {
    case 'field':
      return builder.inputs.checker.typeRules.fieldType(step.of, literalType(step.name));
    case 'fieldRest':
      return step.to;
    case 'member':
      return step.member;
    case 'variantField':
      return step.type;
    case 'downcast':
      return step.to;
    default: {
      const unhandled: never = step;
      return unhandled;
    }
  }
}

/** Whether `step` reads an array through a call: its length, an item, or the items between. */
function isArrayStep(step: Exclude<PartStep, number>): step is ArrayStep {
  return step.kind === 'length' || step.kind === 'item' || step.kind === 'rest';
}

/** The offsets an array step's call takes besides the array. */
function offsetsOf(step: ArrayStep): readonly number[] {
  switch (step.kind) {
    case 'length':
      return [];
    case 'item':
      return [step.offset];
    case 'rest':
      return [step.before, step.after];
    default: {
      const unhandled: never = step;
      return unhandled;
    }
  }
}

function testAll(builder: FlowBuilder, tests: readonly PatternTest[], matching: Matching): void {
  for (const test of tests) {
    testPart(builder, test, matching);
  }
}

/**
 * Binds the names `checked` binds, once every test has passed: its own, then, for each `or` test,
 * those of the alternative that matched.
 */
function bindMatched(builder: FlowBuilder, checked: CheckedPattern, matching: Matching): void {
  bind(builder, checked.bindings, matching.subject, undefined);
  for (const test of checked.tests) {
    const choice = test.kind === 'or' ? matching.choices.get(test) : undefined;
    if (test.kind === 'or' && choice !== undefined) {
      const end = builder.newBlock();
      for (const [index, alternative] of test.alternatives.entries()) {
        const chosen = builder.temporary(matching.pattern, boolType);
        const position = builder.constant(matching.pattern, intType, chosenAs(index));
        builder.compute(chosen, matching.pattern, { kind: 'equal', negated: false }, [
          choice,
          position,
        ]);
        const isChosen = { kind: 'condition', value: chosen } as const;
        const [bound, next] = builder.branch(isChosen) as [BlockId, BlockId];
        builder.resumeIn(bound);
        bindMatched(builder, alternative, matching);
        builder.end({ kind: 'goto', to: end });
        builder.resumeIn(next);
      }
      builder.continueIn(end);
    }
  }
}

/** The constant an `or` test's choice holds where its alternative at `index` matched. */
function chosenAs(index: number): ConstantForm {
  return { kind: 'primitive', value: BigInt(index) };
}

function testPart(builder: FlowBuilder, test: PatternTest, matching: Matching): void {
  const { subject, failed, pattern } = matching;
  if (test.kind === 'never') {
    builder.end({ kind: 'goto', to: failed });
    return;
  }
  if (test.kind === 'or') {
    const choice = builder.temporary(pattern, intType);
    const matched = builder.newBlock();
    for (const [index, alternative] of test.alternatives.entries()) {
      const next = builder.newBlock();
      testAll(builder, alternative.tests, { ...matching, failed: next });
      builder.compute(choice, pattern, { kind: 'constant', form: chosenAs(index) });
      builder.end({ kind: 'goto', to: matched });
      builder.resumeIn(next);
    }
    builder.end({ kind: 'goto', to: failed });
    builder.resumeIn(matched);
    matching.choices.set(test, choice);
    return;
  }
  const site = test.kind === 'compare' ? test.site : pattern;
  const part = readAlong(builder, subject, test.path, site);
  if (test.kind !== 'compare' && test.kind !== 'equal') {
    branchTo(builder, { kind: 'is', value: part, test }, failed);
    return;
  }
  const value = patternValueOf(builder, test.value, site);
  const holds = builder.temporary(site, boolType);
  if (test.kind === 'equal') {
    builder.compute(holds, site, { kind: 'equal', negated: test.negated }, [part, value]);
  } else {
    const comparison = implicitCall(builder, 'compare', { site, passed: [part, value] });
    builder.compute(holds, site, { kind: 'order', relation: test.relation }, [comparison]);
  }
  branchTo(builder, { kind: 'condition', value: holds }, failed);
}

/** Goes on where `test` holds, else to `failed`. */
function branchTo(builder: FlowBuilder, test: BranchTest, failed: BlockId): void {
  const [holds, fails] = builder.branch(test) as [BlockId, BlockId];
  builder.resumeIn(fails);
  builder.end({ kind: 'goto', to: failed });
  builder.resumeIn(holds);
}

/** The value a test compares a part with: an expression's, a constant's, or an integer. */
function patternValueOf(builder: FlowBuilder, value: PatternValue, site: NodeOf<string>): ValueId {
  switch (value.kind) {
    case 'expression':
      return builder.expression(value.node);
    case 'constant':
      return builder.expression(value.name);
    case 'int':
      return builder.constant(site, intType, { kind: 'primitive', value: value.value });
    default: {
      const unhandled: never = value;
      return unhandled;
    }
  }
}

/**
 * Each of `bindings`' names, its part of `value`, narrowed to the name's type where the pattern
 * narrows it, copied into its variable at its name; a target's `_`, its part kept (`keep`).
 */
function bind(
  builder: FlowBuilder,
  bindings: readonly (TargetBinding | PartBinding)[],
  value: ValueId,
  lifetime: Lifetime,
): void {
  for (const binding of bindings) {
    const { name, path } = binding;
    const entity = name.kind === 'Identifier' ? builder.entityOf(name) : undefined;
    if (name.kind === 'WildcardPattern') {
      keep(builder, name, readAlong(builder, value, path, name), lifetime);
    } else if (entity !== undefined) {
      const variable = builder.variable(entity);
      const part = readAlong(builder, value, [...path, ...narrowing(binding)], name);
      builder.emit({ op: 'copy', site: name, into: variable, from: part, fit: undefined });
      builder.scopes.declare(variable, lifetime);
    }
  }
}

/** `value`, kept at `site` as a variable with no name keeps it (§16), until `lifetime` ends. */
export function keep(
  builder: FlowBuilder,
  site: NodeOf<string>,
  value: ValueId,
  lifetime: Lifetime,
): void {
  const kept = builder.temporary(site, builder.valueOf(value).type);
  builder.emit({ op: 'copy', site, into: kept, from: value, fit: undefined });
  builder.scopes.declare(kept, lifetime);
}

/**
 * The step a pattern's name takes past its part when it holds only some of the part's values
 * (`narrowedFrom`, §11.3): to them, out of the union or `any` type the part is of.
 */
function narrowing(binding: TargetBinding | PartBinding): readonly PartStep[] {
  const from = 'narrowedFrom' in binding ? binding.narrowedFrom : undefined;
  return from === undefined ? [] : [{ kind: 'member', union: from, member: binding.type }];
}
