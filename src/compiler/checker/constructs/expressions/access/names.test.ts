/**
 * A struct without fields named bare (§5.2): its one value, a generic one's of the instance its
 * type arguments give, written after its name or taken from what is expected of it, a call's
 * parameter among it, as a variant without fields takes its enum's (§5.3).
 */

import { describe, expect, it } from 'vitest';
import { reportedNothing } from '../../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { lines } from '../../../../parser/parse.test-kit.ts';
import { reported } from '../../../check.test-kit.ts';

describe('a generic struct without fields named bare', () => {
  it('takes its type arguments from the call it is passed to, as a bare variant does', () => {
    const text = lines(
      'struct Tag<T>',
      'struct Defaulted<T = String>',
      'fn takeTag(t: Tag<Int>) -> Int: 1',
      'fn takeDefaulted(t: Defaulted<Int>) -> Int: 2',
      'fn same<T>(a: T, b: T) -> T: a',
      'fn main() -> Int:',
      '  const both = same(Tag, Tag<Int>)',
      '  const listed = [Tag, Tag<Int>]',
      '  takeTag(Tag) + takeDefaulted(Defaulted)',
    );
    expect(reported(text)).toEqual(reportedNothing);
  });

  it('takes them through a namespace too', () => {
    const lib = 'struct Tag<T>\n';
    const text = lines(
      "import * as lib from 'lib'",
      'fn takeTag(t: lib.Tag<Int>) -> Int: 1',
      'fn main() -> Int: takeTag(lib.Tag)',
    );
    expect(reported(text, { lib })).toEqual(reportedNothing);
  });
});
