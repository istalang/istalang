/**
 * Where a completion request stands: the checked module, the offset, the character whose typing
 * asked (absent when the editor invoked completion), and the tokens right there, read once for
 * every place and provider; and the std modules the app ships, which an import may name though
 * the program holds only those it loaded.
 *
 * A name being written may still spell a keyword (`in` on the way to `includes`), so it counts as
 * a name whatever the scanner made of it.
 */

import { isKeyword, type Token } from '../../compiler/syntax/tokens.ts';
import type { CheckedModule } from '../checked-module.ts';
import { codeTokensOf } from '../tokens.ts';

export interface Cursor extends CheckedModule {
  readonly offset: number;
  readonly trigger: string | undefined;
  /** The name the cursor is in or right after, if any. */
  readonly name: Token | undefined;
  /** The token before that name, or before the cursor when it writes none. */
  readonly before: Token | undefined;
  /** The names of the std modules an import may name, loaded or not. */
  readonly stdModules: readonly string[];
}

/**
 * The cursor at `offset` of `checked`, asked for by typing `trigger`, if any, where an import may
 * name `stdModules`.
 */
export function cursorAt(
  checked: CheckedModule,
  offset: number,
  trigger: string | undefined,
  stdModules: readonly string[],
): Cursor {
  const tokens = codeTokensOf(checked.tree);
  const last = tokens.findLastIndex(({ span }) => span.start < offset);
  const written = tokens[last];
  const isName =
    written !== undefined &&
    written.span.end >= offset &&
    (written.kind === 'identifier' || isKeyword(written.kind));
  return {
    ...checked,
    offset,
    trigger,
    name: isName ? written : undefined,
    before: isName ? tokens[last - 1] : written,
    stdModules,
  };
}

/** The token right before what the cursor writes; undefined when space parts them. */
export function touchingBefore({ name, before, offset }: Cursor): Token | undefined {
  return before?.span.end === (name?.span.start ?? offset) ? before : undefined;
}
