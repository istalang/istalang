/**
 * Taking values apart (§3.3, §3.11, §3.15): parameters, declarations' and loops' targets, and
 * patterns, read along the steps checking recorded (`targetsOf`, `patternOf`), as lowering reads
 * them (lowering/constructs/parts/part-paths.ts).
 *
 * - A step through an array (its length, an item, the items between) is the implicit call its
 *   site makes in that role; any other step is a `read` of the part.
 * - A pattern's tests run in order, each failing one going on to what follows a failed match; an
 *   `or` tries each alternative, binding the names of the one that matches. What reaches the end
 *   matched, and the pattern's names are bound there, each a copy into its variable at its name.
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
import type { BlockId, ValueId } from '../../../surface/flow-ir.ts';
import type { Type } from '../../../types/type/index.ts';
import { boolType, intType, literalType, tupleElements } from '../../../types/type/primitives.ts';
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
    branchTo(builder, failed);
    return;
  }
  matchChecked(builder, checked, { subject, failed, pattern });
}

/** A pattern being matched: its subject, where a failing test goes, and the pattern's node. */
interface Matching {
  readonly subject: ValueId;
  readonly failed: BlockId;
  readonly pattern: NodeOf<string>;
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
      const offsets = offsetsOf(step).map(() => constant(builder, step.site, intType));
      part = implicitCall(builder, step.kind, { site: step.site, passed: [part, ...offsets] });
    } else {
      const read = builder.temporary(site, partTypeAt(builder, step, builder.valueOf(part).type));
      builder.emit({ op: 'read', site, into: read, from: part, part: { kind: 'step', step } });
      part = read;
    }
  }
  return part;
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

function matchChecked(builder: FlowBuilder, checked: CheckedPattern, matching: Matching): void {
  for (const test of checked.tests) {
    testPart(builder, test, matching);
  }
  bind(builder, checked.bindings, matching.subject, undefined);
}

function testPart(builder: FlowBuilder, test: PatternTest, matching: Matching): void {
  const { subject, failed, pattern } = matching;
  if (test.kind === 'never') {
    builder.end({ kind: 'goto', to: failed });
    return;
  }
  if (test.kind === 'or') {
    const matched = builder.newBlock();
    for (const alternative of test.alternatives) {
      const next = builder.newBlock();
      matchChecked(builder, alternative, { ...matching, failed: next });
      builder.end({ kind: 'goto', to: matched });
      builder.resumeIn(next);
    }
    builder.end({ kind: 'goto', to: failed });
    builder.resumeIn(matched);
    return;
  }
  const site = test.kind === 'compare' ? test.site : pattern;
  const part = readAlong(builder, subject, test.path, site);
  if (test.kind === 'compare') {
    const passed = [part, patternValueOf(builder, test.value, site)];
    implicitCall(builder, 'compare', { site: test.site, passed });
  } else {
    const holds = builder.temporary(site, boolType);
    const operands =
      test.kind === 'equal' ? [part, patternValueOf(builder, test.value, site)] : [part];
    builder.emit({ op: 'compute', site, into: holds, operands });
  }
  branchTo(builder, failed);
}

/** Goes on, or to `failed`: a test that may fail. */
function branchTo(builder: FlowBuilder, failed: BlockId): void {
  const [holds, fails] = builder.branch(2) as [BlockId, BlockId];
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
      return constant(builder, site, intType);
    default: {
      const unhandled: never = value;
      return unhandled;
    }
  }
}

/** A value of `type` the language makes at `site` with no parts: a literal, an offset. */
export function constant(builder: FlowBuilder, site: NodeOf<string>, type: Type): ValueId {
  const value = builder.temporary(site, type);
  builder.emit({ op: 'compute', site, into: value, operands: [] });
  return value;
}

/** Each of `bindings`' names, its part of `value`, copied into its variable at its name. */
function bind(
  builder: FlowBuilder,
  bindings: readonly (TargetBinding | PartBinding)[],
  value: ValueId,
  lifetime: Lifetime,
): void {
  for (const { name, path } of bindings) {
    const entity = builder.entityOf(name);
    if (entity !== undefined) {
      const variable = builder.variable(entity);
      const part = readAlong(builder, value, path, name);
      builder.emit({ op: 'copy', site: name, into: variable, from: part, fit: undefined });
      builder.scopes.declare(variable, lifetime);
    }
  }
}
