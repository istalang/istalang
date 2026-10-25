/**
 * What a host may start, and how (§9; docs/arch/boundary.md). Every startable function of the
 * program's own modules gets a start entry, listed in the Definition under the key a host names
 * it by; `main` is started through its own, so what a host reads of any outcome is JSON by the
 * function's declared result.
 *
 * - Startable: a top-level function that isn't generic or extern, or a top-level constant holding
 *   a sendable lambda (§3.14), whose parameters are all taken by value and can be read from JSON,
 *   and whose outcome can be written as JSON. Anything else simply isn't startable.
 * - A start entry is the function's own body with JSON at its edges: it takes each argument as
 *   `Json` and decodes it, so JSON that doesn't fit fails the host's start and nothing runs, and
 *   it encodes whatever it returns. The instance is therefore one execution of the function, as
 *   any other is, and its traces and waits are the function's own.
 */

import type { CodeFunction } from '../../../definition/functions.ts';
import { codecHelpers } from '../../../language/well-known.ts';
import type { Checker } from '../../checker/check.ts';
import { futureArgument } from '../../checker/rules/futures.ts';
import type { FunctionType, Type } from '../../checker/types/type.ts';
import type {
  ConstantDeclaration,
  Declaration,
  FunctionDeclaration,
} from '../../syntax/declarations.ts';
import type { Invalid } from '../../syntax/node.ts';
import { constantValue } from '../constants.ts';
import {
  FunctionLowering,
  instanceFrame,
  nestedFrame,
  type StartEdges,
} from '../function-lowering.ts';
import { rootInstance } from '../instances.ts';
import { keyOf } from '../names.ts';
import type { DefinitionTables, StartTarget } from '../tables.ts';
import { inboundOf } from './inbound.ts';

/** A function a host may start: what it is, the key it goes by, and its signature. */
export interface Startable {
  readonly target: StartTarget;
  readonly key: string;
  readonly parameters: readonly Type[];
  readonly isAsync: boolean;
  /** What it gives: `T` for an async function returning `Future<T>`. */
  readonly outcome: Type;
}

/** Every function of the program's own modules a host may start, in module and source order. */
export function startables(checker: Checker): readonly Startable[] {
  return [...checker.program.modules].flatMap(([, module]) =>
    module.isStd === true
      ? []
      : module.tree.root.items.flatMap((item) => {
          const startable = startableOf(checker, item);
          return startable === undefined ? [] : [startable];
        }),
  );
}

/** `item` as a host would start it; undefined when it isn't startable. */
export function startableOf(checker: Checker, item: Declaration | Invalid): Startable | undefined {
  switch (item.kind) {
    case 'FunctionDeclaration':
      return functionStartable(checker, item);
    case 'VariableDeclaration':
      return lambdaStartable(checker, item);
    default:
      return undefined;
  }
}

function functionStartable(
  checker: Checker,
  declaration: FunctionDeclaration,
): Startable | undefined {
  const parameters = checker.parametersOf(declaration);
  if (
    declaration.isExtern ||
    declaration.body === undefined ||
    declaration.typeParameters.length > 0 ||
    parameters.some((parameter) => parameter.reference)
  ) {
    return undefined;
  }
  const outcome = checker.bodyOf(declaration)?.result;
  return outcome === undefined
    ? undefined
    : crossing(checker, {
        target: declaration,
        key: keyOf(checker, declaration, parameters),
        parameters: parameters.map(({ type }) => type),
        isAsync: declaration.isAsync,
        outcome,
      });
}

function lambdaStartable(
  checker: Checker,
  declaration: ConstantDeclaration,
): Startable | undefined {
  const constant = checker.constantOf(declaration);
  const type = constant?.type;
  if (constant?.form?.kind !== 'function' || type?.kind !== 'function' || !type.isSendable) {
    return undefined;
  }
  const signature: FunctionType = type;
  if (signature.parameters.some((parameter) => parameter.reference)) {
    return undefined;
  }
  const parameters = signature.parameters.map(({ type: each }) => each);
  const future = signature.isAsync ? futureArgument(checker, signature.result) : undefined;
  return crossing(checker, {
    target: declaration,
    key: keyOf(checker, declaration, signature.parameters),
    parameters,
    isAsync: signature.isAsync,
    outcome: future ?? signature.result,
  });
}

/** `startable` when what it takes can be read from JSON and what it gives written. */
function crossing(checker: Checker, startable: Startable): Startable | undefined {
  const readable = startable.parameters.every(
    (type) => checker.json.problemOf(type, 'read') === undefined,
  );
  return readable && checker.json.problemOf(startable.outcome, 'write') === undefined
    ? startable
    : undefined;
}

/** The start entry of `startable`: its own body, with JSON at its edges (function-lowering.ts). */
export function startEntry(
  lowering: { readonly checker: Checker; readonly tables: DefinitionTables },
  startable: Startable,
): CodeFunction {
  const { checker, tables } = lowering;
  const { target, parameters, outcome, key } = startable;
  const edges: StartEdges = {
    parameters: parameters.map((type, index) =>
      inboundOf(checker, type, codecHelpers.hostInput, `${key} argument ${index + 1}`),
    ),
    outcome: checker.json.encoderOf(outcome),
    self: undefined,
  };
  const header = tables.declarationHeader(target);
  if (target.kind === 'FunctionDeclaration') {
    const instance = rootInstance(checker, target);
    const body = checker.bodyOf(target);
    if (body === undefined || target.body === undefined) {
      throw new Error('A startable function has no body.');
    }
    const lowered = { checker, tables, owner: { kind: 'function', instance } as const, body };
    const frame = { ...instanceFrame(lowered, instance), header };
    return new FunctionLowering(lowered, frame).lowerStart(edges, target.body);
  }
  const form = checker.constantOf(target)?.form;
  const body = checker.constantBodyOf(target);
  if (form?.kind !== 'function' || body === undefined || form.lambda.body === undefined) {
    throw new Error('A startable constant holds no lambda.');
  }
  const owner = { kind: 'constant', declaration: target } as const;
  const frame = { ...nestedFrame(tables, { owner, node: form.lambda }, body), header };
  const self = constantValue(tables, form);
  return new FunctionLowering({ checker, tables, owner, body }, frame).lowerStart(
    { ...edges, self },
    form.lambda.body,
  );
}
