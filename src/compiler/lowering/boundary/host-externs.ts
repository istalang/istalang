/**
 * Externs a host implements (§3.6, §9; docs/arch/boundary.md). A program calls each through a
 * compiled wrapper, the entry its instance is numbered by, so the host's native sees only JSON:
 *
 * - The wrapper encodes every argument, calls the native entry, and decodes what comes back. A
 *   result that doesn't fit is a bug in the host, so it panics the instance; a future the host
 *   fills is awaited first, and JSON that doesn't fit it fails the host's call that filled it, so
 *   the wrapper of an extern returning `Future<T>` is async and gives `T`.
 * - The native entry is the extern as declared, bound by its declared key, with JSON for every
 *   parameter and result, so every instantiation of a generic extern shares one native.
 * - An extern returning a host handle (checker/rules/host-boundary.ts) gives the JSON naming it,
 *   which the wrapper captures in a function for each of the handle's fields. Calling one calls
 *   that field's own native, keyed after the extern's (`handleFieldKey`), with the JSON first and
 *   then its arguments, the way a wrapper calls its extern's native.
 * - Reading an extern constant is a call to its own wrapper, which decodes the native's value the
 *   same way; the runtime reads the native once per instance (§3.6).
 * - A failure names its path from the extern's qualified name: `purchase.chargeCard.receipt`.
 */

import { handleFieldKey } from '../../../definition/extern-key.ts';
import type { CodeFunction, FunctionDefinition } from '../../../definition/functions.ts';
import type { FunctionId, Register } from '../../../definition/operands.ts';
import { codecHelpers, wellKnown } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import { futureArgument } from '../../checker/rules/futures.ts';
import { hostFilledOf, hostHandleOf } from '../../checker/rules/host-boundary.ts';
import { type FunctionType, substitute, type Type } from '../../checker/types/type.ts';
import type { ExternConstantDeclaration, FunctionDeclaration } from '../../syntax/declarations.ts';
import { type FunctionInstance, substitutionOf } from '../instances.ts';
import { keyOf, qualifiedNameOf, spelledType } from '../names.ts';
import type { DefinitionTables, EntryHeader, HostExternDeclaration } from '../tables.ts';
import { emitInbound, type Inbound, inboundOf } from './inbound.ts';
import { SynthesizedCode } from './synthesized-code.ts';

/** What writing an entry here reads. */
interface Lowering {
  readonly checker: Checker;
  readonly tables: DefinitionTables;
}

/** A wrapper's call to a host native, and how it reads what the native gives. */
interface HostCall {
  readonly native: FunctionId;
  /** JSON passed before the arguments: the handle's, for one of its functions. */
  readonly leading: readonly Register[];
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
  const substitution = substitutionOf(instance);
  const parameters = checker
    .parametersOf(declaration)
    .map(({ type }) => substitute(type, substitution));
  const result = substitute(checker.resultOf(declaration), substitution);
  const code = new SynthesizedCode(lowering, declaration.name.span, parameters.length);
  const native = tables.hostNativeIndex(declaration);
  const header = tables.entryHeader(instance);
  const handle = hostHandleOf(checker, result);
  if (handle === undefined) {
    return wrapped(code, header, {
      native,
      leading: [],
      parameters,
      result,
      filled: futureArgument(checker, result),
      path: qualifiedNameOf(checker, declaration),
    });
  }
  const json = code.call(native, encoded(code, parameters));
  const functions = handle.fields.map(({ name }) =>
    code.closure(tables.handleFieldIndex(instance, name), [json]),
  );
  const state = code.struct(handle.state, functions);
  code.return(code.call(checker.json.callOf(codecHelpers.hostHandle, [handle.state]), [state]));
  return code.entry(header, false);
}

/** The function field `field` of the host handle `instance` returns holds: a call to its native. */
export function handleFieldEntry(
  lowering: Lowering,
  instance: FunctionInstance,
  field: string,
): CodeFunction {
  const { checker, tables } = lowering;
  const { declaration } = instance;
  const result = substitute(checker.resultOf(declaration), substitutionOf(instance));
  const type = handleFieldOf(checker, result, field);
  const parameters = type.parameters.map((parameter) => parameter.type);
  const code = new SynthesizedCode(lowering, declaration.name.span, parameters.length, 1);
  const header = tables.entryHeader(instance);
  return wrapped(
    code,
    { ...header, name: `${header.name}.${field}` },
    {
      native: tables.handleFieldNativeIndex(declaration, field),
      leading: code.captures,
      parameters,
      result: type.result,
      filled: hostFilledOf(checker, type),
      path: `${qualifiedNameOf(checker, declaration)}.${field}`,
    },
  );
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
  code.return(
    received(code, native, inboundOf(checker, type, codecHelpers.hostResult, header.name)),
  );
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

/** The function field `field` of the host handle `declaration` returns, as its native sees it. */
export function handleFieldNativeEntry(
  lowering: Lowering,
  declaration: FunctionDeclaration,
  field: string,
): FunctionDefinition {
  const { checker } = lowering;
  const native = nativeParts(lowering, declaration);
  const function_ = handleFieldOf(checker, checker.resultOf(declaration), field);
  return {
    ...native.header,
    name: `${native.header.name}.${field}`,
    key: handleFieldKey(keyOf(checker, declaration, checker.parametersOf(declaration)), field),
    declaredType: spelledType(checker, function_),
    constant: false,
    parameters: native.jsons(1 + function_.parameters.length),
    result: native.given(hostFilledOf(checker, function_)),
  };
}

/** What every native of `declaration` is made of: its header, and JSON for what crosses. */
function nativeParts(lowering: Lowering, declaration: HostExternDeclaration) {
  const { checker, tables } = lowering;
  const jsonType = checker.wellKnownType(wellKnown.json);
  if (jsonType === undefined) {
    unreachable('A host extern was lowered in a program without the json module.');
  }
  const json = tables.typeReference(jsonType);
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
      filled === undefined || future === undefined ? json : tables.typeReference(future),
  };
}

/** `code` finished as a wrapper making `call`: arguments encoded, what comes back decoded. */
function wrapped(code: SynthesizedCode, header: EntryHeader, call: HostCall): CodeFunction {
  const { checker } = code;
  const native = code.call(call.native, [...call.leading, ...encoded(code, call.parameters)]);
  const { filled, path } = call;
  code.return(
    filled === undefined
      ? received(code, native, inboundOf(checker, call.result, codecHelpers.hostResult, path))
      : received(
          code,
          code.await(native),
          inboundOf(checker, filled, codecHelpers.hostInput, path),
        ),
  );
  return code.entry(header, filled !== undefined);
}

/** `code`'s parameters, of `types`, each encoded as JSON. */
function encoded(code: SynthesizedCode, types: readonly Type[]): readonly Register[] {
  return types.map((type, index) =>
    code.call(code.checker.json.encoderOf(type), [registerAt(code.parameters, index)]),
  );
}

/** The type of field `field` of the host handle `type`, which the checker let through as one. */
function handleFieldOf(checker: Checker, type: Type, field: string): FunctionType {
  const found = hostHandleOf(checker, type)?.fields.find(({ name }) => name === field);
  if (found === undefined) {
    unreachable(`No host handle with a function '${field}' was returned.`);
  }
  return found.type;
}

/** What the JSON in `json` holds, read as `inbound` says. */
function received(code: SynthesizedCode, json: Register, inbound: Inbound): Register {
  return emitInbound(code, { json, path: code.constant(inbound.path) }, inbound, code.span);
}

function registerAt(registers: readonly Register[], index: number): Register {
  const register = registers[index];
  if (register === undefined) {
    unreachable(`No parameter ${index}.`);
  }
  return register;
}
