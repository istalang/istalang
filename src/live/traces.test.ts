/**
 * A compiled program's frames are read off a JavaScript stack wherever its loader put its module and
 * however it moved its lines, calibrated by the module's `site`; other frames are passed over.
 */

import { describe, expect, it } from 'vitest';
import type { CodeShape } from './program-tables.ts';
import { Traces } from './traces.ts';

const entry: CodeShape = {
  kind: 'code',
  name: 'main.work',
  module: 0,
  parameters: [{ reference: false, hasDefault: true }],
  line: 10,
  spans: [0, 4, 8],
  start: 0,
  body: 1,
};

/** Traces of a module its loader serves as `where`, its lines moved down by 3. */
const traces = new Traces({
  site: { name: 'Error', message: '', stack: 'Error\n    at file:///served/program.mjs:5:14' },
  modules: [{ id: 'main', lineStarts: [0, 4] }],
  functions: [entry],
});

describe('traces of compiled code', () => {
  it('names the instruction each frame of the module stands at, innermost first', () => {
    const stack = [
      'Error: no',
      '    at native (file:///library/natives.js:1:1)',
      '    at f1 (file:///served/program.mjs:15:20)',
      '    at b1 (file:///served/program.mjs:13:3)',
    ].join('\n');
    expect(traces.of(stack)).toBe('at main.work (main:2:5)\nat main.work (main:1:1)');
  });

  it("leaves out a default's own frame from its caller's trace", () => {
    const stack =
      'Error\n    at f1 (file:///served/program.mjs:13:3)\n    at f1 (file:///served/program.mjs:14:3)';
    expect(traces.callerOf(stack)).toBe('at main.work (main:2:1)');
  });

  it('passes over a line of the module holding no instruction', () => {
    expect(traces.of('Error\n    at f1 (file:///served/program.mjs:4:1)')).toBe('');
  });
});
