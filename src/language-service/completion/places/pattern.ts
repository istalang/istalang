/**
 * What a `pattern` place offers: where a pattern a `case` or an `is` tests is written (§3.11),
 * read from the placeholder parse, which holds the pattern being written whole.
 *
 * - Where a pattern starts, or a struct pattern's name is written, what it may refer to, never a variable, since a bare camelCase name
 *   binds one: the variants of the type it matches, bare; that type's own name and the namespaces,
 *   which qualify a variant, a struct or a constant, and against an `any` type the types a downcast
 *   may name; `_`; and the literal keywords a value of the type may equal (`true` and `false` a
 *   `Bool`, `none` an optional), all of them where the type isn't known, as a literal pattern has
 *   the matched value's own type. A variant another case of the `match` already takes whole is
 *   marked covered, for ranking.
 * - After a struct pattern item's field name, `as` or `is`; a comparison is an operator.
 * - After a case's whole pattern, once a space parts them, `if` for a guard and `as` for the whole.
 * - Anywhere else, as a rest's name or a range's end, nothing.
 */

import type { Entity } from '../../../compiler/binder/entities.ts';
import type { Checker } from '../../../compiler/checker/check.ts';
import { downcastTargetOf, namesOwnType } from '../../../compiler/checker/types/named-types.ts';
import { boolType, sameType, type Type } from '../../../compiler/checker/types/type.ts';
import { optionalArgument } from '../../../compiler/checker/types/well-known.ts';
import { casesOf } from '../../../compiler/syntax/expressions/index.ts';
import { lastName } from '../../../compiler/syntax/node.ts';
import type { NamePattern, Pattern, StructPattern } from '../../../compiler/syntax/patterns.ts';
import { spanIn } from '../../../compiler/syntax/positions.ts';
import type { SyntaxNode } from '../../../compiler/syntax/tree.ts';
import type { Candidate } from '../candidate.ts';
import { type Cursor, touchingBefore } from '../cursor.ts';
import { expectedTypeAt } from '../expected.ts';
import { wordCandidates } from '../grammar/words.ts';
import type { ParsedPlace } from '../placeholder.ts';
import { visibleNames } from '../visible.ts';
import { patternStartedBy } from './matched-type.ts';

type PatternPlace = Extract<ParsedPlace, { readonly kind: 'pattern' }>;

type Parsed = PatternPlace['parsed'];

export function offerPattern(cursor: Cursor, place: PatternPlace): readonly Candidate[] {
  const { parsed } = place;
  const [holder, innermost] = parsed.chain.slice(-2);
  const started = holder === undefined ? undefined : patternStartedBy(parsed.chain, holder);
  if (started !== undefined) {
    return patternStarts(cursor, place, started);
  }
  if (holder?.kind === 'StructPattern' && innermost?.kind === 'Invalid') {
    return followsFieldName(cursor, parsed, holder, innermost) ? wordCandidates(['as', 'is']) : [];
  }
  return followsWholePattern(cursor, parsed) ? wordCandidates(['if', 'as']) : [];
}

/** Where a pattern starts, by the type it matches: the type expected there (expected.ts). */
function patternStarts(
  cursor: Cursor,
  place: PatternPlace,
  pattern: NamePattern | StructPattern,
): readonly Candidate[] {
  const { checker, module } = cursor;
  const type = expectedTypeAt(cursor, place);
  const known = type !== undefined && type.kind !== 'error';
  const covered = variantsCovered(place.parsed, pattern);
  const variants = known
    ? checker.lookup.membersOf(module, type).variants.map(
        (variant): Candidate => ({
          name: variant.name,
          subject: { kind: 'variant', variant, enum: type },
          ...(covered.has(variant.name) ? { covered: true } : {}),
        }),
      )
    : [];
  return [
    ...variants,
    ...referringNames(cursor, type),
    ...wordCandidates(
      literalKeywords.flatMap(([name, fits]) => (!known || fits(checker, type) ? [name] : [])),
    ),
  ];
}

/** The keywords a pattern may be, each with whether a value of a type may equal it. */
const literalKeywords: readonly (readonly [string, (checker: Checker, type: Type) => boolean])[] = [
  ['_', () => true],
  ['true', (_checker, type) => sameType(type, boolType)],
  ['false', (_checker, type) => sameType(type, boolType)],
  ['none', (checker, type) => optionalArgument(checker, type) !== undefined],
];

/** The visible names a pattern matching `type` may start with to refer. */
function referringNames(cursor: Cursor, type: Type | undefined): readonly Candidate[] {
  return visibleNames(cursor, (entity) => mayRefer(cursor.checker, entity, type));
}

/**
 * A namespace, which qualifies what it exports; a name of `type` itself, which matches every value
 * of it; and against an `any` type, a type a downcast may name, one it may hold, as only such a
 * type is ever inside it (§3.10; named-types.ts).
 */
function mayRefer(checker: Checker, entity: Entity, type: Type | undefined): boolean {
  if (entity.kind === 'namespace') {
    return true;
  }
  if (type === undefined) {
    return false;
  }
  if (namesOwnType(checker, entity, type)) {
    return true;
  }
  return type.kind === 'any' && downcastTargetOf(checker, entity, type).kind === 'type';
}

/**
 * The variants the unguarded cases of a `match` take whole, when `pattern` stands at its case's
 * top, past alternatives, parentheses and `as` only; none elsewhere.
 */
function variantsCovered(
  { chain }: Parsed,
  pattern: NamePattern | StructPattern,
): ReadonlySet<string> {
  const depth = chain.indexOf(pattern);
  const caseDepth = chain.slice(0, depth).findLastIndex(({ kind }) => kind === 'MatchCase');
  const match = chain[caseDepth - 1];
  const atTop = chain.slice(caseDepth + 1, depth).every(({ kind }) => wholeKinds.has(kind));
  if (match?.kind !== 'Match' || !atTop) {
    return new Set();
  }
  return new Set(
    casesOf(match)
      .filter(({ guard }) => guard === undefined)
      .flatMap(({ pattern: each }) => variantsTakenWhole(each)),
  );
}

/** Patterns matching what the pattern inside them matches. */
const wholeKinds: ReadonlySet<string> = new Set(['OrPattern', 'ParenthesizedPattern', 'AsPattern']);

/** The variants `pattern` matches every value of: by name, or with fields it only binds. */
function variantsTakenWhole(pattern: Pattern): readonly string[] {
  switch (pattern.kind) {
    case 'NamePattern':
      return [lastName(pattern.path).text];
    case 'StructPattern':
      return pattern.type !== undefined && bindsOnly(pattern)
        ? [lastName(pattern.type.path).text]
        : [];
    case 'OrPattern':
      return pattern.alternatives.flatMap(variantsTakenWhole);
    case 'ParenthesizedPattern':
    case 'AsPattern':
      return variantsTakenWhole(pattern.pattern);
    default:
      return [];
  }
}

function bindsOnly({ fields }: StructPattern): boolean {
  return fields.every(({ kind }) => kind === 'BindFieldPattern');
}

/** Whether the cursor follows an item's field name alone, as `reason` in `Rejected{reason ‸`. */
function followsFieldName(
  { before }: Cursor,
  { tree }: Parsed,
  pattern: StructPattern,
  item: SyntaxNode,
): boolean {
  const items: readonly SyntaxNode[] = pattern.fields;
  const previous = pattern.fields[items.indexOf(item) - 1];
  return (
    previous?.kind === 'BindFieldPattern' &&
    previous.alias === undefined &&
    spanIn(tree, previous.field.span).end === before?.span.end
  );
}

/**
 * Whether the cursor follows a case's whole pattern, a space between, with the parser taking the
 * name written there as the case's arm (placeholder.ts).
 */
function followsWholePattern(cursor: Cursor, { chain }: Parsed): boolean {
  const caseDepth = chain.findLastIndex(({ kind }) => kind === 'MatchCase');
  const matchCase = chain[caseDepth];
  if (matchCase?.kind !== 'MatchCase' || chain[caseDepth + 1] !== matchCase.body) {
    return false;
  }
  return touchingBefore(cursor) === undefined && isWhole(matchCase.pattern);
}

/**
 * Whether `pattern` is written whole: not one the parser found missing or broken, nor a range
 * lacking the end its `..=`, or its `..` with no start, takes (§3.11).
 */
function isWhole(pattern: Pattern): boolean {
  if (pattern.kind === 'Missing' || pattern.kind === 'Invalid') {
    return false;
  }
  return (
    pattern.kind !== 'RangePattern' ||
    pattern.end !== undefined ||
    (!pattern.isInclusive && pattern.start !== undefined)
  );
}
