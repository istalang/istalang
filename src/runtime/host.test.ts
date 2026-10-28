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
import type { Finished, InstanceState } from './instance-state.ts';
import { type Natives, Panic } from './natives.ts';
import { Refusal } from './refusal.ts';
import { testRuntime } from './runtime.test-kit.ts';

const subsetText = definitionFormat.write(subsetDefinition).text;
const innermostLocation = /\(main:6:\d+\)$/u;
const missingKeys = /prelude\.compare\(int, int\).*prelude\.add\(int, int\)/u;

/** `state`, which must be a finished instance's. */
function finished(state: InstanceState): Finished {
  if (state.kind !== 'finished') {
    throw new Error(`The instance ended ${state.kind}.`);
  }
  return state;
}

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

  it('gives an encoded outcome as JSON or its text, refusing one with no JSON', () => {
    const test = testRuntime();
    const program = test.runtime.deploy(
      compiledText('async fn main() -> Future<(float, int)>: (0.0 / 0.0, 12345678901234567890)'),
    );
    const state = finished(program.start('i').state);
    expect(program.outcome(state)).toEqual([null, 12345678901234567890n]);
    expect(program.outcomeText(state)).toBe('[null,12345678901234567890]');
    const unencoded = { kind: 'finished', outcome: 98n } as const;
    expect(() => program.outcome(unencoded)).toThrow(Refusal);
    expect(() => load().outcomeText(unencoded)).toThrow(Refusal);
  });

  it("gives a spawned instance's outcome as JSON when a codec writes its type, refusing one none writes", () => {
    const test = testRuntime();
    const program = test.runtime.deploy(
      compiledText(
        [
          'fn answer() -> int: 42',
          'fn handle() -> Instance<int>: spawn answer()',
          'async fn main():',
          '  spawn answer()',
          '  spawn handle()',
          '  0',
        ].join('\n'),
      ),
    );
    const [encoded, unencoded] = program
      .start('i')
      .spawned.map((name) => finished(test.runtime.wake(name).state));
    expect(encoded && program.outcomeText(encoded)).toBe('42');
    expect(() => unencoded && program.outcome(unencoded)).toThrow(Refusal);
  });

  it("encodes the root's outcome before what its frame holds is disposed, so a defer's panic is traced from main", () => {
    const program = testRuntime().runtime.deploy(
      compiledText('async fn main() -> Future<int>:\n  defer fn(): panic("boom")\n  42'),
    );
    const { state } = program.start('i');
    expect(state).toMatchObject({ kind: 'panicked', message: 'boom' });
    const frames = state.kind === 'panicked' ? state.trace.split('\n') : [];
    expect(frames.map((frame) => frame.split(' ')[1])).toEqual(['main.main.lambda@2:9']);
  });

  it('refuses a start whose seed from the host has the wrong length, writing nothing', () => {
    const { runtime, store } = testRuntime({ seed: () => new Uint8Array(3) });
    const program = runtime.deploy(subsetText);
    expect(() => program.start('short')).toThrow(expect.objectContaining({ reason: 'unfitSeed' }));
    expect(store.readSnapshot('short')).toBeUndefined();
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
