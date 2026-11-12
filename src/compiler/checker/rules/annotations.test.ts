/**
 * A generic declaration's annotations, made at each of its instances (§3.16): what one instance
 * can't make is reported where it is written, wherever the declaration is. The cases in one module
 * are the corpus's (`test/corpus/boundary/invalid-generic-annotations.ista`).
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { lines } from '../../parser/parse.test-kit.ts';
import { reported } from '../check.test-kit.ts';

describe("a generic function's annotations", () => {
  it('are made at an instance another module writes, its call reporting what they name', () => {
    const lib = lines(
      'struct Tag<T>',
      'type OnlyInt<T> = match T:',
      '  case Int: Int',
      '@Tag<OnlyInt<U>>',
      'fn helper<U>(u: U) -> Int: 1',
    );
    const main = lines("import helper from 'lib'", 'fn main() -> Int: helper("nope")');
    expect(reported(main, { lib })).toEqual(reportedOnce(5170, 'helper("nope")'));
  });
});
