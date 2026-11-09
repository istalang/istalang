/**
 * Producers agreeing in a constraint scope (open-agreement.ts): what is expected of them, where it
 * is known whole, is what they agree on, so each that doesn't fit it is reported once, against it,
 * even when one is a call the scope still infers.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { stdProgramOf } from '../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../compile.test-kit.ts';
import { reported } from '../check.test-kit.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

const id = 'fn id<T>(x: T) -> T: x';

/** The messages checking `function` beside `id` reports. */
function messagesOf(function_: string): readonly string[] {
  const text = [id, function_, 'async fn main(): 0'].join('\n');
  return diagnosedAt(stdProgramOf({ main: text }), 'main').diagnostics.map(
    ({ message }) => message,
  );
}

describe('branches with what is expected of them known', () => {
  it('report the one that doesn’t fit it, against it, once', () => {
    const mismatch = checkerDiagnostics.typeMismatch.code;
    expect(reported([id, 'fn f(c: Bool) -> String: if c: id(1) else: "ok"'].join('\n'))).toEqual(
      reportedOnce(mismatch, 'id(1)'),
    );
    expect(messagesOf('fn f(c: Bool) -> Int | String: if c: id(1) else: true')).toEqual([
      'Expected Int | String, found Bool.',
    ]);
  });
});
