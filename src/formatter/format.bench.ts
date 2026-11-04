/**
 * Formatting speed, measured with `npm run bench` and kept out of `npm run verify`, as the parser's
 * is (compiler/parser/parse.bench.ts).
 *
 * A call whose last argument is hugged (`f([…])`) is printed both hugged and broken out, and so is
 * every call nested in that argument. The input nests such calls `depth` deep, which costs twice as
 * much per level unless each node is printed once.
 */

import { test as it } from 'vitest';
import { formatText } from './format.ts';

const depth = 16;
const nested = Array.from({ length: depth }).reduce<string>((inner) => `f([${inner}])`, '1');
const text = `fn main():\n  ${nested}\n`;

it(`calls hugging their last argument, ${depth} deep`, async ({ bench, expect }) => {
  expect(formatText(text)).toBeDefined();
  await bench('format', () => {
    formatText(text);
  }).run({ time: 2000, iterations: 3, warmupIterations: 1 });
});
