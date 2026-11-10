/**
 * The deferred-calls pass on hand-picked sources, and as its own fixed point on generated ones.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { corpusFiles } from '../../../../test/corpus/programs.ts';
import { soupOf } from '../../../../test/soup.ts';
import { applyEdits } from '../../edits.ts';
import { readIsta } from '../../pass.ts';
import { deferredCalls } from './index.ts';

/** `text` with every rewrite the pass makes there. */
function rewritten(text: string): string {
  const rewrites = deferredCalls(readIsta('main.ista', text));
  return applyEdits(
    text,
    rewrites.flatMap(({ edits }) => edits),
  );
}

describe('defer-statement', () => {
  it.each([
    ['defer fn(): log("exited")', '_ = defer(fn(): log("exited"))'],
    ['fn f():\n  defer fn(): x\n  y', 'fn f():\n  _ = defer(fn(): x)\n  y'],
    ['defer f  # when done', '_ = defer(f)  # when done'],
    ['defer f; g()', '_ = defer(f); g()'],
    ['defer\n    f\nnext', '_ = defer(\n    f)\nnext'],
    ['f(\n  defer g)', 'f(\n  _ = defer(g))'],
    [
      'async fn f():\n    defer fn(): {\n        if not shipped:\n            release(hold)\n    }\n    await ship(item)',
      'async fn f():\n    _ = defer(fn(): {\n        if not shipped:\n            release(hold)\n    })\n    await ship(item)',
    ],
    [
      'fn f():\n  defer fn():\n    a()\n    b()\n  c()',
      'fn f():\n  _ = defer(fn():\n    a()\n    b())\n  c()',
    ],
    ['defer spawn f().x', '_ = defer((spawn f()).x)'],
  ])('%j → %j', (source, expected) => {
    expect(rewritten(source)).toBe(expected);
  });

  it.each([
    ['already a call', '_ = defer(fn(): x)'],
    ['called, unassigned', 'defer(fn(): x)'],
    ['nothing to defer', 'defer\ndrop x'],
    ["only an editor test's cursor mark", 'fn f():\n  defer ‸'],
    ['not starting its line', 'x defer f'],
    ['brackets that do not pair', 'defer f(]'],
  ])('leaves a defer %s alone', (_, source) => {
    expect(rewritten(source)).toBe(source);
  });
});

describe('spawn-chain', () => {
  it.each([
    ['spawn f(x).result()', '(spawn f(x)).result()'],
    ['await spawn f().x', 'await (spawn f()).x'],
    [
      'spawn Job{box: Inbox.create<Int>()}.run().result()',
      '(spawn Job{box: Inbox.create<Int>()}.run()).result()',
    ],
    ['spawn echo<Array<Int>>("hi").result()', '(spawn echo<Array<Int>>("hi")).result()'],
    ['spawn a?.b->c?->d.e(1)[0]', '(spawn a?.b->c?->d.e(1))[0]'],
    ['spawn fs[0](x)!', '(spawn fs[0](x))!'],
    ['spawn f(x)(y)', '(spawn f(x))(y)'],
    ['spawn f(x)?', '(spawn f(x))?'],
    ['spawn f(g(h[1]), (2, 3)).x', '(spawn f(g(h[1]), (2, 3))).x'],
    ['spawn f(spawn g().x).y', '(spawn f((spawn g()).x)).y'],
    [
      '(await spawn f(1).r(), await spawn g().r())',
      '(await (spawn f(1)).r(), await (spawn g()).r())',
    ],
    ['`${spawn f().x}`', '`${(spawn f()).x}`'],
  ])('%j → %j', (source, expected) => {
    expect(rewritten(source)).toBe(expected);
  });

  it.each([
    ['bare', 'spawn f(x)'],
    ['already wrapped', '(spawn f(x)).result()'],
    ['already a call', 'spawn(f, x).result()'],
    ['going on past its line', 'spawn f(x)\n.result()'],
    ['ending in an optional member call', 'spawn maybe?.show()'],
    ['with no call', 'spawn 3'],
    ['named as a member', 'x.spawn f().y'],
    ['following an operand', 'g spawn f(x).y'],
  ])('leaves a spawn %s alone', (_, source) => {
    expect(rewritten(source)).toBe(source);
  });
});

describe('deferredCalls', () => {
  const soup = soupOf(
    [
      'defer',
      'spawn',
      'f',
      'x',
      '_',
      '1',
      '"s"',
      '`${spawn f().x} ${defer}`',
      '(',
      ')',
      '[',
      ']',
      '{',
      '}',
      '<',
      '>',
      '>>',
      '.',
      '?.',
      '->',
      '?->',
      '?',
      '!',
      ';',
      ',',
      '=',
      'fn():',
      'await',
      '‸',
      '# c',
    ],
    [' ', '', '\n', '\n  ', '\n    '],
    30,
  );

  it('rewrites its own output to itself', () => {
    fc.assert(
      fc.property(soup, (text) => {
        const once = rewritten(text);
        expect(rewritten(once)).toBe(once);
      }),
      { numRuns: 2000 },
    );
  });

  it('rewrites every corpus module rewritten to itself', () => {
    for (const { name, text } of corpusFiles) {
      const once = rewritten(text);
      expect(rewritten(once), name).toBe(once);
    }
  });
});
