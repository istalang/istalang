/**
 * How each candidate shows, ranks and inserts: one presenter per subject kind, so a subject added
 * to the candidate model can't go unpresented, and the list's order decided once, here, never by
 * the providers, which only say what may be written.
 *
 * - An item ranks first when a value it writes fits the type expected at the place (expected.ts),
 *   then by where its name comes from (locals, the module, imports, the prelude, keywords), then
 *   by its presenter's priority, then in its declaration's order (an enum's variants as declared).
 * - The first item that fits is preselected, so the list opens on it, but only one of the code
 *   being written, a local or the module's, or a place's own (a member, a field, an argument):
 *   a prelude or imported name fitting by its type alone is no guess worth accepting with Enter.
 * - A field named in a literal or an annotation inserts `name: ` and asks for the next list, its
 *   value's (§3.1).
 *   Its priority puts a field with no default first, as it must be given.
 * - Within a member's list, fields and variants come before methods, a variant reached through its
 *   enum being no name a scope offers, of no group; a value another case already tests ranks after
 *   the rest.
 */

import type { Checker } from '../../compiler/checker/check.ts';
import { boolType } from '../../compiler/checker/types/primitives.ts';
import type { Type } from '../../compiler/checker/types/type.ts';
import { slotText, typeText } from '../../compiler/checker/types/type-text.ts';
import { hasDefault } from '../../compiler/syntax/declarations.ts';
import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import { docstringOf } from '../docstrings.ts';
import { signatureOf } from '../signatures.ts';
import type { Candidate, Subject } from './candidate.ts';
import type { Cursor } from './cursor.ts';
import { groupOf, shownEntity } from './entity-items.ts';
import { expectedTypeAt } from './expected.ts';
import { type Completion, lowestPriority, type RankGroup, ranksBefore } from './item.ts';
import type { Place, PlaceKind } from './place.ts';
import {
  called,
  constructed,
  documented,
  type Presenting,
  presentingAt,
  type Shown,
} from './presenting.ts';

/** The completions `candidates` make at `cursor` in `place`, in their order. */
export function present(
  cursor: Cursor,
  place: Place,
  candidates: readonly Candidate[],
): readonly Completion[] {
  const presenting = presentingAt(cursor, place);
  const expected = expectedTypeAt(cursor, place);
  const items = candidates.map(({ name, subject, covered }): Completion => {
    const {
      group,
      priority = 0,
      order,
      gives = [],
      ...shown
    } = handlerOf(presenters, subject)(presenting, subject, name);
    const fitsExpected = gives.some((type) => fits(cursor.checker, type, expected));
    const ranked = covered === true ? Math.min(priority + coveredAfter, lowestPriority) : priority;
    return {
      name,
      ...shown,
      rank: {
        fitsExpected,
        ...(group === undefined ? {} : { group }),
        priority: ranked,
        ...(order === undefined ? {} : { order: Math.min(order, lowestPriority) }),
      },
    };
  });
  return withFirstPreselected(items);
}

/** How far after the others a value another case covers ranks. */
const coveredAfter = 500;

/** Where a field's name is written with its value after it: a literal's or an annotation's item. */
const givesValue: ReadonlySet<PlaceKind> = new Set<PlaceKind>(['literalField', 'annotation']);

/** The literals a keyword writes, by the type of their value. */
const keywordValues: ReadonlyMap<string, Type> = new Map([
  ['true', boolType],
  ['false', boolType],
]);

const presenters: Handlers<Presenting, Subject, [name: string], Shown> = {
  entity: (presenting, { entity }, name) => shownEntity(presenting, entity, name),
  keyword: (_presenting, _subject, name) => {
    const value = keywordValues.get(name);
    return {
      kind: 'keyword',
      group: 'keyword',
      ...(value === undefined ? {} : { gives: [value] }),
    };
  },
  field: ({ place }, { field }, name) => {
    const { declared } = field;
    return {
      kind: 'field',
      detail: typeText(field.type),
      ...(declared === undefined ? {} : { priority: hasDefault(declared.node) ? 1 : 0 }),
      ...(givesValue.has(place.kind)
        ? { insert: { kind: 'text', text: `${name}: ` }, next: 'completion' }
        : {}),
    };
  },
  function: (presenting, { declaration, through }, name) => {
    const { checker } = presenting.cursor;
    return {
      kind: through === 'value' ? 'method' : 'function',
      detail: signatureOf(checker, declaration).label,
      ...documented(docstringOf(checker, { kind: 'function', declaration })),
      priority: 1,
      gives: [checker.resultOf(declaration)],
      ...called(presenting, name),
    };
  },
  argument: (_presenting, { parameter }, name) => ({
    kind: 'variable',
    detail: slotText(parameter),
    insert: { kind: 'text', text: `${name} ${parameter.reference ? '&' : ''}` },
    next: 'completion',
  }),
  variant: (presenting, { variant, enum: type }, name) => {
    const { checker, module } = presenting.cursor;
    const bare = presenting.place.kind !== 'member';
    return {
      kind: 'variant',
      detail: typeText(type),
      ...(type.kind === 'nominal'
        ? {
            ...(bare ? { group: groupOf(checker, module, type.entity) } : {}),
            order: checker.variantsOf(type)?.findIndex((each) => each.name === variant.name) ?? 0,
          }
        : {}),
      gives: [type],
      ...constructed(presenting, name, variant.fields.length > 0),
    };
  },
  literal: (_presenting, { type }) => ({ kind: 'constant', detail: typeText(type), gives: [type] }),
  modulePath: (_presenting, { to }) =>
    to === 'module' ? { kind: 'module' } : { kind: 'folder', next: 'completion' },
  label: () => ({ kind: 'label' }),
};

/**
 * Whether a value of `found` fits where `expected` is. An erroneous type fits nothing, and `Never`,
 * which fits everywhere, tells nothing about where it belongs.
 */
function fits(checker: Checker, found: Type, expected: Type | undefined): boolean {
  return (
    expected !== undefined &&
    expected.kind !== 'error' &&
    found.kind !== 'error' &&
    !(found.kind === 'primitive' && found.name === 'Never') &&
    checker.fitOf(found, expected) !== undefined
  );
}

/** The groups whose fitting items may be preselected; an item of no group is a place's own. */
const guessedFrom: ReadonlySet<RankGroup | undefined> = new Set([undefined, 'local', 'module']);

/** `items` with the first of those fitting the expected type preselected, of the groups guessed from. */
function withFirstPreselected(items: readonly Completion[]): readonly Completion[] {
  const best = items
    .filter(({ rank }) => rank?.fitsExpected === true && guessedFrom.has(rank.group))
    .reduce<Completion | undefined>(
      (first, item) => (first === undefined || ranksBefore(item, first) ? item : first),
      undefined,
    );
  return best === undefined
    ? items
    : items.map((item) => (item === best ? { ...item, preselect: true } : item));
}
