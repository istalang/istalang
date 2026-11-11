/**
 * The engine's limits as panics (limits.ts): each RangeError the engine throws for a value it can't
 * hold becomes a panic saying so, while a Panic passes as it is and any other error isn't one.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import { Panic } from '../../natives.ts';
import { startToEnd, testRuntime } from '../../runtime.test-kit.ts';
import { panicOf } from './limits.ts';

/** What `build` throws. */
function thrown(build: () => unknown): unknown {
  try {
    build();
  } catch (error) {
    return error;
  }
  throw new Error('Nothing was thrown.');
}

describe('panicOf', () => {
  it.each([
    [
      'a string',
      () => 'x'.repeat(2 ** 30),
      'The string would be longer than the runtime can hold.',
    ],
    ['an array', () => new Array(2 ** 32), 'The array would be longer than the runtime can hold.'],
    [
      'an integer',
      () => 2n ** (2n ** 40n),
      'The integer would be larger than the runtime can hold.',
    ],
  ])('turns the engine refusing %s into a panic saying so', (_, build, message) => {
    expect(panicOf(thrown(build))?.message).toBe(message);
  });

  it('passes a panic as it is, and turns no other error into one', () => {
    const panic = new Panic('stop');
    expect(panicOf(panic)).toBe(panic);
    expect(panicOf(new RangeError('Invalid time value'))).toBeUndefined();
    expect(panicOf(new TypeError('a bug'))).toBeUndefined();
  });
});

describe('requireFrameDepth', () => {
  it.each([
    [
      'synchronous',
      "fn loop(n: Int) -> Int: loop(n + 1)\nimport * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): loop(0)",
    ],
    [
      'eager async',
      "ista async fn loop(n: Int) -> Int: await loop(n + 1)\nimport * as runtime from 'runtime'\nlive async fn main(): await runtime.run(runtime.id()) _main()\nista async fn _main(): await loop(0)",
    ],
  ])('panics an instance whose %s recursion exceeds the frame limit', async (_, source) => {
    expect(await startToEnd(testRuntime(), compiledText(source))).toMatchObject({
      kind: 'panicked',
      message: expect.stringContaining('frames'),
    });
  });
});
