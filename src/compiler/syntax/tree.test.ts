/**
 * Traversal derived from node fields: children in field order, arrays flattened, primitives and
 * absent optionals skipped.
 */

import { describe, expect, it } from 'vitest';
import type { Call } from './expressions/index.ts';
import type { Identifier } from './node.ts';
import { childrenOf } from './tree.ts';

const at = (start: number, end: number) => ({ start, end });
const name = (text: string, start: number): Identifier => ({
  kind: 'Identifier',
  span: at(start, start + text.length),
  text,
});

describe('childrenOf', () => {
  it('returns child nodes in field order, flattening arrays', () => {
    const callee = name('f', 0);
    const first = name('a', 2);
    const second = name('b', 5);
    const call: Call = {
      kind: 'Call',
      span: at(0, 7),
      callee,
      isOptional: false,
      typeArguments: [],
      arguments: [first, second],
    };
    expect(childrenOf(call)).toEqual([callee, first, second]);
  });

  it('skips primitives, spans and absent optionals', () => {
    const member = name('b', 2);
    const target = name('a', 0);
    expect(
      childrenOf({ kind: 'MemberAccess', span: at(0, 3), target, isOptional: false, member }),
    ).toEqual([target, member]);
    expect(
      childrenOf({
        kind: 'Range',
        span: at(0, 2),
        start: undefined,
        isInclusive: false,
        end: undefined,
        step: undefined,
      }),
    ).toEqual([]);
    expect(childrenOf(name('x', 0))).toEqual([]);
  });
});
