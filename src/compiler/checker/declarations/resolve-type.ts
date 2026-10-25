/**
 * The type a type node denotes (§2, §3.5, §3.17): names resolve through the binder, and the type
 * node kinds each have a handler.
 *
 * - A generic declaration's missing trailing type arguments take their declared defaults (§3.5),
 *   whatever the declaration: a struct, enum, trait, alias or function. A default is written in
 *   the declaring module and may name the parameters before it (and, in a trait, `Self`), so it is
 *   resolved there and then substituted. This module is the one place that fills them.
 * - Every argument given for a constrained parameter must meet its constraints. Meeting one looks
 *   at function signatures, which may still be resolving their own types, so the check is noted
 *   here and runs when its module is checked (`constrainLater`). A type node resolves once
 *   (the checker memoizes `resolveType` per node), and its module's own check resolves every type
 *   node it has, defaults of type parameters included, so every check is noted by then, whichever
 *   module asked first.
 * - An alias is the type it stands for, its own parameters replaced by the arguments (§3.17).
 * - `T?` is the prelude's `Optional<T>` (§2), and `Self` inside a trait is the trait's implicit
 *   parameter (types/type.ts).
 * - `&T` is only ever a parameter's type (the parser enforces it); here it denotes `T`, and the
 *   signature records the reference.
 * - A `{…}` type is an anonymous struct, a type of its own (§3.1), whose fields resolve here.
 * - Traits are constraints, never types (§3.10).
 */

import { wellKnown } from '../../../language/well-known.ts';
import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import type { Span } from '../../../text/span.ts';
import type { ModuleId } from '../../program/program.ts';
import type {
  FunctionDeclaration,
  TraitDeclaration,
  TypeAliasDeclaration,
  TypeParameter,
  TypeParameters,
} from '../../syntax/declarations.ts';
import { lastName } from '../../syntax/node.ts';
import type { FunctionType as FunctionTypeNode, NamedType, TypeNode } from '../../syntax/types.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import {
  errorType,
  type NominalDeclaration,
  nominalType,
  type ParameterKey,
  primitiveType,
  substitute,
  type Type,
  unitType,
} from '../types/type.ts';
import { declaredFields } from './signatures.ts';

interface Resolution {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
}

/** A declaration that takes type parameters. */
export type GenericDeclaration =
  | NominalDeclaration
  | TraitDeclaration
  | TypeAliasDeclaration
  | FunctionDeclaration;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const typeHandlers: Handlers<Resolution, TypeNode, [], Type> = {
  NamedType: (resolution, node) => namedType(resolution, node),
  OptionalType: (resolution, node) =>
    resolution.checker.wellKnownType(wellKnown.optional, [resolve(resolution, node.inner)]) ??
    errorType,
  ParenthesizedType: (resolution, node) => resolve(resolution, node.inner),
  ReferenceType: (resolution, node) => resolve(resolution, node.referent),
  TupleType: (resolution, node) => ({
    kind: 'tuple',
    elements: node.elements.map((element) => resolve(resolution, element)),
  }),
  FunctionType: (resolution, node) => functionType(resolution, node),
  StructType: ({ checker, module }, node) => ({
    kind: 'anonymous',
    origin: node,
    fields: declaredFields(checker, module, node.fields),
  }),
  Missing: () => errorType,
  Invalid: () => errorType,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/**
 * The type `node` denotes in `module`, resolved afresh: the checker's `resolveType` memoizes it,
 * and is what everything else calls.
 */
export function resolveTypeNode(checker: CheckerContext, module: ModuleId, node: TypeNode): Type {
  return handlerOf(typeHandlers, node)({ checker, module }, node);
}

/** The type parameters a declaration introduces, leaving out what the parser couldn't read. */
export function typeParametersOf(parameters: TypeParameters): readonly TypeParameter[] {
  return parameters.filter((parameter) => parameter.kind === 'TypeParameter');
}

/** The type a type parameter (or a trait's `Self`) stands for inside its declaration. */
export function parameterType(declaration: ParameterKey): Type {
  return { kind: 'parameter', declaration };
}

/** Type arguments given a generic declaration at `at`; `self` is what a trait's `Self` stands for. */
export interface ArgumentList {
  readonly at: Span;
  readonly declaration: GenericDeclaration;
  readonly types: readonly Type[];
  readonly self?: Type;
}

/**
 * The arguments for every type parameter of the list's declaration: the written ones, then the
 * defaults of the ones left out. Undefined after reporting that too few or too many were written.
 */
export function typeArgumentsFor(
  checker: CheckerContext,
  module: ModuleId,
  { at, declaration, types: written, self }: ArgumentList,
): readonly Type[] | undefined {
  const parameters = typeParametersOf(declaration.typeParameters);
  const required = parameters.filter((parameter) => parameter.defaultType === undefined).length;
  if (written.length < required || written.length > parameters.length) {
    const expected = written.length < required ? required : parameters.length;
    checker.report(
      module,
      checkerDiagnostics.typeArgumentCount(at, declaration.name.text, expected, written.length),
    );
    return undefined;
  }
  const substitution = new Map<ParameterKey, Type>();
  if (self !== undefined && declaration.kind === 'TraitDeclaration') {
    substitution.set(declaration, self);
  }
  return parameters.map((parameter, index) => {
    const argument =
      written[index] ?? defaultArgument(checker, declaration, parameter, substitution);
    substitution.set(parameter, argument);
    return argument;
  });
}

/**
 * The default of `parameter`, resolved where `declaration` is written, with the parameters
 * before it (and `Self`) as `earlier` maps them; the error type when it has none.
 */
export function defaultArgument(
  checker: CheckerContext,
  declaration: GenericDeclaration,
  parameter: TypeParameter,
  earlier: ReadonlyMap<ParameterKey, Type>,
): Type {
  if (parameter.defaultType === undefined) {
    return errorType;
  }
  return substitute(
    checker.resolveType(checker.moduleOf(declaration), parameter.defaultType),
    earlier,
  );
}

function resolve({ checker, module }: Resolution, node: TypeNode): Type {
  return checker.resolveType(module, node);
}

function functionType(resolution: Resolution, node: FunctionTypeNode): Type {
  return {
    kind: 'function',
    isAsync: node.isAsync,
    parameters: node.parameters.map((parameter) => ({
      type: resolve(resolution, parameter),
      reference: parameter.kind === 'ReferenceType',
    })),
    result: node.returnType === undefined ? unitType : resolve(resolution, node.returnType),
  };
}

function namedType(resolution: Resolution, node: NamedType): Type {
  const { checker, module } = resolution;
  const name = lastName(node.path);
  const entity = checker.bindings.entityOf(module, name);
  switch (entity?.kind) {
    case undefined:
      return errorType;
    case 'primitive':
      return primitiveType(entity.name);
    case 'self':
      return parameterType(entity.trait);
    case 'type': {
      const { declaration } = entity;
      switch (declaration.kind) {
        case 'TypeParameter':
          return parameterType(declaration);
        case 'StructDeclaration':
        case 'EnumDeclaration':
        case 'ExternStructDeclaration': {
          const typeArguments = argumentsOf(resolution, node, declaration);
          return typeArguments === undefined ? errorType : nominalType(entity, typeArguments);
        }
        case 'TypeAliasDeclaration': {
          const typeArguments = argumentsOf(resolution, node, declaration);
          return typeArguments === undefined
            ? errorType
            : substitute(
                checker.aliasedType(declaration),
                new Map(
                  typeParametersOf(declaration.typeParameters).map(
                    (parameter, index) => [parameter, typeArguments[index] ?? errorType] as const,
                  ),
                ),
              );
        }
        case 'TraitDeclaration':
          checker.report(module, checkerDiagnostics.notType(node.span, name.text));
          return errorType;
        default: {
          const unhandled: never = declaration;
          return unhandled;
        }
      }
    }
    default:
      checker.report(module, checkerDiagnostics.notType(node.span, name.text));
      return errorType;
  }
}

/** The written and default arguments of a named type, each noted for its parameter's constraints. */
function argumentsOf(
  resolution: Resolution,
  node: NamedType,
  declaration: NominalDeclaration | TypeAliasDeclaration,
): readonly Type[] | undefined {
  const { checker, module } = resolution;
  const written = node.typeArguments.map((argument) => resolve(resolution, argument));
  const list = { at: node.span, declaration, types: written };
  const typeArguments = typeArgumentsFor(checker, module, list);
  if (typeArguments !== undefined) {
    constrainArguments(checker, module, { ...list, types: typeArguments });
  }
  return typeArguments;
}

/** Notes every argument of a constrained parameter in a complete list for its constraints. */
export function constrainArguments(
  checker: CheckerContext,
  module: ModuleId,
  { at, declaration, types: typeArguments }: ArgumentList,
): void {
  const parameters = typeParametersOf(declaration.typeParameters);
  const substitution = new Map<ParameterKey, Type>(
    parameters.map((parameter, index) => [parameter, typeArguments[index] ?? errorType] as const),
  );
  for (const parameter of parameters.filter((each) => each.constraints.length > 0)) {
    checker.constrainLater(module, at, parameter, substitution);
  }
}
