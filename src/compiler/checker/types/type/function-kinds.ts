/**
 * The kinds of code as types (proposal 8, Rules 1–4): what a function type's kind slot and a
 * future's `K` hold. A kind is `"live"` or `"ista"`, a literal of the prelude's `Persistence`;
 * an unmarked function type's is the whole union, which either kind may call; a generic one's a
 * kind variable, a function's own implicit one (syntax/declarations/function-kinds.ts) or a kind
 * parameter its signature names.
 *
 * A function's kind is its head's; else its implicit kind parameter; else a kind parameter its
 * signature passes as a kind, a future's or a `Deferred`'s (`time.delay`, `defer`); else either. A
 * kind parameter its signature only takes a value of (`describe<K>(k: K)`) is no kind of its own.
 * It is found by the names the signature writes, so resolving a type its signature holds may ask
 * it, and the checker keeps each answer as an entry (`Checker.kindOf`). An interim until phase
 * K1c's written marks (docs/work/async-kinds/phases.md).
 */

import {
  type Persistence,
  persistences,
} from '../../../../foundation/language/well-known/index.ts';
import type { TypeEntity } from '../../../binder/entities.ts';
import { declaredFunctionName } from '../../../syntax/declarations/field-defaults.ts';
import {
  isKindParameter,
  kindOwnerOf,
  kindParameterOf,
  writtenKindParameterOf,
} from '../../../syntax/declarations/function-kinds.ts';
import {
  type Declaration,
  type FunctionDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../../syntax/declarations/index.ts';
import { awaits, type FunctionQualifiers } from '../../../syntax/tokens/modifiers.ts';
import { fieldChildrenOf, parentOf, type SyntaxNode } from '../../../syntax/tree/index.ts';
import type { TypeNode } from '../../../syntax/types/index.ts';
import type { Checker } from '../../check.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { namedPathOf } from '../written/named-paths.ts';
import type { Type } from './index.ts';
import { persistenceType } from './primitives.ts';

/** The kind of an unmarked function type outside any signature: either, `Persistence` itself. */
export const unmarkedKind: Type = { kind: 'union', members: persistences.map(persistenceType) };

/** What reading a kind asks of the checker, which keeps each answer as an entry of its own. */
export type KindLookup = Pick<Checker, 'kindOf'>;

/** What finding a function's kind looks up: the names its signature writes. */
export type KindNames = Pick<CheckerContext, 'bindings' | 'moduleOf'>;

/**
 * Whether a function of kind `callee` may be called, or fit, where code of kind `code` calls it
 * (proposal 8, Rules 2 and 4): either kind may call an unmarked one, and each kind its own, the
 * kinds compared by `same`, which may infer them; the kinds never meet.
 */
export function kindAdmits(
  code: Type,
  callee: Type,
  same: (expected: Type, found: Type) => boolean,
): boolean {
  return callee.kind === 'union' || same(code, callee);
}

/**
 * Whether a witness of kind `given` may meet a requirement of kind `required`, the requirement's
 * as its conformance instantiates it (§3.10): a requirement of a kind is met by a function of that
 * kind or an unmarked one, an unmarked requirement only by an unmarked one, so a call through it,
 * of the requirement's kind, calls nothing of another.
 */
export function meetsRequirementKind(required: Type, given: Type): boolean {
  const witness = persistenceOf(given);
  return witness === undefined || witness === persistenceOf(required);
}

/** Which of the two kinds `kind` is; undefined for either, or a kind variable. */
export function persistenceOf(kind: Type): Persistence | undefined {
  return persistences.find((each) => kind.kind === 'literal' && kind.value === each);
}

/** The kind a head writes; undefined where it writes none. */
export function writtenKindOf(qualifiers: FunctionQualifiers): Type | undefined {
  return qualifiers.kind === undefined ? undefined : persistenceType(qualifiers.kind);
}

/** The kind of `declaration`'s code (the banner), as the checker keeps it. */
export function kindOfFunction(lookup: KindLookup, declaration: FunctionDeclaration): Type {
  return ownKindOf(declaration) ?? lookup.kindOf(declaration);
}

/**
 * The kind of `declaration`'s code (the banner), found from the names its signature writes; what
 * the checker keeps for one whose head and implicit kind say nothing (`kindOfFunction`).
 */
export function functionKindOf(names: KindNames, declaration: FunctionDeclaration): Type {
  const own = ownKindOf(declaration);
  if (own !== undefined) {
    return own;
  }
  const variable = kindVariableOf(names, declaration);
  return variable === undefined ? unmarkedKind : { kind: 'parameter', declaration: variable };
}

/** The kind `declaration`'s syntax alone says: its head's, else its implicit kind parameter. */
function ownKindOf(declaration: FunctionDeclaration): Type | undefined {
  const implicit = kindParameterOf(declaration);
  return (
    writtenKindOf(declaration.qualifiers) ??
    (implicit === undefined ? undefined : { kind: 'parameter', declaration: implicit })
  );
}

/**
 * The kind parameter `declaration`'s signature passes as a kind, its own or its trait's; else,
 * where it needs a kind of its own, an async one, the kind parameter it writes.
 */
function kindVariableOf(
  names: KindNames,
  declaration: FunctionDeclaration,
): TypeParameter | undefined {
  const module = names.moduleOf(declaration);
  const passed = signatureNodesOf(declaration)
    .flatMap(namedTypesIn)
    .flatMap((node) => kindsPassedBy(names, module, node));
  return (
    passed[0] ?? (awaits(declaration.qualifiers) ? writtenKindParameterOf(declaration) : undefined)
  );
}

function signatureNodesOf(declaration: FunctionDeclaration): readonly TypeNode[] {
  const parameters = declaration.parameters.flatMap((parameter) =>
    parameter.kind === 'Parameter' && parameter.type !== undefined ? [parameter.type] : [],
  );
  return declaration.returnType === undefined
    ? parameters
    : [...parameters, declaration.returnType];
}

function namedTypesIn(node: SyntaxNode): readonly SyntaxNode[] {
  const inner = fieldChildrenOf(node).flatMap(namedTypesIn);
  return node.kind === 'NamedType' ? [node, ...inner] : inner;
}

/** The kind parameters `node`, a named type, writes as arguments to its own kind parameters. */
function kindsPassedBy(
  lookup: KindNames,
  module: ReturnType<KindNames['moduleOf']>,
  node: SyntaxNode,
): readonly TypeParameter[] {
  if (node.kind !== 'NamedType' || node.typeArguments.length === 0) {
    return [];
  }
  const generic = declaredTypeOf(lookup, module, node);
  const parameters =
    generic !== undefined && 'typeParameters' in generic
      ? typeParametersOf(generic.typeParameters)
      : [];
  return node.typeArguments.flatMap((argument, index) => {
    const parameter = parameters[index];
    if (parameter === undefined || !isKindParameter(parameter) || argument.kind !== 'NamedType') {
      return [];
    }
    const named = declaredTypeOf(lookup, module, argument);
    return named?.kind === 'TypeParameter' && isKindParameter(named) ? [named] : [];
  });
}

function declaredTypeOf(
  lookup: KindNames,
  module: ReturnType<KindNames['moduleOf']>,
  node: Extract<SyntaxNode, { kind: 'NamedType' }>,
): TypeEntity['declaration'] | undefined {
  const { entity, members } = namedPathOf(lookup.bindings, module, node);
  return entity?.kind === 'type' && members.length === 0 ? entity.declaration : undefined;
}

/**
 * How a message names what the kind parameter `parameter` is the kind of: the function an implicit
 * one is of, or the declaration writing it.
 */
export function kindHolderName(
  lookup: Pick<CheckerContext, 'moduleOf' | 'inputs'>,
  parameter: TypeParameter,
): string {
  const owner = kindOwnerOf(parameter) ?? declaringOf(lookup, parameter);
  if (owner === undefined) {
    return `'${parameter.name.text}'`;
  }
  return owner.kind === 'FunctionDeclaration'
    ? `'${declaredFunctionName(owner)}'`
    : `'${owner.name.text}'`;
}

/**
 * Whether the kind `kind` is one of the two: `live`, `ista`, or a kind parameter standing for one
 * (`K in Persistence`, or a function's implicit one where its future needs it).
 */
export function isOneKind(kind: Type): boolean {
  return (
    persistenceOf(kind) !== undefined ||
    (kind.kind === 'parameter' &&
      kind.declaration.kind === 'TypeParameter' &&
      isKindParameter(kind.declaration) &&
      kind.declaration.memberOf !== undefined)
  );
}

/** The declarations that write type parameters. */
type GenericDeclaration = Extract<
  Declaration,
  {
    kind:
      | 'FunctionDeclaration'
      | 'StructDeclaration'
      | 'SharedStructDeclaration'
      | 'EnumDeclaration'
      | 'ExternStructDeclaration'
      | 'TraitDeclaration'
      | 'TypeAliasDeclaration';
  }
>;

const genericKinds: ReadonlySet<string> = new Set<GenericDeclaration['kind']>([
  'FunctionDeclaration',
  'StructDeclaration',
  'SharedStructDeclaration',
  'EnumDeclaration',
  'ExternStructDeclaration',
  'TraitDeclaration',
  'TypeAliasDeclaration',
]);

function isGenericDeclaration(node: SyntaxNode): node is SyntaxNode & GenericDeclaration {
  return genericKinds.has(node.kind);
}

/** The declaration whose type parameter `parameter` is. */
function declaringOf(
  lookup: Pick<CheckerContext, 'moduleOf' | 'inputs'>,
  parameter: TypeParameter,
): GenericDeclaration | undefined {
  const tree = lookup.inputs.treeOf(lookup.moduleOf(parameter));
  for (let node = parentOf(tree, parameter); node !== undefined; node = parentOf(tree, node)) {
    if (isGenericDeclaration(node)) {
      return node;
    }
  }
  return undefined;
}
