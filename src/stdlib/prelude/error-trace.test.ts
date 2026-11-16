/**
 * An `Error` built without `trace` gets the frames where it was built, innermost first, one line
 * per frame naming the function and where it stands (§3.12), as a panic's trace does. Line and
 * column count from 1, where the frame's instruction is: the literal, and each call on the way.
 * `trace` is a default, computed in the prologue of `Error`'s entry, whose frame the trace leaves
 * out; a default building an `Error` runs in the prologue of its own function's entry, a struct's
 * as any, so that frame stands first, at the default.
 */

import { describe, expect, it } from 'vitest';
import { mainGives } from './prelude.test-kit.ts';

/** Declarations whose lines `main`, which `mainGives` puts after them, continues at line 7. */
const declarations = [
  'fn failure() -> Error:',
  '  Error{message: "m", code: "c"}',
  '',
  'fn traced() -> String:',
  '  failure().trace',
  '',
].join('\n');

/** The live `main` calling `_main` in its context, which every ista body's trace ends with. */
const liveMainLine = /^at \S*main\.main\.lambda@\S+ \(\S+\)$/u;

/** Each frame's line: `at`, the function (module-qualified), and `module:line:column`. */
const frameLines = [
  /^at \S*failure \(\S+:2:3\)$/u,
  /^at \S*traced \(\S+:5:3\)$/u,
  /^at \S*main\._main \(\S+:10:3\)$/u,
  liveMainLine,
];

/**
 * Declarations whose `made` leaves out a default that builds an `Error`, by a literal or by the
 * std's `Int.parse`; `main` continues at line 7.
 */
const builtInDefaults = [
  'struct Job:',
  '  failure: Error = Error{message: "m", code: "c"}',
  '  number: Result<Int> = Int.parse("x")',
  'fn made() -> Job:',
  '  Job{}',
  '',
].join('\n');

/** `Job`'s entry computing its defaults, where each builds its `Error`: by a literal, and by a call. */
const failureLine = /^at \S*Job \(\S+:2:20\)$/u;
const numberLine = /^at \S*Job \(\S+:3:25\)$/u;

/** The std's frames building a parse error, innermost first, which `Int.parse` returns (§3.10). */
const parseLines = [
  /^at prelude\.Error\.unparsed \(std:prelude:\d+:\d+\)$/u,
  /^at prelude\._parsed<Int> \(std:prelude:\d+:\d+\)$/u,
  /^at prelude\.Int\.parse \(std:prelude:\d+:\d+\)$/u,
];

/** `made`'s frame, at the literal leaving the defaults out. */
const madeLine = /^at \S*made \(\S+:5:3\)$/u;

/** `main`'s frame, at `made()` as the body's first expression, then within a `match`. */
const mainLine = /^at \S*main\._main \(\S+:10:3\)$/u;
const mainMatchLine = /^at \S*main\._main \(\S+:10:9\)$/u;

/** What `main` gave, one trace line per item; a non-string outcome as its own single item. */
function linesOf(outcome: unknown): readonly unknown[] {
  return typeof outcome === 'string' ? outcome.split('\n') : [outcome];
}

describe("an Error's trace", () => {
  it('names each frame, innermost first, at the line and column it stands at', async () => {
    expect(linesOf(await mainGives('String', 'traced()', declarations))).toEqual(
      frameLines.map((line) => expect.stringMatching(line)),
    );
  });

  it("built in a default, starts at the default's line, as a panic there would", async () => {
    expect(linesOf(await mainGives('String', 'made().failure.trace', builtInDefaults))).toEqual([
      expect.stringMatching(failureLine),
      expect.stringMatching(madeLine),
      expect.stringMatching(mainLine),
      expect.stringMatching(liveMainLine),
    ]);
  });

  it("built by a call in a default, has the default's line after the frames of the call", async () => {
    const read = 'match made().number:\n    case Ok(value): ""\n    case Err(error): error.trace';
    expect(linesOf(await mainGives('String', read, builtInDefaults))).toEqual([
      ...parseLines.map((line) => expect.stringMatching(line)),
      expect.stringMatching(numberLine),
      expect.stringMatching(madeLine),
      expect.stringMatching(mainMatchLine),
      expect.stringMatching(liveMainLine),
    ]);
  });
});
