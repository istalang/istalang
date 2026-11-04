/**
 * Externs a host implements (§3.6, §9; docs/arch/boundary.md). A program calls each through a
 * compiled wrapper, the entry its instance is numbered by, so the host's native sees only JSON:
 *
 * - The wrapper encodes every argument, calls the native entry, and decodes what comes back, each
 *   by its declared type's codec, closed within the wrapper's instance (codec-calls.ts). A
 *   result that doesn't fit is a bug in the host, so it panics the instance; a future the host
 *   fills is awaited first, and JSON that doesn't fit it fails the host's call that filled it, so
 *   the wrapper of an extern returning `Future<T>` is async and gives `T`.
 * - The native entry is the extern as declared, bound by its declared key, with JSON for every
 *   parameter and result, so every instantiation of a generic extern shares one native.
 * - Reading an extern constant is a call to its own wrapper, which decodes the native's value the
 *   same way; the runtime reads the native once per instance (§3.6).
 * - A failure names its path from the extern's qualified name: `purchase.chargeCard.receipt`.
 */

import type { CodeFunction, FunctionDefinition } from '../../../definition/functions.ts';
import type { FunctionId, Register } from '../../../definition/operands.ts';
import { wellKnown } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import type { Type } from '../../checker/types/type.ts';
import { futureArgument } from '../../checker/types/well-known.ts';
import type { ExternConstantDeclaration, FunctionDeclaration } from '../../syntax/declarations.ts';
import type { FunctionInstance } from '../instances.ts';
import { keyOf, qualifiedNameOf, spelledType } from '../names.ts';
import { SynthesizedCode } from '../synthesized-code.ts';
import type { DefinitionTables, EntryHeader, HostExternDeclaration } from '../tables.ts';
import { codecCall } from './codec-calls.ts';
import { emitInbound, type Inbound, inboundOf } from './inbound.ts';

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
  /** What the host fills, when the native gives a future to fill. */
  readonly filled: Type | undefined;
  readonly path: string;
}

/** The wrapper of an instance of a host extern function. */
export function hostFunctionEntry(lowering: Lowering, instance: FunctionInstance): CodeFunction {
  const { checker, tables } = lowering;
  const { declaration } = instance;
  const parameters = checker.parametersOf(declaration).map(({ type }) => type);
  const result = checker.resultOf(declaration);
  const code = new SynthesizedCode(lowering, declaration.name.span, parameters.length);
  return wrapped(code, tables.entryHeader(instance), {
    within: instance,
    native: tables.hostNativeIndex(declaration),
    parameters,
    result,
    filled: futureArgument(checker, result),
    path: qualifiedNameOf(checker, declaration),
  });
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
  code.return(received(code, native, inbound));
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
    result: native.given(futureArgument(checker, result)),
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
  const jsonType = checker.wellKnownType(wellKnown.json);
  if (jsonType === undefined) {
    unreachable('A host extern was lowered in a program without the json module.');
  }
  const json = tables.types.reference(jsonType);
  const future = checker.wellKnownType(wellKnown.future, [jsonType]);
  return {
    header: {
      kind: 'extern' as const,
      ...tables.declarationHeader(declaration),
      typeArguments: [],
    },
    /** `count` parameters, each JSON. */
    jsons: (count: number) =>
      Array.from({ length: count }, () => ({ type: json, reference: false })),
    /** What the native gives: JSON, or a future the host fills with JSON when it fills `filled`. */
    given: (filled: Type | undefined) =>
      filled === undefined || future === undefined ? json : tables.types.reference(future),
  };
}

/** `code` finished as a wrapper making `call`: arguments encoded, what comes back decoded. */
function wrapped(code: SynthesizedCode, header: EntryHeader, call: HostCall): CodeFunction {
  const { checker } = code;
  const { within, filled, path } = call;
  const native = code.call(call.native, encoded(code, within, call.parameters));
  code.return(
    filled === undefined
      ? received(code, native, inboundOf(checker, within, call.result, { from: 'result', path }))
      : received(
          code,
          code.await(native),
          inboundOf(checker, within, filled, { from: 'input', path }),
        ),
  );
  return code.entry(header, filled !== undefined);
}

/** `code`'s parameters, of `types`, each encoded as JSON by its codec, closed `within`. */
function encoded(
  code: SynthesizedCode,
  within: FunctionInstance | undefined,
  types: readonly Type[],
): readonly Register[] {
  return types.map((type, index) =>
    code.call(codecCall(code.checker, within, type, 'write'), [registerAt(code.parameters, index)]),
  );
}

/** What the JSON in `json` holds, read as `inbound` says. */
function received(code: SynthesizedCode, json: Register, inbound: Inbound): Register {
  return emitInbound(code, json, inbound, code.span);
}

function registerAt(registers: readonly Register[], index: number): Register {
  const register = registers[index];
  if (register === undefined) {
    unreachable(`No parameter ${index}.`);
  }
  return register;
}
