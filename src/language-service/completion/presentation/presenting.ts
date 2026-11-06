/**
 * What every subject's presenter works from and says (present.ts): the request, read once, and
 * an item's own part of the list, before the list ranks it.
 *
 * What accepting a callable or a variant with fields writes depends on the place alone: only
 * where a value or a pattern is written does a name open its parentheses or braces, never in an
 * import, a type or a declared name; an annotation is a struct's value. A `(` or `{` already after
 * the cursor on its line is the call's or the literal's own, so the name is written alone there;
 * one on a later line starts a statement of its own (a tuple, a block).
 */

import type { Type } from '../../../compiler/checker/types/type/index.ts';
import type { TokenKind } from '../../../compiler/syntax/tokens.ts';
import { codeTokensOf } from '../../tokens.ts';
import type { Cursor } from '../cursor.ts';
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
  };
}

/**
 * Accepting a callable named `name`: its call, the cursor between the parentheses, and its
 * signature shown. A name is an identifier, so it holds nothing a snippet escapes.
 */
export function called({ writesValue, follows }: Presenting, name: string): Partial<Shown> {
  return writesValue && follows !== '('
    ? { insert: { kind: 'snippet', snippet: `${name}($0)` }, next: 'signatureHelp' }
    : { commit: ['('] };
}

/** Accepting a variant: with fields, its literal's braces, whose fields are listed next. */
export function constructed(
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
