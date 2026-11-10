/**
 * Externs a host implements (§3.6, §9; docs/arch/boundary.md). A program calls each through a
 * compiled wrapper, the entry its instance is numbered by, so the host's native sees only JSON:
 *
 * - The wrapper encodes every argument, calls the native entry, and decodes what comes back, each
 *   by its declared type's codec, closed within the wrapper's instance (codec-calls.ts). A
 *   result that doesn't fit is a bug in the host, so it panics the instance; a future the host
 *   fills is awaited first, and JSON that doesn't fit it fails the host's call that filled it, so
 *   the wrapper of an extern returning `Future<T>` is async and gives `T`. The wrapper is the
 *   extern's one code entry, so it begins with the prologue computing the defaults a call leaves
 *   out (functions/built-entries.ts `hostExternEntry`), and a trace names the extern once.
 * - The native entry is the extern as declared, bound by its declared key, with JSON for every
 *   parameter and result, so every instantiation of a generic extern shares one native.
 * - Reading an extern constant is a call to its own wrapper, which decodes the native's value the
 *   same way; the runtime reads the native once per instance (§3.6).
 * - A failure names its path from the extern's qualified name: `purchase.chargeCard.receipt`.
 */

import type { FunctionId, Register } from '../../../../definition/operands.ts';
import type { CodeFunction, FunctionDefinition } from '../../../../definition/tables/functions.ts';
import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../../checker/check.ts';
import type { AwaitedType } from '../../../checker/types/type/function-types.ts';
import type { Type } from '../../../checker/types/type/index.ts';
import { awaitedOf, futureOf } from '../../../checker/types/type/well-known.ts';
import { entityType } from '../../../checker/types/written/named-types.ts';
import type {
  ExternConstantDeclaration,
  FunctionDeclaration,
} from '../../../syntax/declarations/index.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import { emitCall, emitFunctionCall } from '../../calls/emit-call.ts';
import type { CodeContext } from '../../context.ts';
import type { FunctionInstance } from '../../tables/instances.ts';
import { keyOf, qualifiedNameOf, spelledType } from '../../tables/names.ts';
import type { DefinitionTables, HostExternDeclaration } from '../../tables/tables.ts';
import { SynthesizedCode } from '../index.ts';
import { codecCall } from './codec-calls.ts';
import { emitInbound, inboundOf } from './inbound.ts';

/** What writing an entry here reads. */
interface Lowering {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
}

/**
 * A wrapper's call to a host native, and how it reads what the native gives: its types as
 * declared, whose codecs are closed `within` the extern's instance.
 */
export interface HostCall {
  readonly within: FunctionInstance | undefined;
  readonly native: FunctionId;
  readonly parameters: readonly Type[];
  readonly result: Type;
  /** What the host fills, when the native gives a future to fill. */
  readonly filled: Type | undefined;
  readonly path: string;
}

/** The call the wrapper of an instance of a host extern function makes to its native. */
export function hostCallOf(lowering: Lowering, instance: FunctionInstance): HostCall {
  const { checker, tables } = lowering;
  const { declaration } = instance;
  const result = checker.resultOf(declaration);
  return {
    within: instance,
    native: tables.hostNativeIndex(declaration),
    parameters: checker.parametersOf(declaration).map(({ type }) => type),
    result,
    filled: awaitedOf(checker, result)?.value,
    path: qualifiedNameOf(checker, declaration),
  };
}

/** The entry reading a host's extern constant of type `type`. */
export function hostConstantEntry(
  lowering: Lowering,
  declaration: ExternConstantDeclaration,
  type: Type,
): CodeFunction {
  const { checker, tables } = lowering;
  const code = new SynthesizedCode(lowering, declaration.name.span, 0);
  const native = code.call(tables.constantNativeIndex(declaration, type), []);
  const header = tables.declarationHeader(declaration);
  const inbound = inboundOf(checker, undefined, type, {
    from: 'result',
    path: header.name,
  });
  code.return(emitInbound(code, native, inbound, code.span));
  return code.entry(header, false);
}

/**
 * The extern function a host implements, as its native sees it: JSON in and out, bound by its key,
 * and held to its declared type across deploys.
 */
export function hostNativeEntry(
  lowering: Lowering,
  declaration: FunctionDeclaration,
): FunctionDefinition {
  const { checker } = lowering;
  const native = nativeParts(lowering, declaration);
  const result = checker.resultOf(declaration);
  return {
    ...native.header,
    key: keyOf(checker, declaration, checker.parametersOf(declaration)),
    declaredType: spelledType(checker, result),
    constant: false,
    parameters: native.jsons(checker.parametersOf(declaration).length),
    result: native.given(awaitedOf(checker, result)),
  };
}

/** The extern constant a host implements, declared of type `type`, as its native sees it. */
export function constantNativeEntry(
  lowering: Lowering,
  declaration: ExternConstantDeclaration,
  type: Type,
): FunctionDefinition {
  const { checker } = lowering;
  const native = nativeParts(lowering, declaration);
  return {
    ...native.header,
    key: qualifiedNameOf(checker, declaration),
    declaredType: spelledType(checker, type),
    constant: true,
    parameters: [],
    result: native.given(undefined),
  };
}

/** What every native of `declaration` is made of: its header, and JSON for what crosses. */
function nativeParts(lowering: Lowering, declaration: HostExternDeclaration) {
  const { checker, tables } = lowering;
  // `Json` is a recursive alias (§3.17), so it is the type its entity names, not a nominal one.
  const jsonType = entityType(checker, checker.wellKnownEntity(wellKnown.json));
  if (jsonType === undefined) {
    unreachable('A host extern was lowered in a program without the json module.');
  }
  const json = tables.types.reference(jsonType);
  return {
    header: {
      kind: 'extern' as const,
      ...tables.declarationHeader(declaration),
      typeArguments: [],
    },
    /** `count` parameters, each JSON. */
    jsons: (count: number) =>
      Array.from({ length: count }, () => ({ type: json, reference: false })),
    /**
     * What the native gives: JSON, or, where the extern gives a future (`awaited`), a future of its
     * kind the host fills with JSON.
     */
    given: (awaited: AwaitedType | undefined) =>
      awaited === undefined
        ? json
        : tables.types.reference(futureOf(checker, jsonType, awaited.mode)),
  };
}

/**
 * Writes the wrapper's `call` at `span`: `parameters` encoded, the native called, and what comes
 * back decoded, a future the host fills awaited first; the register of what the wrapper gives.
 */
export function writeHostCall(
  context: CodeContext,
  call: HostCall,
  parameters: readonly Register[],
  span: AnchoredSpan,
): Register {
  const { checker } = context;
  const { within, filled, path } = call;
  const encoded = call.parameters.map((type, index) =>
    emitFunctionCall(context, {
      span,
      call: codecCall(checker, within, type, 'write'),
      arguments: [parameters[index] ?? unreachable(`No parameter ${index}.`)],
    }),
  );
  const native = emitCall(context, { span, callee: call.native, arguments: encoded });
  if (filled === undefined) {
    const inbound = inboundOf(checker, within, call.result, { from: 'result', path });
    return emitInbound(context, native, inbound, span);
  }
  const awaited = context.code.allocate();
  context.code.await(awaited, native, span);
  return emitInbound(
    context,
    awaited,
    inboundOf(checker, within, filled, { from: 'input', path }),
    span,
  );
}
