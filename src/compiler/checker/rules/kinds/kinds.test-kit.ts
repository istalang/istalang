/**
 * What the kinds' rule tests share: checking a source given as lines, and the types live values
 * come from.
 */

import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../../compile.test-kit.ts';
import { lines } from '../../../parser/parse.test-kit.ts';
import { reported } from '../../check.test-kit.ts';

/** A host type whose values stay in their process: live data. */
export const socket = 'extern live struct Socket';

/** A live type with a `default`, made only by live code. */
export const liveResource = [
  'shared struct LiveResource { n: Int }',
  'live fn dispose(self: LiveResource): ()',
  'live fn LiveResource.default() -> LiveResource: new LiveResource{n: 42}',
];

/** The codes checking `source` reports. */
export function codesOf(...source: readonly string[]): readonly number[] {
  return reported(lines(...source)).codes;
}

/** The codes and messages checking `source` reports. */
export function reportedMessages(...source: readonly string[]) {
  const { diagnostics } = diagnosedAt(stdProgramOf({ 'main.ista': lines(...source) }), 'main.ista');
  return {
    codes: diagnostics.map((diagnostic) => diagnostic.code),
    messages: diagnostics.map((diagnostic) => diagnostic.message),
  };
}
