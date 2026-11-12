/**
 * Static lifetimes commutes with instantiation (design.md §5.3): a program calling a generic
 * function is rejected exactly when the same program calling that function's copy, written for the
 * type it is called with, is. A generic body's cycles that its type parameter decides are its
 * callers' to report, the copy's its own, so the verdict compared is the program's.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findingsIn } from './lifetimes.test-kit.ts';

const declarations = [
  'shared struct Lease:',
  '  n: Int',
  'fn dispose(self: Lease): ()',
  'shared struct Node:',
  '  lease: Lease',
  'shared struct Plain:',
  '  n: Int',
  'shared struct Box<T>:',
  '  value: T? = none',
  '  other: Box<T>? = none',
];

/** The types a call instantiates with, and a value of each. */
const instantiations = [
  { type: 'Node', value: 'new Node{lease: new Lease{n: 1}}' },
  { type: 'Plain', value: 'new Plain{n: 1}' },
  { type: 'Int', value: '1' },
];

/** Statements over two boxes `x` and `y` and a value `v` of their type. */
const statements = [
  'x->value = v',
  'y->value = v',
  'x->other = y',
  'y->other = x',
  'x->other = x',
  'x->other = none',
];

/** Spells the callee's parameters' types for `type`: the parameter `T`, or the type itself. */
function program(
  { type, value }: (typeof instantiations)[number],
  {
    inside,
    before,
    generic,
  }: { inside: readonly string[]; before: readonly string[]; generic: boolean },
): string {
  const element = generic ? 'T' : type;
  return [
    ...declarations,
    `fn linking${generic ? '<T>' : ''}(x: Box<${element}>, y: Box<${element}>, v: ${element}):`,
    ...['()', ...inside].map((line) => `  ${line}`),
    'fn subject():',
    `  const x = new Box<${type}>{}`,
    `  const y = new Box<${type}>{}`,
    `  const v = ${value}`,
    ...before.map((line) => `  ${line}`),
    '  linking(x, y, v)',
  ].join('\n');
}

describe('static lifetimes and instantiation', () => {
  it('rejects a generic call exactly where it rejects a call of its copy', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...instantiations),
        fc.array(fc.constantFrom(...statements), { maxLength: 3 }),
        fc.array(fc.constantFrom(...statements), { maxLength: 2 }),
        (instantiation, inside, before) => {
          const rejected = (generic: boolean) =>
            findingsIn(program(instantiation, { inside, before, generic })).length > 0;
          expect(rejected(true)).toBe(rejected(false));
        },
      ),
      { numRuns: 80 },
    );
  });

  it('commutes when a disposable generic handle copies a non-handle `T?` field', () => {
    const build = (generic: boolean) =>
      [
        ...declarations,
        'shared struct LeasedBox<T> { lease: Lease, value: T? = none }',
        `fn copyVal${generic ? '<T>' : ''}(a: LeasedBox<${generic ? 'T' : 'Int'}>, b: LeasedBox<${generic ? 'T' : 'Int'}>):`,
        '  const v = b->value',
        '  a->value = v',
        'fn subject():',
        '  const x = new LeasedBox<Int>{lease: new Lease{n: 1}, value: 42}',
        '  copyVal(x, x)',
      ].join('\n');
    expect(findingsIn(build(true)).length > 0).toBe(findingsIn(build(false)).length > 0);
  });

  it('commutes when an async generic function writes a disposable wrapper after an await', () => {
    const build = (generic: boolean) => {
      const param = generic ? 'T' : 'Int';
      return [
        "import * as runtime from 'runtime'",
        ...declarations,
        'shared struct Holder<T> { lease: Lease, item: T? = none }',
        'shared struct Wrapper<T> { lease: Lease, copy: T? = none }',
        `ista async fn putAfter${generic ? '<T>' : ''}(a: Holder<Wrapper<${param}>>, w: Wrapper<${param}>):`,
        '  await runtime.commit()',
        '  a->item = w',
        'ista fn subject():',
        '  const a = new Holder<Wrapper<Int>>{lease: new Lease{n: 1}}',
        '  const w = new Wrapper<Int>{lease: new Lease{n: 2}, copy: 42}',
        '  hold _ = putAfter(a, w)',
      ].join('\n');
    };
    expect(findingsIn(build(true)).length > 0).toBe(findingsIn(build(false)).length > 0);
  });

  it('commutes when a generic function writes through a `type match` alias', () => {
    const build = (generic: boolean) => {
      const param = generic ? 'T' : 'Int';
      return [
        ...declarations,
        'shared struct MatchNode { lease: Lease, s: Shared<MatchNode?> }',
        'type PickNode<T> = match T:',
        '  case Int: MatchNode',
        '  case _: MatchNode',
        `fn linkMatch${generic ? '<T>' : ''}(s: Shared<PickNode<${param}>?>, v: PickNode<${param}>):`,
        '  s->value = v',
        'fn subject():',
        '  const s = new Shared<MatchNode?>{value: none}',
        '  const n = new MatchNode{lease: new Lease{n: 1}, s: s}',
        `  linkMatch${generic ? '<Int>' : ''}(s, n)`,
      ].join('\n');
    };
    expect(findingsIn(build(true)).length > 0).toBe(findingsIn(build(false)).length > 0);
  });
});
