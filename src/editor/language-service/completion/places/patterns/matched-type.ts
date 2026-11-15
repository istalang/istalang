/**
 * The type a pattern being written is matched against (§3.11), and the fields a struct or call
 * pattern names, as checking the placeholder parse records them (placeholder-check.ts): the parse
 * holds the pattern being written whole, and the checker's one pattern walk records what each
 * pattern and part was matched against, read down from the `match` subject, the `is` operand or the
 * parameter whose pattern it is, through each union member a pattern selects.
 */

import type { FieldsPattern } from '../../../../../compiler/checker/surface/checked-pattern.ts';
import type { FieldMember, Type } from '../../../../../compiler/checker/types/type/index.ts';
import {
  type HeadedPattern,
  isTakingApart,
  patternHead,
} from '../../../../../compiler/syntax/patterns.ts';
import type { SyntaxNode } from '../../../../../compiler/syntax/tree/index.ts';
import type { Cursor } from '../../cursor.ts';
import type { ParsedPlace } from '../../placeholder.ts';
import { placeholderChecker } from '../../placeholder-check.ts';
import { holderIn } from '../grammar/chain.ts';

type Parsed = ParsedPlace['parsed'];

/**
 * The pattern the placeholder's name starts, its holder in `chain` being `holder`: a bare name,
 * or the struct or call pattern it names (`case Ok‸{value}`, `case Ok‸(v)`); undefined elsewhere.
 */
export function patternStartedBy(
  chain: readonly SyntaxNode[],
  holder: SyntaxNode,
): HeadedPattern | undefined {
  if (holder.kind === 'NamePattern') {
    return holder;
  }
  const pattern = holderIn(chain, holder);
  return pattern !== undefined && isTakingApart(pattern) && patternHead(pattern) === holder
    ? pattern
    : undefined;
}

/** The type `pattern`, of `parsed`, is matched against; undefined where it isn't known. */
export function matchedTypeOf(
  cursor: Cursor,
  parsed: Parsed,
  pattern: HeadedPattern,
): Type | undefined {
  return bodyHolding(cursor, parsed, pattern)?.matchedTypeOf(pattern);
}

/**
 * The fields a struct pattern's items or a call pattern's arguments name: its struct's, or its
 * variant's; none where it names neither.
 */
export function fieldsMatchedBy(
  cursor: Cursor,
  parsed: Parsed,
  pattern: FieldsPattern,
): readonly FieldMember[] {
  return bodyHolding(cursor, parsed, pattern)?.patternFieldsOf(pattern) ?? [];
}

/** The body holding `node` of `parsed`, as the placeholder parse checks it. */
function bodyHolding(cursor: Cursor, parsed: Parsed, node: SyntaxNode) {
  return placeholderChecker(cursor, parsed.tree).lookup.bodyHolding(cursor.module, node);
}
