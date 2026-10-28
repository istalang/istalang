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

/**
 * Declarations whose `made` leaves out a default that builds an `Error`, by a literal or by a
 * native; `main` continues at line 7.
 */
const builtInDefaults = [
  'struct Job:',
  '  failure: Error = Error{message: "m", code: "c"}',
  '  number: Result<int> = int.parse("x")',
  'fn made() -> Job:',
  '  Job{}',
  '',
].join('\n');

/** The default's frames, where each builds its `Error`: by a literal, and by a native. */
const failureLine = /^at \S*Job\/failure \(\S+:2:20\)$/u;
const numberLine = /^at \S*Job\/number \(\S+:3:25\)$/u;

/** `made`'s frame, at the literal leaving the defaults out. */
const madeLine = /^at \S*made \(\S+:5:3\)$/u;

/** `main`'s frame, at `made()` as the body's first expression, then within a `match`. */
const mainLine = /^at \S*main \(\S+:8:3\)$/u;
const mainMatchLine = /^at \S*main \(\S+:8:9\)$/u;

/** What `main` gave, one trace line per item; a non-string outcome as its own single item. */
function linesOf(outcome: unknown): readonly unknown[] {
  return typeof outcome === 'string' ? outcome.split('\n') : [outcome];
}

describe("an Error's trace", () => {
  it('names each frame, innermost first, at the line and column it stands at', () => {
    expect(linesOf(mainGives('string', 'traced()', declarations))).toEqual(
      frameLines.map((line) => expect.stringMatching(line)),
    );
  });

  it("built in a default, starts at the default's line, as a panic there would", () => {
    expect(linesOf(mainGives('string', 'made().failure.trace', builtInDefaults))).toEqual([
      expect.stringMatching(failureLine),
      expect.stringMatching(madeLine),
      expect.stringMatching(mainLine),
    ]);
  });

  it("built by a native in a default, starts at the default's line, as a panic there would", () => {
    const read = 'match made().number:\n    case Ok{value}: ""\n    case Err{error}: error.trace';
    expect(linesOf(mainGives('string', read, builtInDefaults))).toEqual([
      expect.stringMatching(numberLine),
      expect.stringMatching(madeLine),
      expect.stringMatching(mainMatchLine),
    ]);
  });
});
