/**
 * The top-level functions a module declares: those written in it, and those each of its handle
 * declarations declares (§3.18), which every phase reads as it reads a written one.
 *
 * A handle `H<T…>` of `S` declares `H.from(value: S) -> H<T…>`, `unwrap(self: H<T…>) -> S` and
 * `rewrap(self: H<T…>, value: S)`, the functions `H(v)`, `x$` and `x$ = v` call (§3.9), as extern
 * declarations made once per handle from its own nodes: its type parameters, its state's type, and
 * `H<T…>`, a type node naming the handle with its parameters (`selfType`), which the binder binds
 * where the handle's parameters are visible. Being declarations, they are found, chosen, and meet
 * traits in generic code exactly as written functions are, with no rule of their own anywhere. A
 * handle is a cell, so their natives are the runtime's cells.
 */

import { conversionFunction, rewrapFunction, unwrapFunction } from '../../language/well-known.ts';
import { memo } from '../../structures/memo.ts';
import type { Span } from '../../text/span.ts';
import type { FunctionDeclaration, HandleDeclaration, Module } from './declarations.ts';
import type { Parameter } from './expressions.ts';
import type { Identifier } from './node.ts';
import type { NamedType, TypeNode } from './types.ts';

/** What a handle declares: the type node naming it, and its three functions. */
export interface HandleFunctions {
  readonly selfType: NamedType;
  readonly from: FunctionDeclaration;
  readonly unwrap: FunctionDeclaration;
  readonly rewrap: FunctionDeclaration;
}

/** Which of its handle's functions a function is. */
type HandleRole = Exclude<keyof HandleFunctions, 'selfType'>;

/** Where a function a handle declares comes from. */
interface HandleOrigin {
  readonly handle: HandleDeclaration;
  readonly role: HandleRole;
}

const handleRoles = ['from', 'unwrap', 'rewrap'] as const satisfies readonly HandleRole[];

const declared = new WeakMap<HandleDeclaration, HandleFunctions>();

const origins = new WeakMap<FunctionDeclaration, HandleOrigin>();

/** The top-level functions `module` declares, static ones included, in source order. */
export function declaredFunctions(module: Module): readonly FunctionDeclaration[] {
  return module.items.flatMap((item) => {
    switch (item.kind) {
      case 'FunctionDeclaration':
        return [item];
      case 'HandleDeclaration':
        return handleFunctionList(item);
      default:
        return [];
    }
  });
}

/** The functions `handle` declares, in the order its declaration reads them. */
export function handleFunctionList(handle: HandleDeclaration): readonly FunctionDeclaration[] {
  const functions = handleFunctionsOf(handle);
  return handleRoles.map((role) => functions[role]);
}

/** The functions `handle` declares (§3.18). */
export function handleFunctionsOf(handle: HandleDeclaration): HandleFunctions {
  return memo(declared, handle, () => {
    const { state } = handle;
    const selfType = selfTypeOf(handle);
    const [owner] = selfType.path;
    const self = parameter(handle, 'self', selfType);
    const value = parameter(handle, 'value', state);
    const functions: HandleFunctions = {
      selfType,
      from: extern(handle, {
        owner,
        name: conversionFunction,
        parameters: [value],
        result: selfType,
      }),
      unwrap: extern(handle, { name: unwrapFunction, parameters: [self], result: state }),
      rewrap: extern(handle, { name: rewrapFunction, parameters: [self, value] }),
    };
    for (const role of handleRoles) {
      origins.set(functions[role], { handle, role });
    }
    return functions;
  });
}

/** The handle declaring `declaration` and which of its functions it is; undefined for any other. */
export function handleFunctionOf(declaration: FunctionDeclaration): HandleOrigin | undefined {
  return origins.get(declaration);
}

/** `H<T…>`: the handle's name with its type parameters as arguments. */
function selfTypeOf(handle: HandleDeclaration): NamedType {
  const { span } = handle.name;
  const typeArguments = handle.typeParameters.flatMap((typeParameter): NamedType[] =>
    typeParameter.kind === 'TypeParameter'
      ? [
          {
            kind: 'NamedType',
            span,
            path: [nameAt(span, typeParameter.name.text)],
            typeArguments: [],
          },
        ]
      : [],
  );
  return { kind: 'NamedType', span, path: [nameAt(span, handle.name.text)], typeArguments };
}

function parameter(handle: HandleDeclaration, name: string, type: TypeNode): Parameter {
  const { span } = handle.name;
  return {
    kind: 'Parameter',
    span,
    isRest: false,
    name: nameAt(span, name),
    type,
    defaultValue: undefined,
  };
}

/** What sets one of a handle's functions apart from the others. */
interface Signature {
  readonly owner?: Identifier;
  readonly name: string;
  readonly parameters: readonly Parameter[];
  readonly result?: TypeNode;
}

function extern(handle: HandleDeclaration, signature: Signature): FunctionDeclaration {
  return {
    kind: 'FunctionDeclaration',
    span: handle.span,
    annotations: [],
    isExtern: true,
    isAsync: false,
    owner: signature.owner,
    name: nameAt(handle.name.span, signature.name),
    typeParameters: handle.typeParameters,
    parameters: signature.parameters,
    returnType: signature.result,
    body: undefined,
  };
}

function nameAt(span: Span, text: string): Identifier {
  return { kind: 'Identifier', span, text };
}
