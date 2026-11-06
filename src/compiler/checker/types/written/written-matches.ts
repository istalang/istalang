/**
 * Type `match`es as written (§3.17), what only resolving a written type decides:
 *
 * - Inside a type `match`, a use of a declaration whose body is a type `match`, an alias or an
 *   associated type (§3.1), stays unreduced (type-match.ts): a case's type is resolved once with
 *   its alias's parameters open, and a use substitutes them.
 * - `infer` stands only in a case's pattern; anywhere else it is reported.
 * - A use no case matches is the error type carrying it: the check noted for its instantiation
 *   reports it where it is written, as for any it reaches
 *   (resolution/type-matches/reduction-requirements.ts).
 * - The subject written as a type parameter, in the type of a `case struct …:`, stands for a member
 *   meeting that constraint, so its keys and fields are known there as a constrained parameter's.
 */

import type { Entity } from '../../../binder/entities.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { AliasDeclaration, TypeAliasDeclaration } from '../../../syntax/declarations.ts';
import type { Identifier } from '../../../syntax/node.ts';
import type { SyntaxNode } from '../../../syntax/tree.ts';
import { matchPlaceOf } from '../../../syntax/type-matches.ts';
import type { InferType, NamedType } from '../../../syntax/types.ts';
import type { CheckerContext } from '../../context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { ownAssociatedType } from '../computed-types.ts';
import { aliasedAs } from '../type/alias-uses.ts';
import type { NominalDeclaration, Type } from '../type/index.ts';
import { errorType } from '../type/primitives.ts';
import { matchUse, structCaseOf } from './type-match.ts';

/** Where a type is written: the checker resolving it, and its module. */
interface Written {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
}

/**
 * The unreduced use `node` writes of a type `match` alias inside a type `match`, given the
 * arguments `argumentsFor` finds; undefined for any other named type, or outside one.
 */
export function unreducedUse(
  written: Written,
  node: NamedType,
  entity: Entity,
  argumentsFor: (
    declaration: NominalDeclaration | TypeAliasDeclaration,
  ) => readonly Type[] | undefined,
): Type | undefined {
  const alias =
    entity.kind === 'type' && entity.declaration.kind === 'TypeAliasDeclaration'
      ? entity.declaration
      : undefined;
  if (alias === undefined || !isTypeMatchBodied(alias) || !insideMatch(written, node)) {
    return undefined;
  }
  const typeArguments = argumentsFor(alias) ?? [];
  const use = matchUse(alias, typeArguments);
  return aliasedAs(use, { kind: 'alias', declaration: alias, arguments: typeArguments });
}

/**
 * The unreduced use `name` writes of `owner`'s associated type of that name inside a type `match`,
 * when its body is one, given `owner`'s arguments; undefined for any other, or outside one.
 */
export function unreducedAssociated(
  written: Written,
  owner: Type,
  name: Identifier,
): Type | undefined {
  if (owner.kind !== 'nominal' || !insideMatch(written, name)) {
    return undefined;
  }
  const found = ownAssociatedType(owner, name.text);
  if (found === undefined || !isTypeMatchBodied(found)) {
    return undefined;
  }
  const use = matchUse(found, owner.arguments, owner.entity);
  return aliasedAs(use, { kind: 'associated', of: owner, name: name.text });
}

/**
 * `type`, which `node` names, as written where it stands: a struct case's subject meeting its
 * constraint (the banner).
 */
export function asWrittenInMatch(
  written: Written,
  node: NamedType,
  type: Type | undefined,
): Type | undefined {
  if (type?.kind !== 'parameter' || type.declaration.kind !== 'TypeParameter') {
    return type;
  }
  const found = structCaseOf(treeOf(written), node);
  const form =
    found === undefined ? undefined : written.checker.typeMatches.typeMatchOf(found.alias);
  const pattern = form?.cases.find((each) => each.node === found?.node)?.pattern;
  if (
    form?.subjectParameter !== type.declaration ||
    pattern?.kind !== 'struct' ||
    found === undefined
  ) {
    return type;
  }
  const constraintNode = found.node.pattern;
  return constraintNode.kind === 'StructConstraint'
    ? { ...type, meeting: { pattern: constraintNode, constraint: pattern.constraint } }
    : type;
}

/**
 * Whether `node` stands in a type `match` case's pattern, which is matched, not used: a type, so
 * its arguments meet their constraints, but nothing there is reduced (§3.17).
 */
export function inCasePattern(written: Written, node: SyntaxNode): boolean {
  return matchPlaceOf(treeOf(written), node) === 'pattern';
}

/** `infer T` (§3.17): its type variable, in a case's pattern; anywhere else, reported. */
export function inferWritten(written: Written, node: InferType): Type {
  if (inCasePattern(written, node)) {
    return { kind: 'parameter', declaration: node.parameter };
  }
  written.checker.report(written.module, checkerDiagnostics.inferOutsideCase(node.span));
  return errorType;
}

/** Whether `declaration`'s body is a type `match` (§3.17). */
function isTypeMatchBodied(declaration: AliasDeclaration): boolean {
  return declaration.type.kind === 'TypeMatch';
}

/** Whether `node` stands inside a type `match`, where uses of one stay unreduced (the banner). */
function insideMatch(written: Written, node: SyntaxNode): boolean {
  return matchPlaceOf(treeOf(written), node) !== 'outside';
}

function treeOf({ checker, module }: Written) {
  return checker.inputs.treeOf(module);
}
