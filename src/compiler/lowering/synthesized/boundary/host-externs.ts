/**
 * Externs a host implements (§3.6, §9; docs/arch/boundary.md). A program calls each through a
 * compiled wrapper, the entry its instance is numbered by, so the host's native sees only JSON:
 *
 * - The wrapper encodes every argument, calls the native entry, and decodes what comes back, each
 *   by its declared type's codec, closed within the wrapper's instance (codec-calls.ts). A
 *   result that doesn't fit is a bug in the host, so it panics the code calling it, and so is
 *   what a future the host resolves gives, which is awaited first, so the wrapper of an extern
 *   returning `Future<T>` is async and gives `T`. The wrapper is the
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
import type { TypeReference } from '../../../../definition/tables/types.ts';
import { hostFutureFunction } from '../../../../foundation/language/well-known/implicit-calls.ts';
import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../../checker/check.ts';
import { type FunctionInstance, substitutionOf } from '../../../checker/surface/witness-closing.ts';
import { substitute } from '../../../checker/types/parts/substitution.ts';
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
import { awaitFuture } from '../../calls/waits.ts';
import type { CodeContext } from '../../context.ts';
import type { HostExternDeclaration } from '../../tables/entries.ts';
import { declaredTypeOf, keyOf } from '../../tables/extern-keys.ts';
import { rootInstance } from '../../tables/instances.ts';
import { qualifiedNameOf } from '../../tables/names.ts';
import type { DefinitionTables } from '../../tables/tables.ts';
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
interface HostCall {
  readonly within: FunctionInstance | undefined;
  readonly native: FunctionId;
  readonly parameters: readonly Type[];
  readonly result: Type;
  /**
   * What the extern's future gives, and its kind, in its instance, when the native gives a future to
   * fill.
   */
  readonly awaited: AwaitedType | undefined;
  readonly path: string;
}

/** The call the wrapper of an instance of a host extern function makes to its native. */
export function hostCallOf(lowering: Lowering, instance: FunctionInstance): HostCall {
  const { checker, tables } = lowering;
  const { declaration } = instance;
  const result = checker.resultOf(declaration);
  return {
    within: instance,
    native: tables.index({ kind: 'hostNative', declaration }),
    parameters: checker.parametersOf(declaration).map(({ type }) => type),
    result,
    awaited: awaitedOf(checker, substitute(result, substitutionOf(instance), checker.typeRules)),
    path: qualifiedNameOf(checker, declaration),
  };
}

/**
 * The entry reading a host's extern constant of type `type`: read from the host once per instance,
 * then kept as the instance's, across its commits (§3.6), as a context constant is (§3.4).
 */
export function hostConstantEntry(
  lowering: Lowering,
  declaration: ExternConstantDeclaration,
  type: Type,
): CodeFunction {
  const { checker, tables } = lowering;
  const code = new SynthesizedCode(lowering, declaration.name.span, {
    parameters: [],
    result: tables.types.reference(type),
    mode: 'simple',
  });
  const header = tables.declarationHeader(declaration);
  const { span } = code;
  const name = `extern ${header.name}`;
  const value = code.code.allocate(tables.types.reference(type));
  const kept = code.code.newLabel();
  code.code.contextConstant(value, name, kept, span);
  const native = code.call(
    tables.index({ kind: 'constantNative', declaration, type }),
    [],
    jsonOf(checker),
  );
  const inbound = inboundOf(checker, undefined, type, {
    from: 'result',
    path: header.name,
  });
  const read = emitInbound(code, native, inbound, span);
  const taken = code.code.take(read, span);
  code.code.letGo([value], span);
  code.code.emit({ kind: 'move', span, dst: value, src: taken });
  code.code.emit({ kind: 'makeContextConstant', span, name, value });
  code.code.place(kept);
  code.return(value);
  return code.entry(header);
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
  const awaited = awaitedOf(checker, result);
  return {
    ...native.header,
    key: keyOf(checker, declaration, checker.parametersOf(declaration)),
    host: { declaredType: declaredTypeOf(checker, result) },
    constant: false,
    parameters: [
      ...native.jsons(checker.parametersOf(declaration).length),
      ...(awaited === undefined ? [] : [{ type: native.filling(awaited) }]),
    ],
    result: awaited === undefined ? native.json : { kind: 'primitive', name: 'Unit' },
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
    host: { declaredType: declaredTypeOf(checker, type) },
    constant: true,
    parameters: [],
    result: native.json,
  };
}

/**
 * `Json`, what crosses to a host. It is a recursive alias (§3.17), so it is the type its entity
 * names, not a nominal one.
 */
export function jsonOf(checker: Checker): Type {
  const jsonType = entityType(checker, checker.wellKnownEntity(wellKnown.json));
  if (jsonType === undefined) {
    unreachable('A host extern was lowered in a program without the json module.');
  }
  return jsonType;
}

/** What every native of `declaration` is made of: its header, and JSON for what crosses. */
function nativeParts(lowering: Lowering, declaration: HostExternDeclaration) {
  const { checker, tables } = lowering;
  const jsonType = jsonOf(checker);
  const json = tables.types.reference(jsonType);
  return {
    header: {
      kind: 'extern' as const,
      ...tables.declarationHeader(declaration),
    },
    json,
    /** `count` parameters, each JSON. */
    jsons: (count: number) => Array.from({ length: count }, () => ({ type: json })),
    /** The pending future, of `awaited`'s kind, the host fills with JSON. */
    filling: (awaited: AwaitedType): TypeReference =>
      tables.types.reference(futureOf(checker, jsonType, awaited.mode)),
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
  const { checker, tables, code } = context;
  const { within, awaited, path } = call;
  const json = jsonOf(checker);
  const encoded = call.parameters.map((type, index) =>
    emitFunctionCall(context, {
      span,
      call: codecCall(checker, within, type, 'write'),
      arguments: [parameters[index] ?? unreachable(`No parameter ${index}.`)],
    }),
  );
  if (awaited === undefined) {
    const native = emitCall(
      context,
      { span, callee: call.native, arguments: encoded },
      tables.types.reference(json),
    );
    const inbound = inboundOf(checker, within, call.result, { from: 'result', path });
    return emitInbound(context, native, inbound, span);
  }
  const futureType = futureOf(checker, json, awaited.mode);
  const [declaration] = checker.languageFunctions('prelude', hostFutureFunction);
  if (declaration === undefined) {
    return unreachable(`The prelude declares no '${hostFutureFunction}'.`);
  }
  const instance = rootInstance(checker, declaration, [json, awaited.mode]);
  const unit = { kind: 'primitive', name: 'Unit' } as const;
  const future = emitCall(
    context,
    { span, callee: tables.index({ kind: 'instance', instance }), arguments: [] },
    tables.types.reference(futureType),
  );
  code.pin(future);
  code.letGo(
    [emitCall(context, { span, callee: call.native, arguments: [...encoded, future] }, unit)],
    span,
  );
  const filled = awaitFuture(
    context,
    { future, type: futureType, mode: context.waitingMode() },
    span,
  );
  code.letGo([future], span);
  return emitInbound(
    context,
    filled,
    inboundOf(checker, within, awaited.value, { from: 'result', path }),
    span,
  );
}
