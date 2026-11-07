/**
 * What every subject's presenter works from and says (present.ts): the request, read once, and
 * an item's own part of the list, before the list ranks it.
 *
 * What accepting a callable or a variant with fields writes depends on the place: only where a
 * value or a pattern is written does a name open its call, a variant's as a function's (§3.11),
 * never in an import, a type or a declared name; an annotation is a struct's value, in braces.
 * Where a function value is expected that the call's result doesn't fit, a function or a variant
 * with fields is that value, its name alone (§3.14). A `(` or `{` already after the cursor on its
 * line is the call's or the literal's own, so the name is written alone there; one on a later line
 * starts a statement of its own (a tuple, a block).
 */

import type { VariantMember } from '../../../../compiler/checker/check.ts';
import { bindValue, isBinding } from '../../../../compiler/checker/resolution/choosing/binding.ts';
import { expectedFunction } from '../../../../compiler/checker/types/fitting/expected.ts';
import { sameType } from '../../../../compiler/checker/types/identity/identity.ts';
import type { Type } from '../../../../compiler/checker/types/type/index.ts';
import { errorType } from '../../../../compiler/checker/types/type/primitives.ts';
import {
  type FunctionDeclaration,
  hasDefault,
  isRestField,
  typeParametersOf,
} from '../../../../compiler/syntax/declarations/index.ts';
import { isMethod } from '../../../../compiler/syntax/declarations/methods.ts';
import type { TokenKind } from '../../../../compiler/syntax/tokens/index.ts';
import { codeTokensOf } from '../../reading/tokens.ts';
import type { Cursor } from '../cursor.ts';
import { expectedTypeAt } from '../expected.ts';
import type { Place, PlaceKind } from '../place.ts';
import type { Completion, RankGroup } from './item.ts';

/** A request as presenters read it. */
export interface Presenting {
  readonly cursor: Cursor;
  readonly place: Place;
  /** Whether the place writes a value or a pattern, which a call or a struct's braces may open. */
  readonly writesValue: boolean;
  /**
   * The kind of the token after the name being written on its line, which may open its call or
   * braces.
   */
  readonly follows: TokenKind | undefined;
  /** The type expected of what is written at the place (../expected.ts). */
  readonly expected: Type | undefined;
}

/** What a presenter says of one item: everything but its name and its place in the list. */
export interface Shown extends Omit<Completion, 'name' | 'rank' | 'preselect'> {
  /** Where a name a scope offers comes from. */
  readonly group?: RankGroup;
  /** Its order within its group; absent counts as 0. */
  readonly priority?: number;
  /** Its place among kin its declaration orders (`Rank.order`). */
  readonly order?: number;
  /**
   * The types of the values accepting it writes: a variable's, a call's result, a variant's enum.
   */
  readonly gives?: readonly Type[];
}

const valuePlaces: ReadonlySet<PlaceKind> = new Set<PlaceKind>([
  'grammar',
  'callArgument',
  'member',
  'literalField',
  'pattern',
  'annotation',
]);

/** The request at `cursor` in `place`, as presenters read it. */
export function presentingAt(cursor: Cursor, place: Place): Presenting {
  const end = cursor.name?.span.end ?? cursor.offset;
  const next = codeTokensOf(cursor.tree).find(({ span }) => span.start >= end);
  const onLine =
    next !== undefined && !cursor.tree.source.text.slice(end, next.span.start).includes('\n');
  return {
    cursor,
    place,
    writesValue: valuePlaces.has(place.kind),
    follows: onLine ? next.kind : undefined,
    expected: expectedTypeAt(cursor, place),
  };
}

/**
 * Whether a value of `found` fits the type expected at the place. An erroneous type fits nothing,
 * and `Never`, which fits everywhere, tells nothing about where it belongs.
 */
export function fitsExpected({ cursor, expected }: Presenting, found: Type): boolean {
  return (
    expected !== undefined &&
    expected.kind !== 'error' &&
    found.kind !== 'error' &&
    !(found.kind === 'primitive' && found.name === 'Never') &&
    cursor.checker.fitOf(found, expected) !== undefined
  );
}

/** A parameter as a function value's type binds it (§3.14): its type, and how it may be left. */
interface ValueParameter {
  readonly type: Type;
  readonly hasDefault: boolean;
  readonly isRest: boolean;
}

/**
 * Where a function value is expected, the expected type when a function taking `parameters` and
 * giving `result` fits it as a value (§3.14), as checking binds one: by position, trailing
 * parameters left to their defaults and a rest taken as one array, each matching the expected
 * parameter exactly and the result fitting; nothing otherwise, a generic one among them, whose
 * instance only checking finds.
 */
function givenAsValue(
  presenting: Presenting,
  parameters: readonly ValueParameter[],
  result: Type,
): readonly Type[] {
  const { cursor, expected } = presenting;
  const shape = expectedFunction(expected);
  if (shape === undefined || expected === undefined || shape.pack !== undefined) {
    return [];
  }
  const slots = parameters.map((parameter) => ({
    hasDefault: parameter.hasDefault,
    rest: parameter.isRest ? { kind: 'array' as const } : undefined,
  }));
  const binding = bindValue(
    slots,
    shape.parameters.map(() => ({})),
  );
  const matches =
    isBinding(binding) &&
    binding.every(
      (bound, index) =>
        bound?.kind !== 'argument' ||
        sameType(
          shape.parameters[bound.index]?.type ?? errorType,
          parameters[index]?.type ?? errorType,
        ),
    ) &&
    cursor.checker.fitOf(result, shape.result) !== undefined;
  return matches ? [expected] : [];
}

/** `givenAsValue` of a declared function: none for a generic one or a method. */
export function functionGivenAsValue(
  presenting: Presenting,
  declaration: FunctionDeclaration,
): readonly Type[] {
  const { checker } = presenting.cursor;
  if (typeParametersOf(declaration.typeParameters).length > 0 || isMethod(declaration)) {
    return [];
  }
  const parameters = checker.parametersOf(declaration).map(({ node, type }) => ({
    type,
    hasDefault: node.defaultValue !== undefined,
    isRest: node.isRest,
  }));
  return givenAsValue(presenting, parameters, checker.resultOf(declaration));
}

/** `givenAsValue` of a variant's constructor at its enum's type `enumType` (§3.11). */
export function variantGivenAsValue(
  presenting: Presenting,
  variant: VariantMember,
  enumType: Type,
): readonly Type[] {
  const parameters = variant.fields.map(({ type, declared }) => ({
    type,
    hasDefault: declared !== undefined && hasDefault(declared.node),
    isRest: declared !== undefined && isRestField(declared.node),
  }));
  return parameters.length === 0 ? [] : givenAsValue(presenting, parameters, enumType);
}

/**
 * Accepting a callable named `name`: its call, the cursor between the parentheses, and its
 * signature shown; in a pattern, a variant's call pattern, whose fields' names are listed next. A
 * name is an identifier, so it holds nothing a snippet escapes.
 */
export function called(presenting: Presenting, name: string): Partial<Shown> {
  const { writesValue, follows } = presenting;
  return writesValue && follows !== '('
    ? {
        insert: { kind: 'snippet', snippet: `${name}($0)` },
        next: writesPattern(presenting) ? 'completion' : 'signatureHelp',
      }
    : { commit: ['('] };
}

/** Whether the place writes a pattern: one starting, or a variant qualified in one. */
function writesPattern({ place }: Presenting): boolean {
  return place.kind === 'pattern' || (place.kind === 'member' && place.names === 'variant');
}

/**
 * Accepting a function or a variant with fields, either of which may be named as a value (§3.14):
 * where a function value is expected that none of `results`, what its call gives, fits, the name
 * alone; else its call.
 */
export function calledOrNamed(
  presenting: Presenting,
  name: string,
  results: readonly Type[],
): Partial<Shown> {
  const namesValue =
    !writesPattern(presenting) &&
    expectedFunction(presenting.expected) !== undefined &&
    !results.some((result) => fitsExpected(presenting, result));
  return namesValue ? { commit: ['('] } : called(presenting, name);
}

/**
 * Accepting a variant: with fields, its call, unless a `{` follows the name, whose text is then
 * left as written; a variant without fields is a value, its name alone (§3.11).
 */
export function constructed(
  presenting: Presenting,
  name: string,
  { hasFields, enums }: { readonly hasFields: boolean; readonly enums: readonly Type[] },
): Partial<Shown> {
  return hasFields && presenting.follows !== '{' ? calledOrNamed(presenting, name, enums) : {};
}

/** Accepting a struct as an annotation's value: with fields, its braces, listed next (§3.16). */
export function annotationValue(
  { writesValue, follows }: Presenting,
  name: string,
  hasFields: boolean,
): Partial<Shown> {
  return writesValue && hasFields && follows !== '{'
    ? { insert: { kind: 'snippet', snippet: `${name}{$0}` }, next: 'completion' }
    : {};
}

/** An item's documentation, where the docstring is there. */
export function documented(doc: string | undefined): Pick<Shown, 'documentation'> {
  return doc === undefined ? {} : { documentation: doc };
}
