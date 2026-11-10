/**
 * The frames lowering lays an entry's code out in (docs/arch/definition.md, "Frames"): what an
 * entry is lowered from, and what it is called, takes, captures and produces, for a function
 * instance's entry and for a nested function's.
 *
 * - An instance's entry reads its own body through the instance's substitution, and its prologue
 *   its defaults' body, checked apart (§3.1, §3.3); a nested function reads its owner's, or a
 *   constant's, the defaults' when its owner is them. These are the only rules of which body an
 *   entry reads.
 * - A function with no body of its own, a struct's or a variant's fields or an extern called with
 *   defaults left out, has an entry built from its parameters once its prologue has computed them
 *   (built-entries.ts): plain, giving what its function gives.
 * - A start entry is one of these, entered by the host's name for it
 *   (synthesized/boundary/starts.ts), which its frame's header says from the start.
 */

import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker, SignatureParameter } from '../../checker/check.ts';
import type {
  CapturedVariable,
  CheckedBody,
  NestedFunction,
} from '../../checker/surface/checked-body.ts';
import { substitute } from '../../checker/types/parts/substitution.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { awaits } from '../../syntax/tokens/modifiers.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import {
  type BodyOwner,
  type FieldPassStep,
  type FunctionInstance,
  type NestedInstance,
  passBindings,
  substitutionOf,
} from '../tables/instances.ts';
import type { DefinitionTables, EntryHeader } from '../tables/tables.ts';

/** What lowering an entry needs from the program: its checking and the Definition's tables. */
export interface Lowering {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
}

/** What lowering an entry starts from: what owns its body, the body read through it, the tables. */
export interface LoweredFunction extends Lowering {
  readonly owner: BodyOwner;
  readonly body: CheckedBody;
}

/** A body as lowering reads it: what owns it, and the body, which an entry built has none of. */
export interface BodyReading {
  readonly owner: BodyOwner;
  readonly body: CheckedBody | undefined;
}

/**
 * The frame an entry's code runs in: what it is called, what it takes, what it captures and what
 * it produces.
 */
export interface Frame {
  readonly header: EntryHeader;
  readonly isAsync: boolean;
  readonly parameters: readonly SignatureParameter[];
  readonly captures: readonly CapturedVariable[];
  /** The function the entry runs: a top-level declaration, or a nested function. */
  readonly function: NestedFunction;
  /** `T` for an async entry returning `Future<T>`. */
  readonly result: Type;
  /** The name a nested function calls itself by. */
  readonly self: Identifier | undefined;
}

/** What `instance`'s entry is lowered from; undefined for an instance with no body, an extern. */
export function loweredInstance(
  lowering: Lowering,
  instance: FunctionInstance,
): LoweredFunction | undefined {
  const body = ownBodyOf(lowering.checker, instance);
  const owner = { kind: 'function', instance } as const;
  return body === undefined ? undefined : { ...lowering, owner, body };
}

/** What `instance`'s defaults are read as: by its prologue, through its substitution (§3.3). */
export function defaultsReading(checker: Checker, instance: FunctionInstance): BodyReading {
  const owner = { kind: 'defaults', instance } as const;
  return { owner, body: defaultsBodyOf(checker, instance) };
}

/**
 * What a nested function of `owner` is lowered from: its owner's body, as the passes of the field
 * loops the owner is lowered in read it (§4).
 */
export function loweredNested(lowering: Lowering, owner: BodyOwner): LoweredFunction {
  const { checker } = lowering;
  const body = bodyOfOwner(checker, owner);
  if (body === undefined) {
    unreachable('A nested function has no checked body holding it.');
  }
  const passed = (owner.passes ?? []).reduce((outer, step) => passBody(checker, outer, step), body);
  return { ...lowering, owner, body: passed };
}

/**
 * `body` as the pass `step` names reads it (§4): the field's own pass, or the pass of the fields a
 * struct constraint leaves unnamed, read with its key standing for the field.
 */
export function passBody(checker: Checker, body: CheckedBody, step: FieldPassStep): CheckedBody {
  const passes = body.passesOf(step.header);
  const own = passes.find(({ visits }) => visits.kind === 'field' && visits.name === step.field);
  if (own !== undefined) {
    return own.body;
  }
  const others =
    passes.find((pass) => pass.visits.kind === 'others') ??
    unreachable(`No pass of a field loop reads the field '${step.field}'.`);
  return others.body.instantiated(passBindings([step]), checker);
}

/** The body `owner` is, read through its substitution; undefined for a function with none. */
function bodyOfOwner(checker: Checker, owner: BodyOwner): CheckedBody | undefined {
  switch (owner.kind) {
    case 'function':
      return ownBodyOf(checker, owner.instance);
    case 'defaults':
      return defaultsBodyOf(checker, owner.instance);
    case 'constant':
      return checker.constantBodyOf(owner.declaration);
    default: {
      const unhandled: never = owner;
      return unhandled;
    }
  }
}

/** The body an instance's code reads, through its substitution; undefined for one with none. */
function ownBodyOf(checker: Checker, instance: FunctionInstance): CheckedBody | undefined {
  return checker.bodyOf(instance.declaration)?.instantiated(substitutionOf(instance), checker);
}

/** The body an instance's defaults are checked in, through its substitution, if it has any. */
function defaultsBodyOf(checker: Checker, instance: FunctionInstance): CheckedBody | undefined {
  return checker.defaultsOf(instance.declaration)?.instantiated(substitutionOf(instance), checker);
}

/** The frame of a top-level function's instance, whose body `lowered` reads: every parameter. */
export function instanceFrame(
  lowered: LoweredFunction,
  instance: FunctionInstance,
  startHeader?: EntryHeader,
): Frame {
  const { checker, tables, body } = lowered;
  const { declaration } = instance;
  return {
    header: startHeader ?? tables.entryHeader(instance),
    isAsync: awaits(declaration.qualifiers),
    parameters: checker.parametersOf(declaration),
    captures: [],
    function: declaration,
    result: body.result,
    self: undefined,
  };
}

/**
 * The frame of an entry built from `instance`'s parameters, with no body of its own: plain, taking
 * every parameter, and giving what the function gives.
 */
export function builtFrame(lowering: Lowering, instance: FunctionInstance): Frame {
  const { checker, tables } = lowering;
  const { declaration } = instance;
  return {
    header: tables.entryHeader(instance),
    isAsync: false,
    parameters: checker.parametersOf(declaration),
    captures: [],
    function: declaration,
    result: substitute(checker.resultOf(declaration), substitutionOf(instance), checker.typeRules),
    self: undefined,
  };
}

/** The frame of a nested function, as `lowered`'s body, its owner's, checked it. */
export function nestedFrame(
  lowered: LoweredFunction,
  nested: NestedInstance,
  startHeader?: EntryHeader,
): Frame {
  const { node } = nested;
  const checked = lowered.body.functionOf(node);
  if (checked === undefined) {
    unreachable(`The function at ${node.span.from} was never checked.`);
  }
  const { result, parameters, captures } = checked;
  return {
    header: startHeader ?? lowered.tables.nestedHeader(nested),
    isAsync: awaits(node.qualifiers),
    parameters,
    captures,
    function: node,
    result,
    self: node.name,
  };
}
