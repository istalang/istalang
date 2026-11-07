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

import { expectedFunction } from '../../../../compiler/checker/types/fitting/expected.ts';
import type { Type } from '../../../../compiler/checker/types/type/index.ts';
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
  /** Whether the place writes a value or a pattern, which a call or a variant's braces may open. */
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

/**
 * Accepting a callable named `name`: its call, the cursor between the parentheses, and its
 * signature shown; in a pattern, a variant's call pattern, whose fields' names are listed next. A
 * name is an identifier, so it holds nothing a snippet escapes.
 */
export function called(presenting: Presenting, name: string): Partial<Shown> {
  const { writesValue, follows, place } = presenting;
  return writesValue && follows !== '('
    ? {
        insert: { kind: 'snippet', snippet: `${name}($0)` },
        next: place.kind === 'pattern' ? 'completion' : 'signatureHelp',
      }
    : { commit: ['('] };
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
  const { place, expected } = presenting;
  const namesValue =
    place.kind !== 'pattern' &&
    expectedFunction(expected) !== undefined &&
    !results.some((result) => fitsExpected(presenting, result));
  return namesValue ? { commit: ['('] } : called(presenting, name);
}

/**
 * Accepting a variant: with fields, its call, unless braces after it already build it, `Ok{…}`; a
 * variant without fields is a value, its name alone (§3.11).
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
