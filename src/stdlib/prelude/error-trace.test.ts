/**
 * An `Error` built without `trace` gets the frames where it was built, innermost first, one line
 * per frame naming the function and where it stands (§3.12), as a panic's trace does. Line and
 * column count from 1, where the frame's instruction is: the literal, and each call on the way.
 */

import { describe, expect, it } from 'vitest';
import { mainGives } from './prelude.test-kit.ts';

/** Declarations whose lines `main`, which `mainGives` puts after them, continues at line 7. */
const declarations = [
  'fn failure() -> Error:',
  '  Error{message: "m", code: "c"}',
  '',
  'fn traced() -> string:',
  '  failure().trace',
  '',
].join('\n');

/** Each frame's line: `at`, the function (module-qualified), and `module:line:column`. */
const frameLines = [
  /^at \S*failure \(\S+:2:3\)$/u,
  /^at \S*traced \(\S+:5:3\)$/u,
  /^at \S*main \(\S+:8:3\)$/u,
];

/** What no line matches, for a line past the frames expected. */
const noFrame = /^$.^/u;

describe("an Error's trace", () => {
  it('names each frame, innermost first, at the line and column it stands at', () => {
    const trace = mainGives('string', 'traced()', declarations);
    expect(trace).toBeTypeOf('string');
    const lines = String(trace).split('\n');
    expect(lines).toHaveLength(frameLines.length);
    for (const [index, line] of lines.entries()) {
      expect(line).toMatch(frameLines[index] ?? noFrame);
    }
  });
});
