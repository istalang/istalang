/**
 * What a host may start, and how (§9; docs/arch/boundary.md). Every startable function of the
 * program's own modules gets a start entry, listed in the Definition under the key a host names
 * it by with the codec encoding its outcome; `main` is started through its own, so what a host
 * reads of any outcome is JSON by the function's declared result.
 *
 * - Startable: a top-level function the rule of what a host may start admits
 *   (foundation/language/starts.ts), or a top-level constant holding a sendable lambda (§3.14),
 *   whose parameters can be read from JSON and whose outcome written. Its kind is the checker's,
 *   inferred where the head writes none, so ista code, which a host never starts, gets no entry.
 *   Anything else simply isn't startable.
 * - A start entry is the function's own body taking each argument as `Json` and decoding it, so
 *   JSON that doesn't fit fails the host's start and nothing runs. The run is therefore one
 *   execution of the function, as any other is, and its traces and waits are the function's own.
 *   What it returns is encoded as every outcome is, by the runtime as it returns.
 */

import type { FunctionId } from '../../../../definition/operands.ts';
import type { CodeFunction } from '../../../../definition/tables/functions.ts';
import { isStartable, type StartShape } from '../../../../foundation/language/starts.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../../checker/check.ts';
import { kindOfFunction, persistenceOf } from '../../../checker/types/type/function-kinds.ts';
import { isSendableFunction } from '../../../checker/types/type/function-types.ts';
import type { FunctionType, Type } from '../../../checker/types/type/index.ts';
import { outcomeOf } from '../../../checker/types/type/well-known.ts';
import type {
  ConstantDeclaration,
  Declaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import { startShapeOf } from '../../../syntax/declarations/starts.ts';
import { awaits } from '../../../syntax/tokens/modifiers.ts';
import type { Invalid } from '../../../syntax/tree/node.ts';
import { writtenBodyOf } from '../../functions/bodies.ts';
import { instanceLowering, nestedLowering, type StartEdges } from '../../functions/index.ts';
import { constantValue } from '../../tables/constants.ts';
import { rootInstance } from '../../tables/instances.ts';
import { keyOf } from '../../tables/names.ts';
import type { DefinitionTables, StartTarget } from '../../tables/tables.ts';
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
  const kind = kindOfFunction(checker, declaration);
  const shape = { ...startShapeOf(declaration), isIsta: persistenceOf(kind) === 'ista' };
  const outcome = checker.bodyOf(declaration)?.result;
  const parameters = checker.parametersOf(declaration);
  return !isStartable(shape) || outcome === undefined
    ? undefined
    : crossing(checker, {
        target: declaration,
        key: keyOf(checker, declaration, parameters),
        parameters: parameters.map(({ type }) => type),
        isAsync: shape.awaits,
        outcome,
      });
}

function lambdaStartable(
  checker: Checker,
  declaration: ConstantDeclaration,
): Startable | undefined {
  const constant = checker.constantOf(declaration);
  const type = constant?.type;
  if (
    constant?.form?.kind !== 'function' ||
    type?.kind !== 'function' ||
    !isSendableFunction(type)
  ) {
    return undefined;
  }
  const signature: FunctionType = type;
  const shape: StartShape = {
    hasBody: true,
    isStatic: false,
    isGeneric: false,
    parameters: signature.parameters,
    awaits: awaits(constant.form.lambda.qualifiers),
    isIsta: persistenceOf(signature.mark) === 'ista',
  };
  if (!isStartable(shape)) {
    return undefined;
  }
  return crossing(checker, {
    target: declaration,
    key: keyOf(checker, declaration, signature.parameters),
    parameters: signature.parameters.map(({ type: each }) => each),
    isAsync: shape.awaits,
    outcome: shape.awaits ? outcomeOf(checker, signature.result) : signature.result,
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

/**
 * The start entry of `startable`: its own body, taking its arguments as JSON (functions/).
 */
export function startEntry(
  lowering: { readonly checker: Checker; readonly tables: DefinitionTables },
  startable: Startable,
): CodeFunction {
  const { checker, tables } = lowering;
  const { target, parameters, key } = startable;
  const edges: StartEdges = {
    parameters: parameters.map((type, index) => {
      const inbound = inboundOf(checker, undefined, type, {
        from: 'input',
        path: `${key} argument ${index + 1}`,
      });
      return (context, json, span) => emitInbound(context, json, inbound, span);
    }),
    self: undefined,
  };
  const header = tables.declarationHeader(target);
  if (target.kind === 'FunctionDeclaration') {
    const entry = instanceLowering(lowering, rootInstance(checker, target), header);
    const body = writtenBodyOf(checker.program, checker.moduleOf(target), target);
    if (entry === undefined || body === undefined) {
      unreachable('A startable function has no body.');
    }
    return entry.lowerStart(edges, body);
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
