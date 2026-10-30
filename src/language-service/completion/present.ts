/**
 * How each candidate shows: its kind and detail, derived from what it names, one presenter per
 * subject kind, so a subject added to the candidate model can't go unpresented. How a list ranks,
 * what an item inserts and what follows its acceptance belong here too, never to the providers,
 * which only say what may be written.
 */

import type { Entity } from '../../compiler/binder/entities.ts';
import { slotText, typeText } from '../../compiler/checker/types/type-text.ts';
import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import { signatureOf } from '../signatures.ts';
import type { Candidate, Subject } from './candidate.ts';
import type { Cursor } from './cursor.ts';
import type { Completion, CompletionKind } from './item.ts';

/** The completions `candidates` make at `cursor`, in their order. */
export function present(cursor: Cursor, candidates: readonly Candidate[]): readonly Completion[] {
  return candidates.map(({ name, subject }) => ({
    name,
    ...handlerOf(presenters, subject)(cursor, subject),
  }));
}

type Shown = Omit<Completion, 'name' | 'rank' | 'preselect'>;

const entityKinds = {
  variable: 'variable',
  functions: 'function',
  type: 'type',
  primitive: 'type',
  self: 'type',
  variant: 'variant',
  variants: 'variant',
  namespace: 'module',
} as const satisfies Record<Entity['kind'], CompletionKind>;

const presenters: Handlers<Cursor, Subject, [], Shown> = {
  entity: (_cursor, { entity }) => ({ kind: entityKinds[entity.kind] }),
  keyword: () => ({ kind: 'keyword' }),
  field: (_cursor, { field }) => ({ kind: 'field', detail: typeText(field.type) }),
  function: ({ checker }, { declaration, through }) => ({
    kind: through === 'value' ? 'method' : 'function',
    detail: signatureOf(checker, declaration).label,
  }),
  variant: () => ({ kind: 'variant' }),
  argument: (_cursor, { parameter }) => ({
    kind: 'variable',
    detail: slotText(parameter),
    insert: {
      kind: 'text',
      text: `${parameter.node.name.text}: ${parameter.reference ? '&' : ''}`,
    },
    next: 'completion',
  }),
};
