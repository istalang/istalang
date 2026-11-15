/**
 * How each candidate shows, ranks and inserts: one presenter per subject kind, so a subject added
 * to the candidate model can't go unpresented, and the list's order decided once, here, never by
 * the providers, which only say what may be written.
 *
 * - An item ranks first when a value it writes fits the type expected at the place
 *   (../expected.ts), then by where its name comes from (locals, the module, imports, the prelude,
 *   keywords), then by its presenter's priority, then in its declaration's order (an enum's
 *   variants as declared).
 * - The first item that fits is preselected, so the list opens on it, but only one of the code
 *   being written, a local or the module's, or a place's own (a member, a field, an argument):
 *   a prelude or imported name fitting by its type alone is no guess worth accepting with Enter.
 * - A field named in a literal or an annotation inserts `name: ` and asks for the next list, its
 *   value's (§3.1), as an argument's label does, but alone where its `:` already follows.
 *   Its priority puts a field with no default first, as it must be given.
 * - Where a function value is expected, a function or a variant's constructor fitting it as a
 *   value, as checking binds one (`givenAsValue`, presenting.ts), fits too (§3.14).
 * - Within a member's list, fields and variants come before methods, a variant reached through its
 *   enum being no name a scope offers, of no group; a value another case already tests ranks after
 *   the rest.
 */

import type { Type } from '../../../../compiler/checker/types/type/index.ts';
import { boolType } from '../../../../compiler/checker/types/type/primitives.ts';
import { slotText, typeText } from '../../../../compiler/checker/types/type/type-text.ts';
import { hasDefault } from '../../../../compiler/syntax/declarations/index.ts';
import { type Handlers, handlerOf } from '../../../../foundation/structures/kind-table.ts';
import { docstringOf } from '../../reading/docstrings.ts';
import { signatureOf } from '../../signatures/signatures.ts';
import type { Candidate, Subject } from '../candidate.ts';
import type { Cursor } from '../cursor.ts';
import type { Place, PlaceKind } from '../place.ts';
import { groupOf, shownEntity } from './entity-items.ts';
import { type Completion, lowestPriority, type RankGroup, ranksBefore } from './item.ts';
import {
  called,
  calledOrNamed,
  constructed,
  documented,
  fitsExpected,
  functionGivenAsValue,
  type Presenting,
  presentingAt,
  type Shown,
  variantGivenAsValue,
} from './presenting.ts';

/** The completions `candidates` make at `cursor` in `place`, in their order. */
export function present(
  cursor: Cursor,
  place: Place,
  candidates: readonly Candidate[],
): readonly Completion[] {
  const presenting = presentingAt(cursor, place);
  const items = candidates.map(({ name, subject, covered }): Completion => {
    const {
      group,
      priority = 0,
      order,
      gives = [],
      ...shown
    } = handlerOf(presenters, subject)(presenting, subject, name);
    const fitting = gives.some((type) => fitsExpected(presenting, type));
    const ranked = covered === true ? Math.min(priority + coveredAfter, lowestPriority) : priority;
    return {
      name,
      ...shown,
      rank: {
        fitsExpected: fitting,
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
  read: ({ cursor: { checker } }, { read: { declaration, type } }) => ({
    kind: 'field',
    detail: typeText(type),
    ...documented(docstringOf(checker, { kind: 'function', declaration })),
    gives: [type],
  }),
  function: (presenting, { declaration, through }, name) => {
    const { checker } = presenting.cursor;
    return {
      kind: through === 'value' ? 'method' : 'function',
      detail: signatureOf(checker, declaration).label,
      ...documented(docstringOf(checker, { kind: 'function', declaration })),
      priority: 1,
      gives: [
        checker.resultOf(declaration),
        ...(through === 'type' ? functionGivenAsValue(presenting, declaration) : []),
      ],
      ...(through === 'type'
        ? calledOrNamed(presenting, name, [checker.resultOf(declaration)])
        : called(presenting, name)),
    };
  },
  argument: (presenting, { parameter }, name) => ({
    kind: 'variable',
    detail: slotText(parameter),
    ...labelled(
      presenting,
      parameter.node.name?.text ?? '',
      `${name} ${parameter.reference ? '&' : ''}`,
    ),
  }),
  fieldArgument: (presenting, { field }, name) => {
    const { declared } = field;
    return {
      kind: 'field',
      detail: typeText(field.type),
      ...(declared === undefined ? {} : { priority: hasDefault(declared.node) ? 1 : 0 }),
      ...labelled(presenting, field.name, `${name} `),
    };
  },
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
      gives: [type, ...variantGivenAsValue(presenting, variant, type)],
      ...constructed(presenting, name, { hasFields: variant.fields.length > 0, enums: [type] }),
    };
  },
  literal: (_presenting, { type }) => ({ kind: 'constant', detail: typeText(type), gives: [type] }),
  modulePath: (_presenting, { to }) =>
    to === 'module' ? { kind: 'module' } : { kind: 'folder', next: 'completion' },
  label: () => ({ kind: 'label' }),
};

/**
 * Accepting the name labelling an argument, `labelled` its text with its `:`: that, asking for the
 * value's list next, unless the `:` already follows the cursor, where the name alone is written.
 */
function labelled(presenting: Presenting, name: string, labelledText: string): Partial<Shown> {
  return presenting.follows === ':'
    ? { insert: { kind: 'text', text: name } }
    : { insert: { kind: 'text', text: labelledText }, next: 'completion' };
}

/** The groups whose fitting items may be preselected; an item of no group is a place's own. */
const guessedFrom: ReadonlySet<RankGroup | undefined> = new Set([undefined, 'local', 'module']);

/**
 * `items` with the first of those fitting the expected type preselected, of the groups guessed
 * from.
 */
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
