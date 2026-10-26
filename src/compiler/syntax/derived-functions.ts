/**
 * Function declarations derived from declarations of other kinds, which every phase reads as it
 * reads a written one, so they need no rule of their own where they are found, chosen, checked or
 * lowered. Each is made once from its declaration's own nodes, through one builder, and remembers
 * where it comes from (`originOf`):
 *
 * - A handle `H<T…>` of `S` (§3.18) declares `H.from(value: S) -> H<T…>`,
 *   `unwrap(self: H<T…>) -> S` and `rewrap(self: H<T…>, value: S)`, the functions `H(v)`, `x$` and
 *   `x$ = v` call (§3.9), as externs: their types are its type parameters, its state's type and
 *   `H<T…>`, a type node naming the handle (`selfType`), which the binder binds where the handle's
 *   parameters are visible. A handle is a cell, so their natives are the runtime's cells. They are
 *   a module's own functions, found by name (`declaredFunctions`).
 * - The fields of a struct or a variant, when one has a default (§3.1), read as the parameters of a
 *   function of their own, each with its type and default, so a field's default is taken as a
 *   parameter's (§3.3): it sees the fields before it, a field without a written type takes its
 *   default's, and a default reaching its own field is a cycle. Its parameters are the fields in
 *   order, so a layout's field `i` is its parameter `i`. It is called by no name: a literal leaving field `i` out calls its entry of arity
 *   `i`, which gives that field's value from the fields before it.
 */

import { conversionFunction, rewrapFunction, unwrapFunction } from '../../language/well-known.ts';
import { memo } from '../../structures/memo.ts';
import type { Span } from '../../text/span.ts';
import type {
  Declaration,
  DeclaredField,
  EnumDeclaration,
  FunctionDeclaration,
  HandleDeclaration,
  Module,
  StructDeclaration,
  TypeParameters,
  Variant,
} from './declarations.ts';
import type { Parameter } from './expressions.ts';
import type { Identifier, Invalid } from './node.ts';
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

/** A declaration whose fields may have defaults: a struct, or one variant of an enum. */
type FieldsOwner = StructDeclaration | Variant;

/** The declaration a derived function comes from, and what it is there. */
export type DerivedOrigin =
  | { readonly kind: 'handle'; readonly handle: HandleDeclaration; readonly role: HandleRole }
  | { readonly kind: 'fields'; readonly owner: FieldsOwner };

const handleRoles = ['from', 'unwrap', 'rewrap'] as const satisfies readonly HandleRole[];

const handles = new WeakMap<HandleDeclaration, HandleFunctions>();

const fieldsFunctions = new WeakMap<FieldsOwner, FunctionDeclaration | undefined>();

const origins = new WeakMap<FunctionDeclaration, DerivedOrigin>();

/** The top-level functions `module` declares, found by name: written ones, and its handles'. */
export function declaredFunctions(module: Module): readonly FunctionDeclaration[] {
  return module.items.flatMap((item) => {
    switch (item.kind) {
      case 'FunctionDeclaration':
        return [item];
      case 'HandleDeclaration':
        return derivedFunctionsOf(item);
      default:
        return [];
    }
  });
}

/** Every function `item` derives: a handle's, or those a struct's or variants' fields read as. */
export function derivedFunctionsOf(item: Declaration): readonly FunctionDeclaration[] {
  switch (item.kind) {
    case 'HandleDeclaration': {
      const functions = handleFunctionsOf(item);
      return handleRoles.map((role) => functions[role]);
    }
    case 'StructDeclaration':
      return present(fieldsFunctionOf(item));
    case 'EnumDeclaration':
      return item.variants.flatMap((variant) =>
        variant.kind === 'Variant' ? present(fieldsFunctionOf(item, variant)) : [],
      );
    default:
      return [];
  }
}

/** Where `declaration` comes from, when it is derived; undefined for a written function. */
export function originOf(declaration: FunctionDeclaration): DerivedOrigin | undefined {
  return origins.get(declaration);
}

/** The functions `handle` declares (§3.18). */
export function handleFunctionsOf(handle: HandleDeclaration): HandleFunctions {
  return memo(handles, handle, () => {
    const { name, state, typeParameters } = handle;
    const selfType = selfTypeOf(handle);
    const [owner] = selfType.path;
    const self = parameter(name.span, nameAt(name.span, 'self'), selfType);
    const value = parameter(name.span, nameAt(name.span, 'value'), state);
    const extern = (role: HandleRole, signature: Omit<Signature, 'isExtern' | 'typeParameters'>) =>
      derive({ kind: 'handle', handle, role }, { ...signature, isExtern: true, typeParameters });
    return {
      selfType,
      from: extern('from', {
        owner,
        name: conversionFunction,
        parameters: [value],
        result: selfType,
      }),
      unwrap: extern('unwrap', { name: unwrapFunction, parameters: [self], result: state }),
      rewrap: extern('rewrap', { name: rewrapFunction, parameters: [self, value] }),
    };
  });
}

/**
 * The function whose parameters are the fields of a struct, or of an enum's `variant` (§3.1);
 * undefined when none of them has a default.
 */
export function fieldsFunctionOf(declaration: StructDeclaration): FunctionDeclaration | undefined;
export function fieldsFunctionOf(
  declaration: EnumDeclaration,
  variant: Variant,
): FunctionDeclaration | undefined;
export function fieldsFunctionOf(
  declaration: StructDeclaration | EnumDeclaration,
  variant?: Variant,
): FunctionDeclaration | undefined {
  const owner = declaration.kind === 'StructDeclaration' ? declaration : variant;
  if (owner === undefined) {
    return undefined;
  }
  return memo(fieldsFunctions, owner, () => {
    const hasDefault = owner.fields.some(
      (field) => field.kind === 'FieldDeclaration' && field.defaultValue !== undefined,
    );
    if (!hasDefault) {
      return;
    }
    return derive(
      { kind: 'fields', owner },
      {
        isExtern: false,
        name: owner.name,
        typeParameters: declaration.typeParameters,
        parameters: owner.fields.map(fieldParameter),
      },
    );
  });
}

/** What sets a derived function apart from the others. */
interface Signature {
  readonly isExtern: boolean;
  readonly owner?: Identifier;
  readonly name: string | Identifier;
  readonly typeParameters: TypeParameters;
  readonly parameters: readonly (Parameter | Invalid)[];
  readonly result?: TypeNode;
}

/** The one builder of a derived function, which notes where it comes from. */
function derive(origin: DerivedOrigin, signature: Signature): FunctionDeclaration {
  const source = origin.kind === 'handle' ? origin.handle : origin.owner;
  const { name } = signature;
  const declared: FunctionDeclaration = {
    kind: 'FunctionDeclaration',
    span: source.span,
    annotations: [],
    isExtern: signature.isExtern,
    isAsync: false,
    owner: signature.owner,
    name: typeof name === 'string' ? nameAt(source.name.span, name) : name,
    typeParameters: signature.typeParameters,
    parameters: signature.parameters,
    returnType: signature.result,
    body: undefined,
  };
  origins.set(declared, origin);
  return declared;
}

/** `H<T…>`: the handle's name with its type parameters as arguments. */
function selfTypeOf(handle: HandleDeclaration): NamedType {
  const { span } = handle.name;
  const named = (text: string): NamedType => ({
    kind: 'NamedType',
    span,
    path: [nameAt(span, text)],
    typeArguments: [],
  });
  const typeArguments = handle.typeParameters.flatMap((typeParameter) =>
    typeParameter.kind === 'TypeParameter' ? [named(typeParameter.name.text)] : [],
  );
  return { ...named(handle.name.text), typeArguments };
}

/** The parameter a field reads as. */
function fieldParameter(field: DeclaredField | Invalid): Parameter | Invalid {
  return field.kind === 'Invalid'
    ? field
    : parameter(field.span, field.name, field.type, field.defaultValue);
}

function parameter(
  span: Span,
  name: Identifier,
  type: TypeNode | undefined,
  defaultValue?: Parameter['defaultValue'],
): Parameter {
  return { kind: 'Parameter', span, isRest: false, name, type, defaultValue };
}

function nameAt(span: Span, text: string): Identifier {
  return { kind: 'Identifier', span, text };
}

function present<T>(value: T | undefined): readonly T[] {
  return value === undefined ? [] : [value];
}
