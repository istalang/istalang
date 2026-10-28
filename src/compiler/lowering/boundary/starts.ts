/**
 * What a host may start, and how (§9; docs/arch/boundary.md). Every startable function of the
 * program's own modules gets a start entry, listed in the Definition under the key a host names
 * it by with the codec encoding its outcome; `main` is started through its own, so what a host
 * reads of any outcome is JSON by the function's declared result.
 *
 * - Startable: a top-level function that isn't generic or extern, or a top-level constant holding
 *   a sendable lambda (§3.14), whose parameters are all taken by value and can be read from JSON,
 *   and whose outcome can be written as JSON. Anything else simply isn't startable.
 * - A start entry is the function's own body taking each argument as `Json` and decoding it, so
 *   JSON that doesn't fit fails the host's start and nothing runs. The instance is therefore one
 *   execution of the function, as any other is, and its traces and waits are the function's own.
 *   What it returns is encoded as every instance's outcome is, by the runtime as it returns.
 */

import type { CodeFunction } from '../../../definition/functions.ts';
import type { FunctionId } from '../../../definition/operands.ts';
import { codecHelpers } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import type { FunctionType, Type } from '../../checker/types/type.ts';
import { futureArgument } from '../../checker/types/well-known.ts';
import type {
  ConstantDeclaration,
  Declaration,
  FunctionDeclaration,
} from '../../syntax/declarations.ts';
import type { Invalid } from '../../syntax/node.ts';
import { constantValue } from '../constants.ts';
import { instanceLowering, nestedLowering, type StartEdges } from '../function-lowering/index.ts';
import { rootInstance } from '../instances.ts';
import { keyOf } from '../names.ts';
import type { DefinitionTables, StartTarget } from '../tables.ts';
import { codecCall } from './codec-calls.ts';
import { emitInbound, inboundOf } from './inbound.ts';

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
    (type) => checker.json.codecOf(type, 'read') !== undefined,
  );
  return readable && checker.json.codecOf(startable.outcome, 'write') !== undefined
    ? startable
    : undefined;
}

/**
 * Lists `startable` among what a host may start, with the codec encoding its outcome; the index of
 * its start entry.
 */
export function listStart(
  lowering: { readonly checker: Checker; readonly tables: DefinitionTables },
  startable: Startable,
): FunctionId {
  const { checker, tables } = lowering;
  const encoder = tables.callIndex(codecCall(checker, undefined, startable.outcome, 'write'));
  return tables.startIndex(startable.target, startable.key, encoder);
}

/** The start entry of `startable`: its own body, taking its arguments as JSON (function-lowering/). */
export function startEntry(
  lowering: { readonly checker: Checker; readonly tables: DefinitionTables },
  startable: Startable,
): CodeFunction {
  const { checker, tables } = lowering;
  const { target, parameters, key } = startable;
  const edges: StartEdges = {
    parameters: parameters.map((type, index) => {
      const inbound = inboundOf(checker, undefined, type, {
        accept: codecHelpers.hostInput,
        path: `${key} argument ${index + 1}`,
      });
      return (context, json, span) => emitInbound(context, json, inbound, span);
    }),
    self: undefined,
  };
  const header = tables.declarationHeader(target);
  if (target.kind === 'FunctionDeclaration') {
    const entry = instanceLowering(lowering, rootInstance(target), header);
    if (entry === undefined || target.body === undefined) {
      unreachable('A startable function has no body.');
    }
    return entry.lowerStart(edges, target.body);
  }
  const form = checker.constantOf(target)?.form;
  if (form?.kind !== 'function' || form.lambda.body === undefined) {
    unreachable('A startable constant holds no lambda.');
  }
  const owner = { kind: 'constant', declaration: target } as const;
  const self = constantValue(tables, form);
  return nestedLowering(lowering, { owner, node: form.lambda }, header).lowerStart(
    { ...edges, self },
    form.lambda.body,
  );
}
