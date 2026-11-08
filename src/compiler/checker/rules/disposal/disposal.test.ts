/**
 * Where a `dispose` may use its value (§7): only so it can't outlive the disposal. What it can't
 * do is the corpus's (`test/corpus/holders/invalid-dispose.ista`), which states its positions.
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { lines } from '../../../parser/parse.test-kit.ts';
import { reported } from '../../check.test-kit.ts';

describe("a dispose's own value", () => {
  it('may be the receiver of an extern method called with type arguments', () => {
    const text = lines(
      "import Encodable from 'json'",
      'extern struct Handle',
      'extern fn release<T is Encodable>(self: Handle, tag: T)',
      'fn dispose(self: Handle):',
      '  self.release<Int>(1)',
      '  self.release(2)',
    );
    expect(reported(text)).toEqual(reportedNothing);
  });
});
