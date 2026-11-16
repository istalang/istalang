/**
 * A program stating its ending ends so as `ista run` runs it: deployed from its Definition's text,
 * on real time, with a random seed, each panic's trace naming where every frame stood. It writes
 * the logs it writes on the goldens' clock, and no instance panics unheard. How the CLI prints
 * what it ends with is src/cli/commands/run.test.ts's.
 */

import { randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { realTime } from '../../../src/runtime/clock.ts';
import { createRuntime } from '../../../src/runtime/host/index.ts';
import { seedBytes } from '../../../src/runtime/random-draws.ts';
import { memoryStore } from '../../../src/runtime/store.ts';
import { stdNatives } from '../../../src/stdlib/natives.ts';
import { logLine } from '../../golden/observation.ts';
import { hostOf } from '../../golden/pipeline/index.ts';
import { type ProgramSubject, statedEnding } from '../../golden/subjects.ts';
import { type Check, encodedOf, observedOf } from '../swept.ts';

/** A trace's line: a frame's name, then its module, line and column. */
const frameLine = /^at .+ \(\S+:\d+:\d+\)$/u;

async function endsAsStated(_: undefined, { subject }: { readonly subject: ProgramSubject }) {
  const logs: string[] = [];
  const unheard: string[] = [];
  const runtime = createRuntime({
    natives: stdNatives,
    store: memoryStore(),
    clock: realTime,
    seed: () => randomBytes(seedBytes),
    host: await hostOf(subject),
    reports: {
      logs: (records) => logs.push(...records.map(logLine)),
      panicked: (instance, { message }) => unheard.push(`${instance}: ${message}`),
    },
  });
  const program = runtime.deploy(encodedOf(subject));
  const { state, logs: own } = await program.start('run');
  logs.push(...own.map(logLine));
  switch (state.kind) {
    case 'finished':
      expect({ outcome: program.outcomeText(state) }).toEqual(statedEnding(subject));
      break;
    case 'panicked':
    case 'terminated':
      expect({ panic: state.message }).toEqual(statedEnding(subject));
      expect(state.trace.split('\n').filter((line) => !frameLine.test(line))).toEqual([]);
      break;
    default:
      expect(state.kind).toBe('finished');
  }
  expect(logs).toEqual((await observedOf(subject)).logs);
  expect(unheard).toEqual([]);
  return 1;
}

export const realTimeRun: Check = { holds: { stating: endsAsStated } };
