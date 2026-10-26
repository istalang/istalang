/**
 * The frames lowering lays an entry's code out in (docs/arch/definition.md, "Frames"): what an
 * entry is lowered from, and what it is called, takes, captures and produces, for a function
 * instance's entry and for a nested function's.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type {
  CapturedVariable,
  CheckedBody,
  Checker,
  NestedFunction,
  SignatureParameter,
} from '../../checker/check.ts';
import type { Type } from '../../checker/types/type.ts';
import type { Identifier } from '../../syntax/node.ts';
import type { BodyOwner, FunctionInstance, NestedInstance } from '../instances.ts';
import type { DefinitionTables, EntryHeader } from '../tables.ts';

/** What lowering an entry starts from: what owns its body, the body read through it, the tables. */
export interface LoweredFunction {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
  readonly owner: BodyOwner;
  readonly body: CheckedBody;
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

/**
 * The frame of a top-level function's instance, whose body `lowered` reads: the parameters its
 * callers give.
 */
export function instanceFrame(lowered: LoweredFunction, instance: FunctionInstance): Frame {
  const { checker, tables, body } = lowered;
  const { declaration, arity } = instance;
  const parameters = checker.parametersOf(declaration);
  return {
    header: tables.entryHeader(instance),
    isAsync: declaration.isAsync && arity === parameters.length,
    parameters: parameters.slice(0, arity),
    captures: [],
    function: declaration,
    result: body.result,
    self: undefined,
  };
}

/** The frame of a nested function, as `body`, its owner's, checked it. */
export function nestedFrame(
  tables: DefinitionTables,
  nested: NestedInstance,
  body: CheckedBody,
): Frame {
  const { node } = nested;
  const checked = body.functionOf(node);
  if (checked === undefined) {
    unreachable(`The function at ${node.span.start} was never checked.`);
  }
  const { type, parameters, captures } = checked;
  return {
    header: tables.nestedHeader(nested),
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
  };
}
