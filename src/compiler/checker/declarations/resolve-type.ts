/**
 * The type a type node denotes (§2, §3.5): names resolve through the binder, and the type node
 * kinds each have a handler.
 *
 * - A generic type's missing trailing arguments take their declared defaults (§3.11:
 *   `Result<T, E = Error>`). A default is written in the declaring module and may name the
 *   parameters before it, so it is resolved there and then substituted.
 * - `T?` is the prelude's `Optional<T>` (§2).
 * - `&T` is only ever a parameter's type (the parser enforces it); here it denotes `T`, and the
 *   signature records the reference.
 * - Traits are constraints, never types (§3.10).
 */

import type { ModuleId } from '../../program/program.ts';
import type { TypeParameter } from '../../syntax/declarations.ts';
import { type Handlers, handlerOf } from '../../syntax/handlers.ts';
import type { FunctionType as FunctionTypeNode, NamedType, TypeNode } from '../../syntax/types.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import {
  errorType,
  type NominalDeclaration,
  type NominalType,
  primitiveType,
  substitute,
  type Type,
  type TypeParameterType,
  unitType,
} from '../types/type.ts';

interface Resolution {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const typeHandlers: Handlers<Resolution, TypeNode, [], Type> = {
  NamedType: (resolution, node) => namedType(resolution, node),
  OptionalType: (resolution, node) =>
    resolution.checker.preludeType('Optional', [resolve(resolution, node.inner)]),
  ParenthesizedType: (resolution, node) => resolve(resolution, node.inner),
  ReferenceType: (resolution, node) => resolve(resolution, node.referent),
  TupleType: (resolution, node) => ({
    kind: 'tuple',
    elements: node.elements.map((element) => resolve(resolution, element)),
  }),
  FunctionType: (resolution, node) => functionType(resolution, node),
  StructType: (resolution, node) => resolution.checker.unsupported(resolution.module, node),
  Missing: () => errorType,
  Invalid: () => errorType,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** The type `node` denotes in `module`. */
export function resolveTypeNode(checker: CheckerContext, module: ModuleId, node: TypeNode): Type {
  return resolve({ checker, module }, node);
}

function resolve(resolution: Resolution, node: TypeNode): Type {
  return handlerOf(typeHandlers, node)(resolution, node);
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
  const name = node.path.at(-1) ?? node.path[0];
  const entity = checker.bindings.entityOf(module, name);
  switch (entity?.kind) {
    case undefined:
      return errorType;
    case 'primitive':
      return primitiveType(entity.name);
    case 'type': {
      const { declaration } = entity;
      switch (declaration.kind) {
        case 'TypeParameter':
          return parameterType(declaration);
        case 'StructDeclaration':
        case 'EnumDeclaration':
        case 'ExternStructDeclaration':
          return {
            kind: 'nominal',
            entity: entity as NominalType['entity'],
            arguments: typeArguments(resolution, node, declaration),
          };
        case 'TraitDeclaration':
          checker.report(module, checkerDiagnostics.notType(node.span, name.text));
          return errorType;
        case 'TypeAliasDeclaration':
          return checker.unsupported(module, declaration);
        default: {
          const unhandled: never = declaration;
          return unhandled;
        }
      }
    }
    case 'self':
      return checker.unsupported(module, node);
    default:
      checker.report(module, checkerDiagnostics.notType(node.span, name.text));
      return errorType;
  }
}

function parameterType(declaration: TypeParameter): TypeParameterType {
  return { kind: 'parameter', declaration };
}

/** The written arguments, then the defaults of the parameters left out. */
function typeArguments(
  resolution: Resolution,
  node: NamedType,
  declaration: NominalDeclaration,
): readonly Type[] {
  const { checker, module } = resolution;
  const parameters = declaration.typeParameters.filter(
    (parameter) => parameter.kind === 'TypeParameter',
  );
  const written = node.typeArguments.map((argument) => resolve(resolution, argument));
  const required = parameters.filter((parameter) => parameter.defaultType === undefined).length;
  if (written.length < required || written.length > parameters.length) {
    const expected = written.length < required ? required : parameters.length;
    checker.report(
      module,
      checkerDiagnostics.typeArgumentCount(
        node.span,
        declaration.name.text,
        expected,
        written.length,
      ),
    );
    return parameters.map(() => errorType);
  }
  const substitution = new Map<TypeParameter, Type>();
  return parameters.map((parameter, index) => {
    const argument = written[index] ?? defaultOf(checker, declaration, parameter, substitution);
    substitution.set(parameter, argument);
    return argument;
  });
}

/** A left-out argument: the parameter's default, resolved where it was declared. */
function defaultOf(
  checker: CheckerContext,
  declaration: NominalDeclaration,
  parameter: TypeParameter,
  earlier: Map<TypeParameter, Type>,
): Type {
  if (parameter.defaultType === undefined) {
    return errorType;
  }
  return substitute(
    resolveTypeNode(checker, checker.moduleOf(declaration), parameter.defaultType),
    earlier,
  );
}
