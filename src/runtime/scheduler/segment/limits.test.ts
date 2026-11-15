/** The frame limit (limits.ts): recursion past it panics, synchronous or eager async. */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../../runtime.test-kit.ts';

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
