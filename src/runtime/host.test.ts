/**
 * The runtime on hand-written Definitions, without the compiler: it deploys a Definition's
 * persisted text, binds externs to natives, runs `main` to its outcome, and every call goes
 * through the function table, so replacing an entry changes the callee.
 */

import { describe, expect, it } from 'vitest';
import { subsetDefinition, subsetOutcome } from '../../test/definitions/subset.ts';
import { definitionFormat } from '../definition/definition.ts';
import { FormatError } from '../definition/format.ts';
import { preludeNatives } from '../stdlib/prelude/natives.ts';
import { type Natives, Panic } from './natives.ts';
import { Refusal } from './refusal.ts';
import { testRuntime } from './runtime.test-kit.ts';

const subsetText = definitionFormat.write(subsetDefinition).text;
const innermostLocation = /\(main:6:\d+\)$/u;
const missingKeys = /prelude\.compare\(int, int\).*prelude\.add\(int, int\)/u;
const fib = subsetDefinition.functions.findIndex((entry) => entry.name === 'main.fib');

/** The subset fixture deployed on a fresh runtime, with `run` starting a new instance of it. */
function load(natives: Natives = preludeNatives) {
  const program = testRuntime({ natives }).runtime.deploy(subsetText);
  let instances = 0;
  return {
    ...program,
    run: () => {
      instances += 1;
      return program.start(`instance-${instances}`);
    },
  };
}

describe('the runtime', () => {
  it('runs the subset fixture to its outcome', () => {
    expect(load().run()).toEqual({ kind: 'finished', value: subsetOutcome });
  });

  it('calls whatever replaced a function-table entry', () => {
    const program = load();
    program.functions.replace(fib, { kind: 'native', native: () => 0n });
    expect(program.run()).toEqual({ kind: 'finished', value: 10n });
  });

  it('turns a panic into the outcome, with a trace from the innermost frame out', () => {
    const natives = {
      ...preludeNatives,
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

  it('turns a value into the JSON a host receives, refusing one that has no JSON form', () => {
    const program = load();
    expect(program.json(98n)).toBe('98');
    expect(() => program.json(Number.NaN)).toThrow(Refusal);
    expect(() => program.json({ kind: 'tuple', elements: [] })).toThrow(Refusal);
  });

  it('refuses a text that is not a Definition', () => {
    expect(() => testRuntime({ natives: preludeNatives }).runtime.deploy('{}')).toThrow(
      FormatError,
    );
  });

  it('lets an error a native throws for any other reason propagate', () => {
    const natives = {
      ...preludeNatives,
      'prelude.add(int, int)': () => {
        throw new RangeError('a bug in the native');
      },
    };
    expect(() => load(natives).run()).toThrow(RangeError);
  });
});
