/**
 * Pattern completion as tests ask it: the names offered at a cursor `‸` written in a few lines,
 * which a body after them closes, and an enum whose variants have fields to match.
 */

import { programAt } from '../../../language-service.test-kit.ts';
import { completionsAt } from '../../index.ts';

/** An enum with a variant of one field, one of two, and one of none. */
export const decision = [
  'enum Decision:',
  '  Approved(by: String)',
  '  Rejected(by: String, reason: String)',
  '  Expired',
  '',
];

/** The names completion offers at the `‸` of `lines`, a body line closing them. */
export function labelsAt(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines, '  0');
  return completionsAt(program, module, offset).map(({ name }) => name);
}
