/**
 * What a `pattern` place offers: where a pattern a `case` or an `is` tests is written (§3.11),
 * read from the placeholder parse, which holds the pattern being written whole.
 *
 * - Where a pattern starts, or a struct pattern's name is written, what it may refer to, never a
 *   variable, since a bare camelCase name binds one: the variants of the type it matches, bare, of
 *   a union's members those whose name selects one member; the names of that type and of what a
 *   pattern on a union selects (§3.11, checker/types/written/pattern-types.ts), and the namespaces,
 *   which qualify a variant, a struct or a constant; against an `any` type the types a downcast may
 *   name; `_`; and the literal keywords whose literal selects a member (`true` and `false` a
 *   `Bool`, `none` an optional), all of them where the type isn't known, as a literal pattern has
 *   the matched value's own type. A variant another case of the `match` already takes whole is
 *   marked covered, for ranking.
 * - After a struct pattern item's field name, `as` or `is`; a comparison is an operator.
 * - After a case's whole pattern, once a space parts them, `if` for a guard and `as` for the whole.
 * - Anywhere else, as a rest's name or a range's end, nothing.
 */

import type { Entity } from '../../../../compiler/binder/entities.ts';
import type { Checker } from '../../../../compiler/checker/check.ts';
import type { Type } from '../../../../compiler/checker/types/type/index.ts';
import { noneType } from '../../../../compiler/checker/types/type/primitives.ts';
import { literalType, membersOf } from '../../../../compiler/checker/types/unions/unions.ts';
import {
  downcastTargetOf,
  literalMembers,
  membersNamed,
  namesOwnType,
  variantOwners,
} from '../../../../compiler/checker/types/written/pattern-types.ts';
import { casesOf } from '../../../../compiler/syntax/expressions/readings.ts';
import type { NamePattern, Pattern, StructPattern } from '../../../../compiler/syntax/patterns.ts';
import type { PatternWord } from '../../../../compiler/syntax/tokens/grammar-words.ts';
import type { SyntaxNode } from '../../../../compiler/syntax/tree/index.ts';
import { lastName } from '../../../../compiler/syntax/tree/node.ts';
import { spanIn } from '../../../../compiler/syntax/tree/positions.ts';
import type { Candidate } from '../../candidate.ts';
import { type Cursor, touchingBefore } from '../../cursor.ts';
import { expectedTypeAt } from '../../expected.ts';
import type { ParsedPlace } from '../../placeholder.ts';
import { visibleNames } from '../../visible.ts';
import { wordCandidates } from '../grammar/words.ts';
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
  const members = known ? membersOf(type) : [];
  const covered = variantsCovered(place.parsed, pattern);
  const variants = members.flatMap((member) =>
    checker.lookup
      .membersOf(module, member)
      .variants.filter(({ name }) => variantOwners(checker, members, name).length === 1)
      .map(
        (variant): Candidate => ({
          name: variant.name,
          subject: { kind: 'variant', variant, enum: member },
          ...(covered.has(variant.name) ? { covered: true } : {}),
        }),
      ),
  );
  const words = Object.entries(startWordLiterals).flatMap(([name, literal]) =>
    !known ||
    literal === undefined ||
    literalMembers(members, literal, checker.typeRules).length > 0
      ? [name]
      : [],
  );
  return [...variants, ...referringNames(cursor, type), ...wordCandidates(words)];
}

/**
 * The words a pattern starts with (`PatternWord`, syntax/tokens/grammar-words.ts, which the
 * parser's pattern table is keyed by) and `_`, each with the literal it writes, `_` none, as it
 * matches any value. A struct's value is matched through its type's name, offered where it fits, so
 * `struct{…}` is offered nowhere.
 */
const startWordLiterals = {
  _: undefined,
  true: literalType(true),
  false: literalType(false),
  none: noneType,
} satisfies Record<Exclude<PatternWord, 'struct'> | '_', Type | undefined>;

/** The visible names a pattern matching `type` may start with to refer. */
function referringNames(cursor: Cursor, type: Type | undefined): readonly Candidate[] {
  return visibleNames(cursor, (entity) => mayRefer(cursor.checker, entity, type));
}

/**
 * A namespace, which qualifies what it exports; a name of `type` itself, or, against a union, one a
 * pattern selects members by (checker/types/written/pattern-types.ts), but a variant's, offered by
 * its owner above; and against an `any` type, a type a downcast may name, one it may hold (§3.10).
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
  if (type.kind === 'union') {
    const isVariant = entity.kind === 'variant' || entity.kind === 'variants';
    return !isVariant && membersNamed(checker, entity, type.members).length > 0;
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
