/**
 * Parsing speed, measured with `npm run bench` and kept out of `npm run verify`: a wall-clock
 * budget asserted in a test fails on any loaded machine, for reasons unrelated to the commit.
 *
 * The input is every module example of the spec, repeated to 10k lines. An editor reparses on
 * every keystroke, so a scan and parse of it should stay well under 200 ms. The input must parse
 * cleanly first: timing a parse that fails says nothing about the parser.
 */

import { test as it } from 'vitest';
import { specExamples } from '../../../test/corpus/spec-examples.ts';
import { createSourceText } from '../../text/source-text.ts';
import { scan } from '../scanner/scan.ts';
import { parse } from './parse.ts';

const unit = specExamples
  .filter((example) => example.form === 'module')
  .map((example) => example.code)
  .join('\n');
const lineCount = 10_000;
const text = Array.from(
  { length: Math.ceil(lineCount / unit.split('\n').length) },
  () => unit,
).join('\n');
const source = createSourceText('bench.ista', text);

it(`scan and parse ${lineCount} lines`, async ({ bench, expect }) => {
  expect(parse(source, scan(source)).diagnostics).toEqual([]);
  await bench('scan and parse', () => {
    parse(source, scan(source));
  }).run();
});
