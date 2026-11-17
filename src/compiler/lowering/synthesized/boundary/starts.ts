/**
 * What a host may start, and how (§9; docs/arch/boundary.md). Every startable function of the
 * program's own modules gets a start entry, listed in the Definition under the key a host names
 * it by with the codec encoding its outcome; `main` is started through its own, so what a host
 * reads of any outcome is JSON by the function's declared result.
 *
 * - Startable: a top-level function the rule of what a host may start admits
 *   (foundation/language/starts.ts), or a top-level constant holding a sendable lambda (§3.14),
 *   whose parameters can be read from JSON and whose outcome written. Its kind is its head's, a
 *   lambda's the checker's, so ista code, which a host never starts, gets no entry.
 *   Anything else simply isn't startable.
 * - A start entry wraps the function (ir-first design, decision 7): it takes each argument as
 *   `Json` and decodes it, so JSON that doesn't fit fails the host's start before the function
 *   runs, and calls the function, giving what it gives: an async one's future, unawaited. Its
 *   encoding entry writes the outcome as `Json`, which the runtime calls the moment the outcome
 *   settles: a run ends when its root call returns, with no wait between that a callback readied
 *   meanwhile could run in (§10).
 */

import type { Register } from '../../../../definition/operands.ts';
import type { CodeFunction } from '../../../../definition/tables/functions.ts';
import { isStartable, type StartShape } from '../../../../foundation/language/starts.ts';
import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../../checker/check.ts';
import { persistenceOf } from '../../../checker/types/type/function-kinds.ts';
import { isSendableFunction } from '../../../checker/types/type/function-types.ts';
import type { FunctionType, Type } from '../../../checker/types/type/index.ts';
import { literalType } from '../../../checker/types/type/primitives.ts';
import { outcomeOf } from '../../../checker/types/type/well-known.ts';
import type {
  ConstantDeclaration,
  Declaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import { startShapeOf } from '../../../syntax/declarations/starts.ts';
import { awaits } from '../../../syntax/tokens/modifiers.ts';
import type { Invalid } from '../../../syntax/tree/node.ts';
import { emitCall } from '../../calls/emit-call.ts';
import type { Lowering } from '../../context.ts';
import { constantValue } from '../../tables/constants.ts';
import type { StartTarget } from '../../tables/entries.ts';
import { keyOf } from '../../tables/extern-keys.ts';
import { rootInstance } from '../../tables/instances.ts';
import { SynthesizedCode } from '../index.ts';
import { codecCall } from './codec-calls.ts';
import { jsonOf } from './host-externs.ts';
import { emitInbound, inboundOf } from './inbound.ts';

/** A function a host may start: what it is, the key it goes by, and its signature. */
interface Startable {
  readonly target: StartTarget;
  readonly key: string;
  readonly parameters: readonly Type[];
  /** What it gives: `T` for an async function returning `Future<T>`. */
  readonly outcome: Type;
  /** Whether it is async, giving a future of its outcome. */
  readonly awaits: boolean;
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
  const shape = startShapeOf(declaration);
  const outcome = checker.bodyOf(declaration)?.result;
  const parameters = checker.parametersOf(declaration);
  return !isStartable(shape) || outcome === undefined
    ? undefined
    : crossing(checker, {
        target: declaration,
        key: keyOf(checker, declaration, parameters),
        parameters: parameters.map(({ type }) => type),
        outcome,
        awaits: awaits(declaration.qualifiers),
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
    outcome: shape.awaits ? outcomeOf(checker, signature.result) : signature.result,
    awaits: shape.awaits,
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

/** Lists `startable` among what a host may start; the key it goes by. */
export function listStart(lowering: Lowering, startable: Startable): string {
  lowering.tables.startIndex(startable.target, startable.key);
  return startable.key;
}

/** The start entry of `startable`, wrapping it (the banner). */
export function startEntry(lowering: Lowering, startable: Startable): CodeFunction {
  const { checker, tables } = lowering;
  const { target, parameters, key, outcome } = startable;
  const json = jsonOf(checker);
  const header = tables.declarationHeader(target);
  const future = checker.wellKnownType(wellKnown.future, [outcome, literalType('live')]);
  const given = startable.awaits ? (future ?? unreachable('The prelude has futures.')) : outcome;
  const code = new SynthesizedCode(lowering, startSpanOf(target), {
    parameters: parameters.map(() => tables.types.reference(json)),
    result: tables.types.reference(given),
    mode: 'simple',
  });
  const values = parameters.map((type, index) => {
    const inbound = inboundOf(checker, undefined, type, {
      from: 'input',
      path: `${key} argument ${index + 1}`,
    });
    const argument = code.parameters[index] ?? unreachable(`No argument ${index} of a start.`);
    return emitInbound(code, argument, inbound, code.span);
  });
  code.return(calledTarget(code, target, { values, given }));
  return code.entry(header);
}

/** The entry encoding `startable`'s outcome as `Json` (the banner). */
export function startEncodeEntry(lowering: Lowering, startable: Startable): CodeFunction {
  const { checker, tables } = lowering;
  const { target, outcome } = startable;
  const json = jsonOf(checker);
  const code = new SynthesizedCode(lowering, startSpanOf(target), {
    parameters: [tables.types.reference(outcome)],
    result: tables.types.reference(json),
    mode: 'simple',
  });
  const value = code.parameters[0] ?? unreachable('An encoding takes its outcome.');
  code.return(code.call(codecCall(checker, undefined, outcome, 'write'), [value], json));
  return code.entry(tables.declarationHeader(target));
}

/** Calls `target` with `values`, giving a value of `given`: a function, or a constant's lambda. */
function calledTarget(
  code: SynthesizedCode,
  target: StartTarget,
  { values, given }: { readonly values: readonly Register[]; readonly given: Type },
): Register {
  const { checker, tables } = code;
  if (target.kind === 'FunctionDeclaration') {
    return code.call(
      tables.index({ kind: 'instance', instance: rootInstance(checker, target) }),
      values,
      given,
    );
  }
  const constant = checker.constantOf(target);
  if (constant?.form?.kind !== 'function' || constant.type === undefined) {
    return unreachable('A startable constant holds no lambda.');
  }
  const closure = code.constant(constantValue(tables, constant.form), constant.type);
  return emitCall(
    code,
    {
      span: code.span,
      callee: { kind: 'value', register: closure },
      arguments: values,
    },
    tables.types.reference(given),
  );
}

/** Where a start points: its function's or its constant's name. */
function startSpanOf(target: StartTarget) {
  return target.kind === 'FunctionDeclaration' ? target.name.span : target.span;
}
