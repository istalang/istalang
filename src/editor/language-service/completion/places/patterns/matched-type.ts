/**
 * The type a pattern being written is matched against (§3.11), and the fields a struct or call
 * pattern names, as checking the placeholder parse records them (placeholder-check.ts): the parse
 * holds the pattern being written whole, and the checker's one pattern walk records what each
 * pattern and part was matched against, read down from the `match` subject, the `is` operand or the
 * parameter whose pattern it is, through each union member a pattern selects.
 *
 * Two places nothing records, both read by the checker's own rules:
 * - A parameter's pattern of a function with no body yet, which no body walks: it matches the
 *   parameter's type, which its head names (§3.3), and names that type's fields.
 * - A `struct{…}` pattern against a union, which selects the shape member having its items' fields
 *   (`kindMembers`): the walk counts the item being written, whose name no member has yet, so it
 *   selects none; its other items select the member whose fields it names.
 */

import type { Checker } from '../../../../../compiler/checker/check.ts';
import type { FieldsPattern } from '../../../../../compiler/checker/surface/checked-pattern.ts';
import type { FieldMember, Type } from '../../../../../compiler/checker/types/type/index.ts';
import { kindMembers } from '../../../../../compiler/checker/types/written/pattern-types.ts';
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
  const body = bodyHolding(cursor, parsed, pattern);
  return body === undefined
    ? bodilessParameterType(cursor, parsed, pattern)
    : body.matchedTypeOf(pattern);
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
  const body = bodyHolding(cursor, parsed, pattern);
  const recorded = body?.patternFieldsOf(pattern);
  if (recorded !== undefined) {
    return recorded;
  }
  const checker = placeholderChecker(cursor, parsed.tree);
  const struct =
    body === undefined
      ? bodilessParameterType(cursor, parsed, pattern)
      : shapeWritten(checker, parsed, pattern, body.matchedTypeOf(pattern));
  return (struct === undefined ? undefined : checker.fieldsOf(struct)) ?? [];
}

/** The body holding `node` of `parsed`, as the placeholder parse checks it. */
function bodyHolding(cursor: Cursor, parsed: Parsed, node: SyntaxNode) {
  return placeholderChecker(cursor, parsed.tree).lookup.bodyHolding(cursor.module, node);
}

/** The type of the parameter whose pattern `pattern` is, of a function with no body. */
function bodilessParameterType(
  cursor: Cursor,
  parsed: Parsed,
  pattern: SyntaxNode,
): Type | undefined {
  const { chain } = parsed;
  const parameter = chain[chain.indexOf(pattern) - 1];
  const holder = parameter === undefined ? undefined : chain[chain.indexOf(parameter) - 1];
  if (parameter?.kind !== 'Parameter' || holder?.kind !== 'FunctionDeclaration') {
    return undefined;
  }
  const declared = placeholderChecker(cursor, parsed.tree).parametersOf(holder);
  return declared.find(({ node }) => node === parameter)?.type;
}

/** The shape member of `matched`, a union, that `pattern`'s other items select, `struct{…}`. */
function shapeWritten(
  checker: Checker,
  parsed: Parsed,
  pattern: FieldsPattern,
  matched: Type | undefined,
): Type | undefined {
  if (pattern.kind !== 'StructPattern' || pattern.type !== undefined || matched?.kind !== 'union') {
    return undefined;
  }
  const written = parsed.chain.at(-1);
  const fields = pattern.fields.flatMap((item) =>
    item.kind === 'Invalid' || item.field === written ? [] : [item.field.text],
  );
  const [only, ...others] = kindMembers(checker, { kind: 'shape', fields }, matched.members);
  return others.length === 0 ? only : undefined;
}
