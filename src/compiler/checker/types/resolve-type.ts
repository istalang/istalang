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
 * - An alias is the type it stands for, its own parameters replaced by the arguments, written
 *   through the alias so it reads as written (§3.17).
 * - `T?` is the prelude's `Optional<T>` (§2), and `Self` inside a trait is the trait's implicit
 *   parameter (types/type.ts).
 * - `&T` is only ever a parameter's type (the parser enforces it); here it denotes `T`, and the
 *   signature records the reference.
 * - Fields, of a struct, an enum's variant or an anonymous struct type, resolve in the module
 *   writing them (declared-fields.ts).
 * - A path past the type it names reaches its associated types, `T.Data`, and so does `.Name` after
 *   type arguments, `Field<Int>.Data` (§3.1); either reduces through `TypeRules`.
 * - A `{…}` type is a shape (§3.1), whose fields resolve here. A shape's field takes no annotation
 *   (§3.16), which is reported here, where nothing else declares it, without computing its value:
 *   that could reach the very type being resolved.
 * - A trait names no type of its own; after `any` it names the traits of one (§3.10).
 */

import { type Handlers, handlerOf } from '../../../structures/kind-table.ts';
import type { Entity } from '../../binder/entities.ts';
import type { ModuleId } from '../../program/program.ts';
import {
  type FunctionDeclaration,
  type TraitDeclaration,
  type TypeAliasDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import { type Identifier, isMissingName } from '../../syntax/node.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import {
  type FunctionType as FunctionTypeNode,
  type NamedType,
  type RestType,
  type TypeNode,
  type UnionType,
  unparenthesizedType,
} from '../../syntax/types.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { declaredFields } from './declared-fields.ts';
import { withPack } from './function-types.ts';
import { substitute, substitutionFor } from './substitution.ts';
import {
  aliasedAs,
  errorType,
  isPack,
  type NominalDeclaration,
  nominalType,
  type PackType,
  type ParameterKey,
  primitiveType,
  shapeType,
  type Type,
  tupleType,
  unitType,
} from './type.ts';
import { typeText } from './type-text.ts';
import { optionalOf, unionOf, writtenLiteral } from './unions.ts';

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
    optionalOf(resolve(resolution, node.inner), resolution.checker.typeRules),
  ParenthesizedType: (resolution, node) => resolve(resolution, node.inner),
  ReferenceType: (resolution, node) => resolve(resolution, node.referent),
  TupleType: (resolution, node) =>
    tupleType(node.elements.map((element) => resolve(resolution, element))),
  FunctionType: (resolution, node) => functionType(resolution, node),
  StructType: ({ checker, module }, node) => {
    for (const field of node.fields) {
      for (const annotation of field.annotations ?? []) {
        checker.report(module, checkerDiagnostics.shapeFieldAnnotation(annotation.span));
      }
    }
    return shapeType(node, declaredFields(checker, module, node.fields));
  },
  AnyType: ({ checker, module }, node) => checker.anyTypeOf(module, node.traits),
  UnionType: (resolution, node) => unionTypeOf(resolution, node),
  LiteralType: (_resolution, node) => writtenLiteral(node.value) ?? errorType,
  MemberType: (resolution, node) =>
    associatedAt(resolution, resolve(resolution, node.owner), node.name),
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

/** The type a type parameter (or a trait's `Self`) stands for inside its declaration. */
export function parameterType(declaration: ParameterKey): Type {
  return { kind: 'parameter', declaration };
}

/** Type arguments given a generic declaration at `at`; `self` is what a trait's `Self` stands for. */
export interface ArgumentList {
  readonly at: AnchoredSpan;
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
    checker.typeRules,
  );
}

function resolve({ checker, module }: Resolution, node: TypeNode): Type {
  return checker.resolveType(module, node);
}

function functionType(resolution: Resolution, node: FunctionTypeNode): Type {
  const fixed = node.parameters.filter(isTypeNode);
  const rests = node.parameters.filter((parameter) => parameter.kind === 'RestType');
  const last = node.parameters.at(-1);
  for (const rest of rests.filter((each) => each !== last)) {
    resolution.checker.report(resolution.module, checkerDiagnostics.packNotLast(rest.span));
  }
  const rest = last?.kind === 'RestType' ? last : undefined;
  return withPack(
    {
      kind: 'function',
      isSendable: node.isSendable,
      isAsync: node.isAsync,
      parameters: fixed.map((parameter) => ({
        type: resolve(resolution, parameter),
        reference: unparenthesizedType(parameter).kind === 'ReferenceType',
      })),
      result: node.returnType === undefined ? unitType : resolve(resolution, node.returnType),
    },
    rest === undefined ? undefined : packOf(resolution, rest),
  );
}

/** The pack a function type's rest names (§3.5); the error type, reported, for anything else. */
function packOf(resolution: Resolution, rest: RestType): PackType {
  const { checker, module } = resolution;
  const type = resolve(resolution, rest.type);
  if (type.kind === 'error' || isPack(type)) {
    return type;
  }
  checker.report(module, checkerDiagnostics.restNotPack(rest.span, typeText(type)));
  return errorType;
}

/** Whether a function type's parameter is a type, rather than a rest. */
function isTypeNode(parameter: TypeNode | RestType): parameter is TypeNode {
  return parameter.kind !== 'RestType';
}

/**
 * The type a named type names. A path past the type it names goes on with that type's associated
 * types (`T.Data`, §3.1), which the binder leaves unresolved: the type arguments then belong to
 * the last of them, which takes none.
 */
function namedType(resolution: Resolution, node: NamedType): Type {
  const { checker, module } = resolution;
  const resolved = node.path.findIndex(
    (part) => checker.bindings.entityOf(module, part) === undefined,
  );
  const named = resolved === -1 ? node.path.length : resolved;
  const name = node.path[named - 1];
  const entity = name === undefined ? undefined : checker.bindings.entityOf(module, name);
  const members = node.path.slice(named);
  if (name === undefined || entity === undefined || members.some(isMissingName)) {
    return errorType;
  }
  const written = members.length === 0 ? node : { ...node, typeArguments: [] };
  const type = typeOfEntity(checker, entity, (declaration) =>
    argumentsOf(resolution, written, declaration),
  );
  if (type === undefined) {
    checker.report(module, checkerDiagnostics.notType(node.span, name.text));
    return errorType;
  }
  const last = members.at(-1) ?? name;
  if (
    node.typeArguments.length > 0 &&
    (members.length > 0 || entity.kind !== 'type' || entity.declaration.kind === 'AssociatedType')
  ) {
    checker.report(
      module,
      checkerDiagnostics.typeArgumentCount(node.span, last.text, 0, node.typeArguments.length),
    );
  }
  return members.reduce((owner, member) => associatedAt(resolution, owner, member), type);
}

/** The associated type `name` names on `owner` (§3.1), reported when it has none. */
function associatedAt(resolution: Resolution, owner: Type, name: Identifier): Type {
  const { checker, module } = resolution;
  const type = checker.typeRules.associatedType(owner, name.text);
  if (type.kind === 'error' && owner.kind !== 'error' && !isMissingName(name)) {
    checker.report(
      module,
      checkerDiagnostics.noAssociatedType(name.span, typeText(owner), name.text),
    );
  }
  return type;
}

/**
 * The type `entity` names, given the arguments `typeArgumentsOf` finds for a generic declaration: a
 * primitive, `Self` or a type parameter, a nominal type, or an alias as the type it stands for,
 * written through it (§3.17); the error type when `typeArgumentsOf` finds none, and undefined for what
 * names no type, a trait among them. The one dispatch from a name to its type, whether written in a
 * type (`namedType`) or in a value's place (named-types.ts).
 */
export function typeOfEntity(
  checker: Pick<CheckerContext, 'aliasedType' | 'typeRules'>,
  entity: Entity,
  typeArgumentsOf: (
    declaration: NominalDeclaration | TypeAliasDeclaration,
  ) => readonly Type[] | undefined,
): Type | undefined {
  switch (entity.kind) {
    case 'primitive':
      return primitiveType(entity.name);
    case 'self':
      return parameterType(entity.trait);
    case 'type': {
      const { declaration } = entity;
      switch (declaration.kind) {
        case 'TypeParameter':
          return parameterType(declaration);
        case 'TraitDeclaration':
        case 'RequiredAssociatedType':
          // A requirement names a type only on what meets its trait (`T.Key`, §3.10).
          return undefined;
        case 'TypeAliasDeclaration': {
          const typeArguments = typeArgumentsOf(declaration);
          if (typeArguments === undefined) {
            return errorType;
          }
          // No arguments name a generic alias as a whole, its own parameters standing in it.
          const aliased = checker.aliasedType(declaration);
          const type =
            typeArguments.length === 0
              ? aliased
              : substitute(
                  aliased,
                  substitutionFor(declaration.typeParameters, typeArguments),
                  checker.typeRules,
                );
          return aliasedAs(type, { kind: 'alias', declaration, arguments: typeArguments });
        }
        case 'AssociatedType':
          // Named bare inside its own declaration, it is the type it stands for there (§3.1).
          return checker.aliasedType(declaration);
        default: {
          const typeArguments = typeArgumentsOf(declaration);
          return typeArguments === undefined ? errorType : nominalType(entity, typeArguments);
        }
      }
    }
    default:
      return undefined;
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
  const substitution = substitutionFor(declaration.typeParameters, typeArguments);
  const checked = parameters.filter(
    (each) => each.constraints.length > 0 || each.memberOf !== undefined,
  );
  for (const parameter of checked) {
    checker.constrainLater(module, at, parameter, substitution);
  }
}

/**
 * The union `node` writes (§2), normalized: a member another one holds whole merges into it, an
 * `any` member taking every type meeting its traits.
 */
function unionTypeOf(resolution: Resolution, node: UnionType): Type {
  const members = node.members.map((member) => resolve(resolution, member));
  return unionOf(members, resolution.checker.typeRules);
}
