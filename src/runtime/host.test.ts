/**
 * The runtime on hand-written Definitions, without the compiler: it deploys a Definition's
 * persisted text, binds externs to natives, runs `main` to its outcome, and every call goes
 * through the function table, so replacing an entry changes the callee.
 */

import { describe, expect, it } from 'vitest';
import { subsetDefinition, subsetOutcome } from '../../test/definitions/subset.ts';
import { compiledText } from '../compiler/compile.test-kit.ts';
import { definitionFormat } from '../definition/definition.ts';
import { FormatError } from '../definition/format.ts';
import { stdNatives } from '../stdlib/natives.ts';
import { type Natives, Panic } from './natives.ts';
import { Refusal } from './refusal.ts';
import { testRuntime } from './runtime.test-kit.ts';

const subsetText = definitionFormat.write(subsetDefinition).text;
const innermostLocation = /\(main:6:\d+\)$/u;
const missingKeys = /prelude\.compare\(int, int\).*prelude\.add\(int, int\)/u;
const fib = subsetDefinition.functions.findIndex((entry) => entry.name === 'main.fib');

/** The subset fixture deployed on a fresh runtime, with `run` starting a new instance of it. */
function load(natives: Natives = stdNatives) {
  const program = testRuntime({ natives }).runtime.deploy(subsetText);
  let instances = 0;
  return {
    ...program,
    run: () => {
      instances += 1;
      return program.start(`instance-${instances}`).state;
    },
  };
}

describe('the runtime', () => {
  it('runs the subset fixture to its outcome', () => {
    expect(load().run()).toEqual({ kind: 'finished', outcome: subsetOutcome });
  });

  it('calls whatever replaced a function-table entry', () => {
    const program = load();
    program.functions.replace(fib, { kind: 'native', native: () => 0n });
    expect(program.run()).toEqual({ kind: 'finished', outcome: 10n });
  });

  it('turns a panic into the outcome, with a trace from the innermost frame out', () => {
    const natives = {
      ...stdNatives,
      'prelude.subtract(int, int)': () => {
        throw new Panic('no subtraction today');
      },
    };
    const outcome = load(natives).run();
    expect(outcome.kind).toBe('panicked');
    expect(outcome).toMatchObject({ message: 'no subtraction today' });
    const frames = outcome.kind === 'panicked' ? outcome.trace.split('\n') : [];
    expect(frames.map((frame) => frame.split(' ')[1])).toEqual(['main.fib', 'main.main']);
    expect(frames[0]).toMatch(innermostLocation);
  });

  it('refuses a Definition whose externs have no native, naming them', () => {
    expect(() => load({})).toThrow(missingKeys);
    expect(() => load({})).toThrow(Refusal);
  });

  it("gives an outcome its start entry encoded as JSON or its text, refusing a value it didn't encode", () => {
    const test = testRuntime();
    const program = test.runtime.deploy(
      compiledText('async fn main() -> Future<(float, int)>: (0.0 / 0.0, 12345678901234567890)'),
    );
    const { state } = program.start('i');
    const outcome = state.kind === 'finished' ? state.outcome : null;
    expect(program.outcome(outcome)).toEqual([null, 12345678901234567890n]);
    expect(program.outcomeText(outcome)).toBe('[null,12345678901234567890]');
    expect(() => program.outcome(98n)).toThrow(Refusal);
    expect(() => load().outcomeText(98n)).toThrow(Refusal);
  });

  it('refuses a text that is not a Definition', () => {
    expect(() => testRuntime({ natives: stdNatives }).runtime.deploy('{}')).toThrow(FormatError);
  });

  it('lets an error a native throws for any other reason propagate', () => {
    const natives = {
      ...stdNatives,
      'prelude.add(int, int)': () => {
        throw new RangeError('a bug in the native');
      },
    };
    expect(() => load(natives).run()).toThrow(RangeError);
  });
});
