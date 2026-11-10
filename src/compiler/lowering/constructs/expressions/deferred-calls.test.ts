/**
 * Deferred calls lowered (§3.14), held to their meaning by the commute law: over generated nests of
 * takers and calls, `g f(args)` runs as the closure it stands for, `g((fn(x): fn(): f(x))(args))`,
 * giving the same value and logging the same effects in the same order, so what runs now, what runs
 * later, and how often, all agree.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeJson } from '../../../../definition/formats/codec.ts';
import { startToEnd, testRuntime } from '../../../../runtime/runtime.test-kit.ts';
import { compiledText } from '../../../compile.test-kit.ts';

/** An argument: the log itself, or a value logging its label when it is computed. */
type Argument = { readonly log: true } | { readonly label: string; readonly value: number };

/** A call to defer, of `f0`, `f1` or `f2` by its arguments' count, or a taker given another. */
type Deferred =
  | { readonly kind: 'call'; readonly arguments: readonly Argument[] }
  | {
      readonly kind: 'taker';
      readonly calls: 0 | 1 | 2;
      readonly own: Argument;
      readonly defers: Deferred;
    };

/** A value logging its label, which every call and taker here takes beside the log. */
const argument: fc.Arbitrary<Argument> = fc.record({
  label: fc.constantFrom('a', 'b', 'c'),
  value: fc.integer({ min: 0, max: 9 }),
});

const deferred: fc.Arbitrary<Deferred> = fc.letrec<{ deferred: Deferred }>((tie) => ({
  deferred: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.record({ kind: fc.constant('call'), arguments: fc.array(argument, { maxLength: 2 }) }),
    fc.record({
      kind: fc.constant('taker'),
      calls: fc.constantFrom<0 | 1 | 2>(0, 1, 2),
      own: argument,
      defers: tie('deferred'),
    }),
  ),
})).deferred;

/** The declarations every program shares: the log's writers, the takers and the calls. */
const declarations = [
  'fn note(log: Shared<String>, s: String, n: Int) -> Int:',
  '  log->value += s',
  '  n',
  'fn f0(log: Shared<String>) -> Int:',
  '  log->value += "f "',
  '  1',
  'fn f1(log: Shared<String>, a: Int) -> Int:',
  '  log->value += "f "',
  '  a',
  'fn f2(log: Shared<String>, a: Int, b: Int) -> Int:',
  '  log->value += "f "',
  '  a * 10 + b',
  ...[0, 1, 2].flatMap((calls) => [
    `fn g${calls}(log: Shared<String>, k: Int, f: fn() -> Int) -> Int:`,
    `  log->value += "g${calls}(" + String(k) + ") "`,
    `  ${['k', 'f()', 'f() + f()'][calls]}`,
  ]),
];

function written(given: Argument): string {
  return 'log' in given ? 'log' : `note(log, "${given.label} ", ${given.value})`;
}

function typeOf(given: Argument): string {
  return 'log' in given ? 'Shared<String>' : 'Int';
}

/** The arguments a deferral computes now: its taker's, then its call's, in order. */
function computed(node: Deferred): readonly Argument[] {
  return node.kind === 'call'
    ? [{ log: true }, ...node.arguments]
    : [node.own, ...computed(node.defers)];
}

/** `node` as written: `g1(log, k) g2(log, k) f1(log, a)`; a taker passes its `k` by name. */
function writtenDeferred(node: Deferred): string {
  if (node.kind === 'call') {
    return `f${node.arguments.length}(${['log', ...node.arguments.map(written)].join(', ')})`;
  }
  return `g${node.calls}(log, k: ${written(node.own)}) ${writtenDeferred(node.defers)}`;
}

/**
 * The closure `node` stands for, built from `values`, the expressions it computes now, each bound
 * to a parameter of a lambda called at once, as Rule 10 writes it out.
 */
function desugared(node: Deferred, values: readonly string[], names: { next: number }): string {
  const parameters = computed(node).map((each) => {
    names.next += 1;
    return { name: `v${names.next}`, type: typeOf(each) };
  });
  const bound = parameters.map(({ name, type }) => `${name}: ${type}`).join(', ');
  const [own, ...rest] = parameters.map(({ name }) => name);
  const body =
    node.kind === 'call'
      ? `f${node.arguments.length}(${parameters.map(({ name }) => name).join(', ')})`
      : `g${node.calls}(log, ${own}, ${desugared(node.defers, rest, names)})`;
  return `(fn(${bound}): fn(): ${body})(${values.join(', ')})`;
}

/** A program whose `main` gives its log and what `body`, a taker's call, gives. */
function program(body: string): string {
  return [
    ...declarations,
    'async fn main() -> Future<String>:',
    '  const log = new Shared{value: ""}',
    `  const result = ${body}`,
    '  log->value + "= " + String(result)',
  ].join('\n');
}

async function outcomeOf(text: string): Promise<unknown> {
  const state = await startToEnd(testRuntime(), compiledText(text));
  return state.kind === 'finished' ? decodeJson(String(state.outcome)) : state;
}

describe('a deferred call', () => {
  it('runs as the closure it stands for', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom<0 | 1 | 2>(0, 1, 2), deferred, async (calls, node) => {
        const own = { label: 'k', value: 7 };
        const outer: Deferred = { kind: 'taker', calls, own, defers: node };
        const closure = desugared(node, computed(node).map(written), { next: 0 });
        const plain = `g${calls}(log, ${written(own)}, ${closure})`;
        expect(await outcomeOf(program(writtenDeferred(outer)))).toEqual(
          await outcomeOf(program(plain)),
        );
      }),
      { numRuns: 50 },
    );
  });

  it('leaves before any function is built where its call stops before it is made (§2)', async () => {
    const text = [
      'fn later(f: fn() -> Int) -> Int:',
      '  f()',
      'fn fail() -> Never:',
      '  panic("now")',
      'async fn main() -> Future<Int>:',
      '  later fail().size()',
    ].join('\n');
    expect(await outcomeOf(text)).toMatchObject({ kind: 'panicked', message: 'now' });
  });
});
