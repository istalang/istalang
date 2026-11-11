/**
 * The marks of code as types (proposal 8, Rules 1–4): what a function type's mark slot and a
 * future's `K` hold. A mark is a literal of the prelude's `Mark`: `"live"` or `"ista"`, the
 * two kinds, `Persistence`'s members, or `"simple"`, an unmarked function's, which either kind may
 * call; a generic one's a mark parameter, as the checker knows one by what its union holds
 * (types/properties/qualifiers.ts).
 *
 * A function's kind is its head's, never implied (Rule 2): a word, or the mark parameter it names
 * (`M fn`, `Self.Mode fn`), else simple. A function made from a declaration's fields, a struct's
 * defaults or a variant's constructor, has no head: it makes its owner's values, so it is of the
 * kind its fields' written types hold. A field whose type its default gives adds nothing, since
 * that type is found by checking the function: its default is judged there, of that kind.
 * Resolving what a head names reads the bindings, so the checker keeps each answer as an entry
 * (`Checker.kindOf`).
 */

import {
  marks,
  type Persistence,
  persistences,
} from '../../../../foundation/language/well-known/index.ts';
import {
  declaredFunctionName,
  isFieldsFunction,
} from '../../../syntax/declarations/field-defaults.ts';
import type {
  Declaration,
  FunctionDeclaration,
  TypeParameter,
} from '../../../syntax/declarations/index.ts';
import type { FunctionQualifiers } from '../../../syntax/tokens/modifiers.ts';
import { parentOf, type SyntaxNode } from '../../../syntax/tree/index.ts';
import type { Checker } from '../../check.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { Fitting } from '../fitting/fit/index.ts';
import type { Type } from './index.ts';
import { membersOf } from './index.ts';
import { markOrder, sameMark } from './mark-orders.ts';
import { markType } from './primitives.ts';

/** The mark of unmarked code and function types (proposal 8, Rule 2): `"simple"`. */
export const simpleMark: Type = markType('simple');

/** Whether `mark` is `"simple"`, which code of every mark may call. */
export function isSimpleMark(mark: Type): boolean {
  return mark.kind === 'literal' && mark.value === 'simple';
}

/** What reading a kind asks of the checker, which keeps each answer as an entry of its own. */
export type KindLookup = Pick<Checker, 'kindOf'>;

/** What finding a function's kind looks up: the mark its head names, or what its fields hold. */
export type KindNames = Pick<
  CheckerContext,
  'moduleOf' | 'resolveType' | 'valueKindsOf' | 'fitting' | 'inputs'
>;

/**
 * Whether a function of kind `callee` may be called, or fit, where code of kind `code` calls it
 * (proposal 8, Rules 2 and 4): by `Mark`'s order (mark-orders.ts), the kinds compared by
 * `same`, which may infer them.
 */
export function kindAdmits(
  code: Type,
  callee: Type,
  same: (expected: Type, found: Type) => boolean,
): boolean {
  return markOrder.below(callee, code, same);
}

/**
 * The one kind the written field types of `declaration`, a fields function, hold; simple where they
 * hold none, or both kinds, which the owner is refused for where its fields are judged.
 */
function fieldsKindOf(names: KindNames, declaration: FunctionDeclaration): Type {
  const module = names.moduleOf(declaration);
  const kinds = declaration.parameters.flatMap((field) =>
    field.kind === 'Parameter' && field.type !== undefined
      ? names.valueKindsOf(names.resolveType(module, field.type))
      : [],
  );
  const [first] = kinds;
  return first !== undefined && kinds.every((kind) => sameMark(kind, first)) ? first : simpleMark;
}

/** Which of the two kinds `kind` is; undefined for either, or a kind variable. */
export function persistenceOf(kind: Type): Persistence | undefined {
  return persistences.find((each) => kind.kind === 'literal' && kind.value === each);
}

/** The kind a head writes; undefined where it writes none. */
export function writtenKindOf(qualifiers: FunctionQualifiers): Type | undefined {
  return qualifiers.kind === undefined ? undefined : markType(qualifiers.kind);
}

/** The kind of `declaration`'s code (the banner), as the checker keeps it. */
export function kindOfFunction(lookup: KindLookup, declaration: FunctionDeclaration): Type {
  return writtenKindOf(declaration.qualifiers) ?? lookup.kindOf(declaration);
}

/**
 * The kind of `declaration`'s code (the banner): its head's word, else the mark it names, else
 * simple; what the checker keeps (`kindOfFunction`).
 */
export function functionKindOf(names: KindNames, declaration: FunctionDeclaration): Type {
  const written = writtenKindOf(declaration.qualifiers);
  if (written !== undefined) {
    return written;
  }
  if (isFieldsFunction(declaration)) {
    return fieldsKindOf(names, declaration);
  }
  // A name that is no mark is reported where the signature is (rules/kinds/signature-kinds.ts);
  // its function is then simple, so its calls report nothing more.
  return namedMarkOf(names, declaration) ?? simpleMark;
}

/**
 * The mark `declaration`'s head names (`M fn`), where it names one: a mark parameter, or on a
 * trait's requirement a member-bounded associated type of its own `Self` (`Self.Mode fn`);
 * undefined for a head naming none, or anything else.
 */
export function namedMarkOf(
  names: Pick<KindNames, 'moduleOf' | 'resolveType' | 'fitting' | 'inputs'>,
  declaration: FunctionDeclaration,
): Type | undefined {
  if (declaration.mark === undefined) {
    return undefined;
  }
  const module = names.moduleOf(declaration);
  const named = names.resolveType(module, declaration.mark);
  if (!isMarkVariable(names, named)) {
    return undefined;
  }
  const trait = parentOf(names.inputs.treeOf(module), declaration);
  const ownSelf =
    named.kind !== 'associated' ||
    (trait?.kind === 'TraitDeclaration' &&
      named.of.kind === 'parameter' &&
      named.of.declaration === trait);
  return ownSelf ? named : undefined;
}

/** How a message names what the kind parameter `parameter` is the kind of: its declaration. */
export function kindHolderName(
  lookup: Pick<CheckerContext, 'moduleOf' | 'inputs'>,
  parameter: TypeParameter,
): string {
  const owner = declaringOf(lookup, parameter);
  if (owner === undefined) {
    return `'${parameter.name.text}'`;
  }
  return owner.kind === 'FunctionDeclaration'
    ? `'${declaredFunctionName(owner)}'`
    : `'${owner.name.text}'`;
}

/**
 * Whether the kind `kind` is one of the two: `live`, `ista`, or a kind variable standing for one
 * (`K in Persistence`, or an associated type `type Mode in Persistence`).
 */
export function isOneKind(lookup: QualifierLookup, kind: Type): boolean {
  return (
    persistenceOf(kind) !== undefined ||
    (kind.kind === 'parameter' &&
      kind.declaration.kind === 'TypeParameter' &&
      standsForOneKind(lookup, kind.declaration)) ||
    isBoundTo(lookup, kind, persistences)
  );
}

/**
 * Whether `type` is a mark variable: a mark parameter, `K in Persistence` or `M in Mark`, or an
 * associated type bounded to marks, `type Mode in Persistence` (§3.10).
 */
export function isMarkVariable(lookup: QualifierLookup, type: Type): boolean {
  return (
    (type.kind === 'parameter' &&
      type.declaration.kind === 'TypeParameter' &&
      isMarkParameter(lookup, type.declaration)) ||
    isBoundTo(lookup, type, marks)
  );
}

/** Whether `type` is an associated type bounded to one member of `members` (§3.10). */
function isBoundTo(lookup: QualifierLookup, type: Type, members: readonly string[]): boolean {
  const union = type.kind === 'associated' ? lookup.fitting.memberUnionOf(type) : undefined;
  return (
    union !== undefined &&
    membersOf(union).every(
      (member) => member.kind === 'literal' && members.some((each) => each === member.value),
    )
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

/** What knowing a qualifier parameter asks of the checker, which keeps each answer. */
export interface QualifierLookup {
  readonly fitting: Pick<Fitting, 'qualifierOf' | 'memberUnionOf'>;
}

/** Whether `parameter` stands for a mark: `M in Mark`, `K in Persistence`, or a subset. */
export function isMarkParameter(lookup: QualifierLookup, parameter: TypeParameter): boolean {
  return lookup.fitting.qualifierOf(parameter)?.order === markOrder;
}

/** Whether `parameter` stands for one of the two kinds: `K in Persistence`, or a subset. */
export function standsForOneKind(lookup: QualifierLookup, parameter: TypeParameter): boolean {
  const qualifier = lookup.fitting.qualifierOf(parameter);
  return qualifier?.order === markOrder && !qualifier.mayBeBottom;
}
