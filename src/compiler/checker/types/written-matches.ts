/**
 * Type `match`es as written (§3.17), what only resolving a written type decides:
 *
 * - Inside a type `match`, a use of a type `match` alias stays unreduced (type-match.ts): a case's
 *   type is resolved once with its alias's parameters open, and a use substitutes them.
 * - `infer` stands only in a case's pattern; anywhere else it is reported.
 * - A use no case matches, its arguments all known, is the compile error where it is written.
 * - The subject written as a type parameter, in the type of a `case struct …:`, stands for a member
 *   meeting that constraint, so its keys and fields are known there as a constrained parameter's.
 */

import type { Entity } from '../../binder/entities.ts';
import { type ModuleId, programModule } from '../../program/program.ts';
import type { TypeAliasDeclaration } from '../../syntax/declarations.ts';
import type { SyntaxNode } from '../../syntax/tree.ts';
import type { InferType, NamedType } from '../../syntax/types.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { aliasedAs, errorType, type NominalDeclaration, type Type } from './type.ts';
import { matchPlaceOf, matchUse, structCaseOf } from './type-match.ts';
import { isKnown } from './type-parts.ts';
import { typeText } from './type-text.ts';

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
  const alias = typeMatchAliasOf(entity);
  if (alias === undefined || matchPlaceOf(treeOf(written), node) === 'outside') {
    return undefined;
  }
  const typeArguments = argumentsFor(alias) ?? [];
  const use = matchUse(alias, typeArguments);
  return aliasedAs(use, { kind: 'alias', declaration: alias, arguments: typeArguments });
}

/**
 * `type`, which `node` names, as written where it stands: a use no case matches reported, and the
 * error type for it; a struct case's subject meeting its constraint (the banner).
 */
export function asWrittenInMatch(
  written: Written,
  node: NamedType,
  type: Type | undefined,
): Type | undefined {
  if (type?.kind === 'match' && type.arguments.every(isKnown)) {
    written.checker.report(
      written.module,
      checkerDiagnostics.noCaseMatches(node.span, typeText(type)),
    );
    return errorType;
  }
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
 * Whether `node` stands in a type `match` case's pattern, which is matched, not used: its type
 * arguments meet their constraints in any type it matches, so none is checked there (§3.17).
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

/** The alias `entity` declares when its body is a type `match` (§3.17); else undefined. */
function typeMatchAliasOf(entity: Entity): TypeAliasDeclaration | undefined {
  return entity.kind === 'type' &&
    entity.declaration.kind === 'TypeAliasDeclaration' &&
    entity.declaration.type.kind === 'TypeMatch'
    ? entity.declaration
    : undefined;
}

function treeOf({ checker, module }: Written) {
  return programModule(checker.program, module).tree;
}
