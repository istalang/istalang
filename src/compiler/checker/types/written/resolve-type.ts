/**
 * The type a type node denotes (§2, §3.5, §3.17): names resolve through the binder, and the type
 * node kinds each have a handler.
 *
 * - A generic declaration's missing trailing type arguments take their declared defaults (§3.5),
 *   whatever the declaration: a struct, enum, trait, alias or function (type-arguments.ts).
 * - Every argument given for a constrained parameter must meet its constraints. Meeting one looks
 *   at function signatures, which may still be resolving their own types, so the check is noted
 *   here and runs when its module is checked (`constrainLater`). A type node resolves once
 *   (the checker memoizes `resolveType` per node), and its module's own check resolves every type
 *   node it has, defaults of type parameters included, so every check is noted by then, whichever
 *   module asked first.
 * - An alias is the type it stands for, its own parameters replaced by the arguments, written
 *   through the alias so it reads as written (§3.17).
 * - `T?` is the prelude's `Optional<T>` (§2), and `Self` inside a trait is the trait's implicit
 *   parameter (types/type/index.ts).
 * - `&T` is only ever a parameter's type (the parser enforces it); here it denotes `T`, and the
 *   signature records the reference.
 * - Fields, of a struct, an enum's variant or an anonymous struct type, resolve in the module
 *   writing them (declared-fields.ts).
 * - A path past the type it names reaches its associated types, `T.Data`, and so does `.Name` after
 *   type arguments, `Field<Int>.Data` (§3.1); either reduces through `TypeRules`.
 * - A `{…}` type is a shape (§3.1), or a mapped struct type, and `keyof S` and `S[K]` are key
 *   types (key-types.ts).
 * - A trait names no type of its own; after `any` it names the traits of one (§3.10).
 * - A recursive alias's group closes from its bodies resolved apart (`resolveClosing`): a node
 *   writing a use of the group resolves afresh, that use a placeholder, and reports and notes
 *   nothing its own resolution doesn't again; any other node resolves as the checker resolves it.
 */

import { type Handlers, handlerOf } from '../../../../structures/kind-table.ts';
import type { Entity } from '../../../binder/entities.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { TypeAliasDeclaration } from '../../../syntax/declarations/index.ts';
import { type Identifier, isMissingName } from '../../../syntax/node.ts';
import {
  type FunctionType as FunctionTypeNode,
  type NamedType,
  type RestType,
  type TypeNode,
  type UnionType,
  unparenthesizedType,
} from '../../../syntax/types/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { ownAssociatedType } from '../computed-types.ts';
import { isPack, withPack } from '../function-types.ts';
import { substitutionFor } from '../substitution.ts';
import { aliasedAs } from '../type/alias-uses.ts';
import {
  type NominalDeclaration,
  nominalType,
  type PackType,
  type ParameterKey,
  type Type,
} from '../type/index.ts';
import { errorType, primitiveType, tupleType, unitType } from '../type/primitives.ts';
import { typeText } from '../type-text.ts';
import { optionalOf, unionOf, writtenLiteral } from '../unions/unions.ts';
import { fieldWritten, keysWritten, structWritten } from './key-types.ts';
import { namedPathOf } from './named-paths.ts';
import { constrainArguments, noteConstraints, typeArgumentsFor } from './type-arguments.ts';
import { aliasInstance } from './type-match.ts';
import {
  asWrittenInMatch,
  inCasePattern,
  inferWritten,
  unreducedAssociated,
  unreducedUse,
} from './written-matches.ts';

interface Resolution {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  /** The group whose bodies are closing, its uses placeholders; undefined anywhere else. */
  readonly closing?: ClosingGroup | undefined;
}

/**
 * A recursive alias group whose bodies are resolved to close it
 * (constructs/declarations/aliases/recursive-bodies.ts).
 */
export interface ClosingGroup {
  readonly aliases: ReadonlySet<TypeAliasDeclaration>;
  /** Whether `node` writes a use of one of `aliases`, at any depth. */
  readonly writesUse: (node: TypeNode) => boolean;
}

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
  StructType: (resolution, node) =>
    structWritten(resolution, node, (each) => resolve(resolution, each)),
  AnyType: (resolution, node) =>
    resolution.checker.anyTypeOf(resolution.module, node.traits, (argument) =>
      resolve(resolution, argument),
    ),
  UnionType: (resolution, node) => unionTypeOf(resolution, node),
  LiteralType: (_resolution, node) => writtenLiteral(node.value) ?? errorType,
  MemberType: (resolution, node) =>
    associatedAt(resolution, resolve(resolution, node.owner), node.name),
  IndexedType: (resolution, node) =>
    fieldWritten(resolution, node, resolve(resolution, node.owner), resolve(resolution, node.key)),
  KeyofType: (resolution, node) =>
    keysWritten(resolution, node.owner, resolve(resolution, node.owner)),
  InferType: (resolution, node) => inferWritten(resolution, node),
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

/**
 * The type `node`, part of a body of `group`, closes from (the banner): each use of the group's
 * aliases a placeholder standing for that alias.
 */
export function resolveClosing(
  checker: CheckerContext,
  module: ModuleId,
  node: TypeNode,
  group: ClosingGroup,
): Type {
  return handlerOf(typeHandlers, node)({ checker, module, closing: group }, node);
}

/** The type a type parameter (or a trait's `Self`) stands for inside its declaration. */
export function parameterType(declaration: ParameterKey): Type {
  return { kind: 'parameter', declaration };
}

function resolve(resolution: Resolution, node: TypeNode): Type {
  const { checker, module, closing } = resolution;
  return closing?.writesUse(node) === true
    ? handlerOf(typeHandlers, node)(resolution, node)
    : checker.resolveType(module, node);
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
  const { name, entity, members } = namedPathOf(checker.bindings, module, node);
  if (name === undefined || entity === undefined || members.some(isMissingName)) {
    return errorType;
  }
  if (
    entity.kind === 'type' &&
    entity.declaration.kind === 'TypeAliasDeclaration' &&
    resolution.closing?.aliases.has(entity.declaration) === true
  ) {
    return parameterType(entity.declaration);
  }
  const written = members.length === 0 ? node : { ...node, typeArguments: [] };
  const argumentsFor = (declaration: NominalDeclaration | TypeAliasDeclaration) =>
    argumentsOf(resolution, written, declaration);
  const unreduced = unreducedUse(resolution, node, entity, argumentsFor);
  if (unreduced !== undefined) {
    return unreduced;
  }
  const type = asWrittenInMatch(resolution, node, typeOfEntity(checker, entity, argumentsFor));
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
  const unreduced = unreducedAssociated(resolution, owner, name);
  if (unreduced !== undefined) {
    return unreduced;
  }
  const type = checker.typeRules.associatedType(owner, name.text);
  const declared =
    owner.kind === 'nominal'
      ? ownAssociatedType(owner, name.text) !== undefined
      : type.kind !== 'error';
  if (!declared && owner.kind !== 'error' && !isMissingName(name)) {
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
 * written through it (§3.17); the error type when `typeArgumentsOf` finds none, and undefined for
 * what names no type, a trait among them. The one dispatch from a name to its type, whether written
 * in a type (`namedType`) or in a value's place (named-types.ts).
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
          const substitution =
            typeArguments.length === 0
              ? new Map()
              : substitutionFor(declaration.typeParameters, typeArguments);
          const aliased = checker.aliasedType(declaration);
          const type = aliasInstance(declaration, aliased, substitution, checker.typeRules);
          return aliasedAs(type, { kind: 'alias', declaration, arguments: typeArguments });
        }
        case 'AssociatedType':
          // Named bare inside its own declaration, it is the type it stands for there (§3.1).
          return aliasInstance(
            declaration,
            checker.aliasedType(declaration),
            new Map(),
            checker.typeRules,
          );
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

/**
 * The written and default arguments of a named type, each noted for its parameter's constraints.
 */
function argumentsOf(
  resolution: Resolution,
  node: NamedType,
  declaration: NominalDeclaration | TypeAliasDeclaration,
): readonly Type[] | undefined {
  const { checker, module } = resolution;
  const written = node.typeArguments.map((argument) => resolve(resolution, argument));
  const list = { at: node.span, declaration, types: written };
  const typeArguments = typeArgumentsFor(checker, module, list);
  if (typeArguments === undefined) {
    return undefined;
  }
  const complete = { ...list, types: typeArguments };
  // A closing body's node resolves again as written, which notes its checks with closed types.
  if (resolution.closing === undefined) {
    if (inCasePattern(resolution, node)) {
      noteConstraints(checker, module, complete);
    } else {
      constrainArguments(checker, module, complete);
    }
  }
  return typeArguments;
}

/**
 * The union `node` writes (§2), normalized: a member another one holds whole merges into it, an
 * `any` member taking every type meeting its traits.
 */
function unionTypeOf(resolution: Resolution, node: UnionType): Type {
  const members = node.members.map((member) => resolve(resolution, member));
  return unionOf(members, resolution.checker.typeRules);
}
