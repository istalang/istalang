/**
 * The type expected where a cursor writes a value (§4.2, §11.3): it ranks what fits first, and it
 * alone admits bare variants, those of the enum expected.
 *
 * - The checker stays the one home of expectations: a place read from the placeholder parse
 *   (placeholder.ts) expects what the checker of that parse (placeholder-check.ts) expects of the
 *   placeholder name. So a field's value, an annotated declaration, a `return`, a comparison, an
 *   element or a spread each expect what the language says, with no rule repeated here. A name
 *   already written parses alike with or without the placeholder, so the program's own checker
 *   answers for it, unchecked again.
 * - A place is asked once per request, however many providers ask (memoized by the place).
 */

import type { Entity } from '../../../compiler/binder/entities.ts';
import type { Checker, VariantMember } from '../../../compiler/checker/check.ts';
import {
  enumsExpected,
  plainResultExpected,
  sameNominal,
} from '../../../compiler/checker/types/fitting/expected.ts';
import type { Type } from '../../../compiler/checker/types/type/index.ts';
import { membersOf } from '../../../compiler/checker/types/type/index.ts';
import { typeText } from '../../../compiler/checker/types/type/type-text.ts';
import { futuresOf } from '../../../compiler/checker/types/type/well-known.ts';
import type { Expression } from '../../../compiler/syntax/expressions/index.ts';
import { literalNaming } from '../../../compiler/syntax/expressions/literals/built-types.ts';
import { nodesAt, type SyntaxNode, type SyntaxTree } from '../../../compiler/syntax/tree/index.ts';
import type { Identifier } from '../../../compiler/syntax/tree/node.ts';
import { spanIn } from '../../../compiler/syntax/tree/positions.ts';
import { type Handlers, handlerOf } from '../../../foundation/structures/kind-table.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { identifierAt } from '../reading/identifier-at.ts';
import type { Candidate } from './candidate.ts';
import type { Cursor } from './cursor.ts';
import type { Place } from './place.ts';
import type { ParsedPlace } from './placeholder.ts';
import { placeholderChecker } from './placeholder-check.ts';
import { holderIn } from './places/grammar/chain.ts';
import type { MemberPlace } from './places/member.ts';
import { matchedTypeOf, patternStartedBy } from './places/patterns/matched-type.ts';
import { visibleNames } from './visible.ts';

/** The type expected of what `cursor` writes at `place`; undefined where nothing is expected. */
export function expectedTypeAt(cursor: Cursor, place: Place): Type | undefined {
  return memo(expectations, place, () => handlerOf(expecters, place)(cursor, place));
}

/**
 * The variants that may be written bare at `place`: those of the enums a value expected there may
 * be a variant of, its own and those inside its optionals, outermost first, as checking chooses
 * among them (§11.3); a name two of them share is the outermost's. Where a function value is
 * expected, the variants with fields of the enum its result is, their constructors (§6.4). Where a
 * type is expected that checking could not tell (an error, reported where it is written), any
 * variant may be the one meant, so the visible ones all stand.
 */
export function expectedVariants(cursor: Cursor, place: Place): readonly Candidate[] {
  const expected = expectedTypeAt(cursor, place);
  if (expected?.kind === 'error') {
    return visibleNames(cursor, isVariantEntity);
  }
  const result = plainResultExpected(expected, futuresOf(cursor.checker));
  const candidates = [
    ...variantsOf(cursor.checker, expected, () => true),
    ...variantsOf(cursor.checker, result, (variant) => variant.fields.length > 0),
  ];
  return candidates.filter(
    ({ name }, index) => candidates.findIndex((each) => each.name === name) === index,
  );
}

/** The variants `expected`'s enums have that `admits` lets stand, as bare names. */
function variantsOf(
  checker: Checker,
  expected: Type | undefined,
  admits: (variant: VariantMember) => boolean,
): readonly Candidate[] {
  return enumsExpected(expected).flatMap((declaration) => {
    const enumType = sameNominal(expected, declaration);
    return enumType === undefined
      ? []
      : (checker.variantsOf(enumType) ?? []).filter(admits).map(
          (variant): Candidate => ({
            name: variant.name,
            subject: { kind: 'variant', variant, enum: enumType },
          }),
        );
  });
}

/**
 * The literals of the literal types a value expected at `place` may be (§4.3), a key naming a field
 * among them (§5.2 Key types): the expected type's own, or its union members', each spelled as
 * source writes it. `true` and `false` are words already offered.
 */
export function expectedLiterals(cursor: Cursor, place: Place): readonly Candidate[] {
  const expected = expectedTypeAt(cursor, place);
  return (expected === undefined ? [] : membersOf(expected)).flatMap((member): Candidate[] =>
    member.kind === 'literal' && typeof member.value !== 'boolean'
      ? [{ name: typeText(member), subject: { kind: 'literal', type: member } }]
      : [],
  );
}

/** Whether `candidate` is a bare variant name, which only an expected enum admits (§5.3). */
export function isBareVariant({ subject }: Candidate): boolean {
  return subject.kind === 'entity' && isVariantEntity(subject.entity);
}

function isVariantEntity({ kind }: Entity): boolean {
  return kind === 'variants';
}

const expectations = new WeakMap<Place, Type | undefined>();

const nothingExpected = () => undefined;

/**
 * What each kind of place expects: a value is written where the grammar or an argument is, and a
 * pattern starts where its matched value is tested.
 */
const expecters: Handlers<Cursor, Place, [], Type | undefined> = {
  grammar: expectedOfValue,
  stringText: expectedOfString,
  callArgument: expectedOfValue,
  member: expectedOfQualified,
  literalField: nothingExpected,
  nothing: nothingExpected,
  type: nothingExpected,
  declaredName: nothingExpected,
  pattern: expectedOfPatternStart,
  patternField: nothingExpected,
  import: nothingExpected,
  annotation: nothingExpected,
};

/**
 * After a type's name, where a value is written, what the checker expects of the static or variant
 * named through it, as of a name written alone (§6.4): the program's tree holds that member access
 * as it stands. A value's member has no expectation of its own to rank by.
 */
function expectedOfQualified(
  cursor: Cursor,
  { names, head, access }: MemberPlace,
): Type | undefined {
  const { checker, module } = cursor;
  const qualified = names === 'value' && head !== undefined ? access : undefined;
  return qualified && checker.lookup.bodyHolding(module, qualified)?.expectedOf(qualified);
}

/**
 * What the checker expects of the value written at `place`: of a call's argument, what its
 * parameter will be once the call is whole, where only one function can be meant.
 */
function expectedOfValue(cursor: Cursor, { parsed }: ParsedPlace): Type | undefined {
  const placeholder = parsed.chain.at(-1);
  if (placeholder?.kind !== 'Identifier') {
    return undefined;
  }
  const written = writtenName(cursor);
  const value = valueNamedBy(parsed.chain, placeholder);
  const checked =
    written === undefined
      ? expectedOfPlaceholder(cursor, parsed.tree, value)
      : expectedOfWritten(cursor, written);
  return checked;
}

/**
 * What the checker expects of the String literal the cursor writes in, a key of a struct among it.
 */
function expectedOfString(cursor: Cursor, { parsed }: ParsedPlace): Type | undefined {
  const literal = parsed.chain.at(-1);
  return literal?.kind === 'StringLiteral'
    ? expectedOfPlaceholder(cursor, parsed.tree, literal)
    : undefined;
}

/**
 * Where a pattern starts, the type it matches (places/patterns/matched-type.ts); its variants fit.
 */
function expectedOfPatternStart(cursor: Cursor, { parsed }: ParsedPlace): Type | undefined {
  const holder = parsed.chain.at(-2);
  const pattern = holder === undefined ? undefined : patternStartedBy(parsed.chain, holder);
  return pattern === undefined ? undefined : matchedTypeOf(cursor, parsed, pattern);
}

/**
 * What the checker expects of the value the name `written` writes, the program's tree holding it.
 */
function expectedOfWritten(
  { checker, module, tree }: Cursor,
  written: Identifier,
): Type | undefined {
  const value = valueNamedBy(nodesAt(tree, spanIn(tree, written.span).start), written);
  return checker.lookup.bodyHolding(module, value)?.expectedOf(value);
}

/**
 * The value the name `name` writes, `chain` holding it: the name itself, or the struct or variant
 * literal it names (`Ok‸{(v)}`, `Ok‸:`), whose type the tree holds as a written type.
 */
function valueNamedBy(chain: readonly SyntaxNode[], name: Identifier): Expression {
  const type = holderIn(chain, name);
  return (type === undefined ? undefined : literalNaming(holderIn(chain, type), type)) ?? name;
}

/** The name the cursor writes as the program's tree holds it, which its own checker answers for. */
function writtenName({ name, tree, offset }: Cursor): Identifier | undefined {
  return name?.kind === 'identifier' ? identifierAt(tree, offset) : undefined;
}

/** What the checker expects of `value`, `tree` checked in place of the cursor's module's. */
function expectedOfPlaceholder(
  cursor: Cursor,
  tree: SyntaxTree,
  value: Expression,
): Type | undefined {
  return placeholderChecker(cursor, tree)
    .lookup.bodyHolding(cursor.module, value)
    ?.expectedOf(value);
}
