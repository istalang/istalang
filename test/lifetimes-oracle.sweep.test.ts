/**
 * Static lifetimes is sound (docs/work/static-lifetimes/plan.md, C3): over soups of writes,
 * closures, async calls, inboxes and awaitables, a program the checker accepts never trips the
 * oracle when it runs (runtime/lifetimes/oracle.test-kit.ts), and one it rejects is rejected for a
 * cycle alone, since every fragment checks otherwise.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../src/compiler/binder/bind.test-kit.ts';
import { isCycle } from '../src/compiler/checker/rules/lifetimes/lifetimes.test-kit.ts';
import { checkedAfterStd, compiledText, diagnosedAt } from '../src/compiler/compile.test-kit.ts';
import { isError } from '../src/foundation/diagnostics/diagnostic.ts';
import { startToEnd, testRuntime } from '../src/runtime/runtime.test-kit.ts';
import { cyclicPrograms } from './cyclic-programs.ts';

const declarations = [
  "import Inbox from 'inbox'",
  "import * as runtime from 'runtime'",
  'shared struct Lease:',
  '  n: Int',
  'fn dispose(self: Lease): ()',
  'shared struct Node:',
  '  lease: Lease? = none',
  '  next: Node? = none',
  '  call: Future<Unit, "ista">? = none',
  '  hook: ista fn() -> Unit = fn(): ()',
  'shared struct Parent { child: Child? = none, next: Parent? = none }',
  'fn dispose(self: Parent): ()',
  'shared struct Child { parent: Parent? = none }',
  'struct Pair { p: Parent, ch: Child }',
  'shared struct GlobNode { lease: Lease, box: Shared<GlobNode?> }',
  'ista const globalBox = new Shared<GlobNode?>{value: none}',
  'trait Linker:',
  '  ista fn connect(self: Self, x: Node, y: Node)',
  'struct Impl',
  'ista fn connect(self: Impl, x: Node, y: Node): x->next = y',
  'ista async fn holding(n: Node): await runtime.commit()',
  'ista fn link(x: Node, y: Node): x->next = y',
  'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
  'ista async fn _main() -> Int:',
  '  const a = new Node{lease: new Lease{n: 1}}',
  '  const b = new Node{}',
  '  const c = new Node{lease: new Lease{n: 2}}',
  '  const box = Inbox.create<Node>()',
];

/** Statements over `a`, `b`, `c` and `box`, each checking on its own but for a cycle it closes. */
const fragments = [
  'a->next = b',
  'b->next = a',
  'b->next = c',
  'c->next = a',
  'a->next = a',
  'a->next = none',
  'b->next = none',
  'link(a, b)',
  'link(b, c)',
  'link(c, b)',
  'a->call = holding(b)',
  'b->call = holding(a)',
  'b->call = holding(b)',
  'b->call = none',
  'b->hook = ista fn(): { _ = a; () }',
  'a->hook = ista fn(): { _ = b; () }',
  'b->hook = ista fn(): { _ = b; () }',
  '(b->hook)()',
  'box.send(a)',
  'box.send(b)',
  'b->lease = new Lease{n: 3}',
  'await runtime.commit()',
];

/** `body`'s statements run in `_main`, after the declarations, then a commit. */
function programOf(body: readonly string[], extra: readonly string[] = []): string {
  return [
    ...declarations.slice(0, -5),
    ...extra,
    ...declarations.slice(-5),
    ...body.map((line) => `  ${line}`),
    '  await runtime.commit()',
    '  0',
  ].join('\n');
}

describe('static lifetimes over fragment soups', () => {
  it('never lets a program it accepts trip the oracle, and rejects only for cycles', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.constantFrom(...fragments), { maxLength: 8 }), async (body) => {
        const text = programOf(body);
        const program = stdProgramOf({ main: text });
        checkedAfterStd(program);
        const errors = diagnosedAt(program, 'main').diagnostics.filter(isError);
        expect(errors.filter((error) => !isCycle(error))).toEqual([]);
        const ended =
          errors.length > 0 ? 'rejected' : await startToEnd(testRuntime(), compiledText(text));
        expect(['rejected', { kind: 'finished', outcome: '0' }]).toContainEqual(ended);
      }),
      { numRuns: 60 },
    );
  });

  it.each(cyclicPrograms)(
    'rejects rather than letting the oracle trip on $name',
    async ({ body, extra = [] }) => {
      const text = programOf(body, extra);
      const program = stdProgramOf({ main: text });
      checkedAfterStd(program);
      const errors = diagnosedAt(program, 'main').diagnostics.filter(isError);
      expect(errors.filter((error) => !isCycle(error))).toEqual([]);
      const ended =
        errors.length > 0 ? 'rejected' : await startToEnd(testRuntime(), compiledText(text));
      expect(ended).toBe('rejected');
    },
  );
});
