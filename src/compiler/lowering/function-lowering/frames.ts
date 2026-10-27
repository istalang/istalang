/**
 * The frames lowering lays an entry's code out in (docs/arch/definition.md, "Frames"): what an
 * entry is lowered from, and what it is called, takes, captures and produces, for a function
 * instance's entry and for a nested function's.
 *
 * - A default's entry reads its function's defaults' body (§3.1, §3.3), its own entry its own body,
 *   through the instance's substitution; a nested function reads its owner's, or a constant's.
 *   These are the only rules of which body an entry reads.
 * - A start entry is one of these, entered by the host's name for it and encoding what it returns
 *   (boundary/starts.ts), which its frame says from the start.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type {
  CapturedVariable,
  CheckedBody,
  Checker,
  NestedFunction,
  SignatureParameter,
} from '../../checker/check.ts';
import { instantiatedBody } from '../../checker/types/instantiation.ts';
import type { Type } from '../../checker/types/type.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { ClosedCall } from '../instances.ts';
import {
  type BodyOwner,
  type FunctionInstance,
  type NestedInstance,
  substitutionOf,
} from '../instances.ts';
import type { DefinitionTables, EntryHeader } from '../tables.ts';

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

/** A start entry's frame: the name the host enters it by, and the call encoding what it gives. */
export interface StartFrame {
  readonly header: EntryHeader;
  readonly outcome: ClosedCall;
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
  /** What a start entry encodes its returns with; undefined for any other entry. */
  readonly outcome: ClosedCall | undefined;
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

/** What a nested function of `owner` is lowered from: its owner's body. */
export function loweredNested(lowering: Lowering, owner: BodyOwner): LoweredFunction {
  const body =
    owner.kind === 'constant'
      ? lowering.checker.constantBodyOf(owner.declaration)
      : ownBodyOf(lowering.checker, owner.instance);
  if (body === undefined) {
    unreachable('A nested function has no checked body holding it.');
  }
  return { ...lowering, owner, body };
}

/**
 * The body an instance's code reads, through its substitution: its defaults' for a default's entry
 * (§3.1, §3.3), else its own; undefined for an extern, or a filling entry, which reads none.
 */
function ownBodyOf(checker: Checker, instance: FunctionInstance): CheckedBody | undefined {
  const body = bodyOfEntry(checker, instance);
  return body === undefined ? undefined : instantiatedBody(body, substitutionOf(instance));
}

function bodyOfEntry(checker: Checker, instance: FunctionInstance): CheckedBody | undefined {
  const { declaration, entry } = instance;
  switch (entry.kind) {
    case 'own':
      return checker.bodyOf(declaration);
    case 'default':
      return checker.defaultsOf(declaration);
    case 'filling':
      return undefined;
    default: {
      const unhandled: never = entry;
      return unhandled;
    }
  }
}

/**
 * The frame of a top-level function's instance, whose body `lowered` reads: every parameter for
 * its own entry, those before its parameter for a default's.
 */
export function instanceFrame(
  lowered: LoweredFunction,
  instance: FunctionInstance,
  start?: StartFrame,
): Frame {
  const { checker, tables, body } = lowered;
  const { declaration, entry } = instance;
  const parameters = checker.parametersOf(declaration);
  return {
    header: start?.header ?? tables.entryHeader(instance),
    isAsync: declaration.isAsync && entry.kind === 'own',
    parameters: entry.kind === 'default' ? parameters.slice(0, entry.parameter) : parameters,
    captures: [],
    function: declaration,
    result: body.result,
    self: undefined,
    outcome: start?.outcome,
  };
}

/** The frame of a nested function, as `lowered`'s body, its owner's, checked it. */
export function nestedFrame(
  lowered: LoweredFunction,
  nested: NestedInstance,
  start?: StartFrame,
): Frame {
  const { node } = nested;
  const checked = lowered.body.functionOf(node);
  if (checked === undefined) {
    unreachable(`The function at ${node.span.start} was never checked.`);
  }
  const { type, parameters, captures } = checked;
  return {
    header: start?.header ?? lowered.tables.nestedHeader(nested),
    isAsync: type.isAsync,
    parameters: parameters.map((parameter, index) => {
      const slot = type.parameters[index];
      if (slot === undefined) {
        unreachable(`'${parameter.name.text}' has no slot in its function's type.`);
      }
      return { node: parameter, ...slot };
    }),
    captures,
    function: node,
    result: type.result,
    self: node.name,
    outcome: start?.outcome,
  };
}
