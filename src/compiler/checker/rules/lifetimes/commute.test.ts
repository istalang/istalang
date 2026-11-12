/**
 * Static lifetimes and instantiation (design.md §5.3, §5.4): a program calling a generic function
 * is rejected whenever the same program calling that function's copy, written for the type it is
 * called with, is. Where the generic body calls no requirement of its type parameters, it is
 * rejected exactly then. A requirement's call runs code the generic body can't see, so it may be
 * rejected where a copy isn't. A generic body's cycles that its type parameter decides are its
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

/** Whether `build`'s program is rejected, generic or written as the copy. */
function verdicts(build: (generic: boolean) => string): { generic: boolean; copy: boolean } {
  return {
    generic: findingsIn(build(true)).length > 0,
    copy: findingsIn(build(false)).length > 0,
  };
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
    const verdict = verdicts(build);
    expect(verdict.generic).toBe(verdict.copy);
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
    const verdict = verdicts(build);
    expect(verdict.generic).toBe(verdict.copy);
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
    const verdict = verdicts(build);
    expect(verdict.generic).toBe(verdict.copy);
  });

  it('may reject a generic function calling a no-op requirement before linking', () => {
    const build = (generic: boolean) =>
      [
        ...declarations,
        'trait Touch:',
        '  fn touch(self: Self, x: Box<Node>, y: Box<Node>)',
        'struct Noop',
        'fn touch(self: Noop, x: Box<Node>, y: Box<Node>): ()',
        `fn touchAndLink${generic ? '<T is Touch>' : ''}(t: ${generic ? 'T' : 'Noop'}, a: Box<Node>, b: Box<Node>):`,
        '  t.touch(a, b)',
        '  a->other = b',
        'fn subject():',
        '  const a = new Box<Node>{value: new Node{lease: new Lease{n: 1}}}',
        '  const b = new Box<Node>{value: new Node{lease: new Lease{n: 2}}}',
        '  touchAndLink(Noop, a, b)',
      ].join('\n');
    const verdict = verdicts(build);
    expect(verdict.copy && !verdict.generic).toBe(false);
  });

  it('rejects a requirement linking two fields of `self`, generic or not', () => {
    const build = (generic: boolean) =>
      [
        ...declarations,
        'shared struct Parent { lease: Lease, child: Child? = none }',
        'shared struct Child { parent: Parent? = none }',
        'struct Pair { p: Parent, ch: Child }',
        'trait SelfLinker:',
        '  fn linkSelf(self: Self)',
        'fn linkSelf(self: Pair): self.ch->parent = self.p',
        `fn runSelfLink${generic ? '<T is SelfLinker>' : ''}(x: ${generic ? 'T' : 'Pair'}):`,
        '  x.linkSelf()',
        'fn subject():',
        '  const p = new Parent{lease: new Lease{n: 1}}',
        '  const ch = new Child{}',
        '  p->child = ch',
        '  runSelfLink(Pair{p, ch})',
      ].join('\n');
    expect(verdicts(build)).toEqual({ generic: true, copy: true });
  });
});
