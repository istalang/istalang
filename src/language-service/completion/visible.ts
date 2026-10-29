/**
 * The names visible where the name being written starts (§3.4), then every keyword: what a place
 * with no list of its own offers.
 */

import { spanIn } from '../../compiler/syntax/positions.ts';
import { keywords } from '../../compiler/syntax/tokens.ts';
import { identifierAt } from '../identifier-at.ts';
import type { Candidate } from './candidate.ts';
import type { Cursor } from './cursor.ts';

export function visibleCandidates({ checker, module, tree, offset }: Cursor): readonly Candidate[] {
  const written = identifierAt(tree, offset);
  const start = written === undefined ? offset : spanIn(tree, written.span).start;
  return [
    ...[...checker.bindings.visibleAt(module, start)].map(
      ([name, entity]): Candidate => ({ name, subject: { kind: 'entity', entity } }),
    ),
    ...keywords.map((keyword): Candidate => ({ name: keyword, subject: { kind: 'keyword' } })),
  ];
}
