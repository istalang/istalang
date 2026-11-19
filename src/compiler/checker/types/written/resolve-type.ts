/**
 * The type a type node denotes (§4.2, §8.1, §4.6): names resolve through the binder, and the type
 * node kinds each have a handler.
 *
 * - A generic declaration's missing trailing type arguments take their declared defaults (§8.1),
 *   whatever the declaration: a struct, enum, trait, alias or function (type-arguments.ts).
 * - Every argument given for a constrained parameter must meet its constraints. Meeting one looks
 *   at function signatures, which may still be resolving their own types, so the check is noted
 *   here and runs when its module is checked (`constrainLater`). A type node resolves once
 *   (the checker memoizes `resolveType` per node), and its module's own check resolves every type
 *   node it has, defaults of type parameters included, so every check is noted by then, whichever
 *   module asked first.
 * - An alias is the type it stands for, its own parameters replaced by the arguments, written
 *   through the alias so it reads as written (§4.6).
 * - `T?` is the prelude's `Optional<T>` (§4.2), and `Self` inside a trait is the trait's implicit
 *   parameter (types/type/index.ts).
 * - `&T` is a parameter's type, or an item of the tuple of an `Fn`'s parameters; here it denotes
 *   `T`, and the signature, or `fnType`, records the reference. The parser lets a tuple's item be
 *   one, which this reports unless the tuple is an `Fn`'s.
 * - The prelude's `Fn<Args, Result, Kind, Send>` names the function type it is, built through the
 *   one constructor (`fnType`), its `Args` a tuple or a pack, reported otherwise.
 * - Fields, of a struct, an enum's variant or an anonymous struct type, resolve in the module
 *   writing them (declared-fields.ts).
 * - A path past the type it names reaches its associated types, `T.Data`, and so does `.Name` after
 *   type arguments, `Field<Int>.Data` (§5.2); either reduces through `TypeRules`.
 * - A `{…}` type is a shape (§5.2), or a mapped struct type, and `keyof S` and `S[K]` are key
 *   types (key-types.ts).
 * - A trait names no type of its own; after `any` it names the traits of one (§8.2).
 * - A recursive alias's group closes from its bodies resolved apart (`resolveClosing`): a node
 *   writing a use of the group resolves afresh, that use a placeholder, and reports and notes
 *   nothing its own resolution doesn't again; any other node resolves as the checker resolves it.
 */

import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import { type Handlers, handlerOf } from '../../../../foundation/structures/kind-table.ts';
import type { Entity } from '../../../binder/entities.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { TypeAliasDeclaration } from '../../../syntax/declarations/index.ts';
import { awaits } from '../../../syntax/tokens/modifiers.ts';
import { parentOf } from '../../../syntax/tree/index.ts';
import { type Identifier, isMissingName } from '../../../syntax/tree/node.ts';
import {
  type FunctionType as FunctionTypeNode,
  type NamedType,
  type ReferenceType,
  type RestType,
  type TypeNode,
  type UnionType,
  unparenthesizedType,
} from '../../../syntax/types/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { substitute, substitutionFor } from '../parts/substitution.ts';
import { aliasedAs } from '../type/alias-uses.ts';
import { ownAssociatedType } from '../type/computed-types.ts';
import { isSimpleMark, simpleMark, writtenKindOf } from '../type/function-kinds.ts';
import { fnType, functionType, headResult, isPack, sendOf } from '../type/function-types.ts';
import {
  type NominalDeclaration,
  nominalType,
  type PackType,
  type ParameterKey,
  type Type,
} from '../type/index.ts';
import { errorType, primitiveType, tupleType, unitType } from '../type/primitives.ts';
import { typeText } from '../type/type-text.ts';
import { optionalOf, unionOf, writtenLiteral } from '../unions/unions.ts';
import { fieldWritten, keysWritten, structWritten } from './key-types.ts';
import { namedPathOf } from './named-paths.ts';
import { constrainArguments, noteConstraints, typeArgumentsFor } from './type-arguments.ts';
import { aliasInstance } from './type-match.ts';
import { type PassResolution, reportWritten, type Written } from './written.ts';
import {
  asWrittenInMatch,
  inCasePattern,
  inferWritten,
  unreducedAssociated,
  unreducedUse,
} from './written-matches.ts';

interface Resolution extends Written {
  /** The group whose bodies are closing, its uses placeholders; undefined anywhere else. */
  readonly closing?: ClosingGroup | undefined;
}

/**
 * A recursive alias group whose bodies are resolved to close it
 * (constructs/declarations/aliases/recursive-bodies.ts).
 */
interface ClosingGroup {
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
  ReferenceType: (resolution, node) => referent(resolution, node),
  TupleType: (resolution, node) =>
    tupleType(node.elements.map((element) => resolve(resolution, element))),
  FunctionType: (resolution, node) => writtenFunctionType(resolution, node),
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
 * The type `node` denotes in `pass` of the loops over a type's keys around it (written.ts): each
 * node it is built of resolved afresh, from its leaves up, with their keys bound.
 */
export function resolveInPass(
  checker: CheckerContext,
  module: ModuleId,
  node: TypeNode,
  pass: PassResolution,
): Type {
  return resolve({ checker, module, pass }, node);
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
  const { checker, module, closing, pass } = resolution;
  if (pass !== undefined) {
    const resolved = handlerOf(typeHandlers, node)(resolution, node);
    const type = substitute(resolved, pass.binds, checker.typeRules);
    pass.record(node, type);
    return type;
  }
  return closing?.writesUse(node) === true
    ? handlerOf(typeHandlers, node)(resolution, node)
    : checker.resolveType(module, node);
}

function writtenFunctionType(resolution: Resolution, node: FunctionTypeNode): Type {
  const fixed = node.parameters.filter(isTypeNode);
  const rests = node.parameters.filter((parameter) => parameter.kind === 'RestType');
  const last = node.parameters.at(-1);
  for (const rest of rests.filter((each) => each !== last)) {
    reportWritten(resolution, checkerDiagnostics.packNotLast(rest.span));
  }
  const rest = last?.kind === 'RestType' ? last : undefined;
  const written = node.returnType === undefined ? unitType : resolve(resolution, node.returnType);
  // An unmarked function type is simple (proposal 8, Rule 4), but its future must be of a kind.
  const kind = writtenKindOf(node.qualifiers) ?? simpleMark;
  if (awaits(node.qualifiers) && isSimpleMark(kind)) {
    reportWritten(resolution, checkerDiagnostics.unkindedFuture(node.span));
  }
  return functionType({
    send: sendOf(node.qualifiers),
    mark: kind,
    parameters: fixed.map((parameter) => ({
      type: resolve(resolution, parameter),
      reference: unparenthesizedType(parameter).kind === 'ReferenceType',
    })),
    pack: rest === undefined ? undefined : packOf(resolution, rest),
    result: headResult(resolution.checker.fitting, node.qualifiers, kind, written),
  });
}

/** The pack a function type's rest names (§8.1); the error type, reported, for anything else. */
function packOf(resolution: Resolution, rest: RestType): PackType {
  const type = resolve(resolution, rest.type);
  if (type.kind === 'error' || isPack(type)) {
    return type;
  }
  reportWritten(resolution, checkerDiagnostics.restNotPack(rest.span, typeText(type)));
  return errorType;
}

/** Whether a function type's parameter is a type, rather than a rest. */
function isTypeNode(parameter: TypeNode | RestType): parameter is TypeNode {
  return parameter.kind !== 'RestType';
}

/**
 * The type a named type names. A path past the type it names goes on with that type's associated
 * types (`T.Data`, §5.2), which the binder leaves unresolved: the type arguments then belong to
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
  const byReference = referenceItems(node);
  const type = asWrittenInMatch(
    resolution,
    node,
    typeOfEntity(checker, entity, argumentsFor, byReference),
  );
  if (type === undefined) {
    reportWritten(resolution, checkerDiagnostics.notType(node.span, name.text));
    return errorType;
  }
  if (isFnType(checker, entity)) {
    checkFnArguments(resolution, node, type);
  }
  const last = members.at(-1) ?? name;
  if (
    node.typeArguments.length > 0 &&
    (members.length > 0 || entity.kind !== 'type' || entity.declaration.kind === 'AssociatedType')
  ) {
    reportWritten(
      resolution,
      checkerDiagnostics.typeArgumentCount(node.span, last.text, 0, node.typeArguments.length),
    );
  }
  return members.reduce((owner, member) => associatedAt(resolution, owner, member), type);
}

/** The associated type `name` names on `owner` (§5.2), reported when it has none. */
function associatedAt(resolution: Resolution, owner: Type, name: Identifier): Type {
  const { checker } = resolution;
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
    reportWritten(
      resolution,
      checkerDiagnostics.noAssociatedType(name.span, typeText(owner), name.text),
    );
  }
  return type;
}

/**
 * The type `entity` names, given the arguments `typeArgumentsOf` finds for a generic declaration: a
 * primitive, `Self` or a type parameter, a nominal type, the prelude's `Fn` as the function type it
 * is (`fnType`), its parameters taken by `&` as `byReference` says, or an alias as the type it
 * stands for, written through it (§4.6); the error type when `typeArgumentsOf` finds none, and
 * undefined for what names no type, a trait among them. The one dispatch from a name to its type,
 * whether written in a type (`namedType`) or in a value's place (named-types.ts).
 */
export function typeOfEntity(
  checker: Pick<CheckerContext, 'aliasedType' | 'typeRules' | 'wellKnownEntity'>,
  entity: Entity,
  typeArgumentsOf: (
    declaration: NominalDeclaration | TypeAliasDeclaration,
  ) => readonly Type[] | undefined,
  byReference: readonly boolean[] = [],
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
          // A requirement names a type only on what meets its trait (`T.Key`, §8.2).
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
          // Named bare inside its own declaration, it is the type it stands for there (§5.2).
          return aliasInstance(
            declaration,
            checker.aliasedType(declaration),
            new Map(),
            checker.typeRules,
          );
        default: {
          const typeArguments = typeArgumentsOf(declaration);
          if (typeArguments === undefined) {
            return errorType;
          }
          return isFnType(checker, entity)
            ? fnType(typeArguments, byReference)
            : nominalType(entity, typeArguments);
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
  const typeArguments = typeArgumentsFor(resolution, list);
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
 * The union `node` writes (§4.2), normalized: a member another one holds whole merges into it, an
 * `any` member taking every type meeting its traits.
 */
function unionTypeOf(resolution: Resolution, node: UnionType): Type {
  const members = node.members.map((member) => resolve(resolution, member));
  return unionOf(members, resolution.checker.typeRules);
}

/** Reports the `Args` the `Fn` written `node` names its `type` by where it is no tuple or pack. */
function checkFnArguments(resolution: Resolution, node: NamedType, type: Type): void {
  const [args] = node.typeArguments;
  if (args === undefined || type.kind !== 'function' || type.pack?.kind !== 'error') {
    return;
  }
  const given = resolve(resolution, args);
  if (given.kind !== 'error') {
    reportWritten(resolution, checkerDiagnostics.fnArgumentsNotTuple(args.span, typeText(given)));
  }
}

/** Whether `entity` is the prelude's `Fn`, the one function type (§6.4). */
function isFnType(
  checker: Pick<CheckerContext, 'wellKnownEntity'>,
  entity: Entity | undefined,
): boolean {
  return entity === checker.wellKnownEntity(wellKnown.fn);
}

/** Which items of the tuple `node` writes as its first type argument are `&T`, as `Fn`'s are. */
function referenceItems(node: NamedType): readonly boolean[] {
  const [args] = node.typeArguments;
  const tuple = args === undefined ? undefined : unparenthesizedType(args);
  return tuple?.kind === 'TupleType'
    ? tuple.elements.map((item) => unparenthesizedType(item).kind === 'ReferenceType')
    : [];
}

/**
 * The type `&T` denotes: `T`, the reference recorded by what takes it. The parser lets one stand on
 * a parameter's type and on a tuple's item (§7.3); a tuple's is reported here unless the tuple is
 * an `Fn`'s parameters (`fnType`).
 */
function referent(resolution: Resolution, node: ReferenceType): Type {
  const { checker, module } = resolution;
  const tree = checker.inputs.treeOf(module);
  const holder = parentOf(tree, node);
  if (holder?.kind === 'TupleType') {
    let named = parentOf(tree, holder);
    while (named?.kind === 'ParenthesizedType') {
      named = parentOf(tree, named);
    }
    const [args] = named?.kind === 'NamedType' ? named.typeArguments : [];
    const isFnItem =
      named?.kind === 'NamedType' &&
      args !== undefined &&
      unparenthesizedType(args) === holder &&
      isFnType(checker, namedPathOf(checker.bindings, module, named).entity);
    if (!isFnItem) {
      reportWritten(resolution, checkerDiagnostics.misplacedReferenceItem(node.span));
    }
  }
  return resolve(resolution, node.referent);
}
