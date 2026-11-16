/**
 * The corpus sweep: every subject (swept.ts) compiled once, every check (checks.ts) run over what
 * that compile gave, a test per subject and check.
 *
 * - It runs in slices, one per `slice-<n>.sweep.test.ts` beside this module (test/slices.ts).
 *   Recording runs every subject in the first slice: each file recorded has one writer.
 * - A subject's checks run one after another, on a visit of it (swept.ts `visitOf`) that goes once
 *   they are done, so what they derived of it once, its compile first, goes with it.
 * - A slice ends by showing each check held of something there, so a check gone vacuous fails
 *   rather than passing.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wholeProgramTimeout } from '../../src/compiler/compile.test-kit.ts';
import { sliceOf } from '../slices.ts';
import { checks } from './checks.ts';
import { type Held, recording, type Swept, sweptSubjects, visitOf } from './swept.ts';

type Handler = (context: undefined, swept: Swept) => Held | Promise<Held>;

/** What one check did in a slice: the subjects it ran on, and how much it held of them. */
interface Tally {
  registered: number;
  ran: number;
  held: number;
}

/** Registers the tests of the slice `file` (its `import.meta.url`) runs. */
export function sweepSlice(file: string): void {
  const tallies = new Map(
    Object.keys(checks).map((kind) => [kind, { registered: 0, ran: 0, held: 0 }]),
  );
  for (const swept of subjectsOf(file)) {
    describeSubject(swept, tallies);
  }

  it('holds each check it ran of something', () => {
    const vacuous = [...tallies].filter(([, { ran, held }]) => ran > 0 && held === 0);
    expect(vacuous.map(([kind]) => kind)).toEqual([]);
  });

  afterAll(() => {
    if (recording) {
      for (const [kind, { record }] of Object.entries(checks)) {
        const { registered, ran } = tallies.get(kind) as Tally;
        if (ran > 0) {
          record?.(ran === registered);
        }
      }
    }
  });
}

/** Registers a test per check of `swept`, each run on one visit of it, counted in `tallies`. */
function describeSubject(swept: Swept, tallies: ReadonlyMap<string, Tally>): void {
  describe(`${swept.group} ${swept.subject.name}`, () => {
    /** The subject as its checks see it, while they run (`visitOf`). */
    const visiting: { current?: Swept | undefined } = {};
    beforeAll(() => {
      visiting.current = visitOf(swept);
    });
    afterAll(() => {
      visiting.current = undefined;
    });
    for (const [kind, check] of Object.entries(checks)) {
      const handler = check.holds[swept.kind] as Handler | undefined;
      const tally = tallies.get(kind) as Tally;
      if (handler !== undefined) {
        tally.registered += 1;
        // biome-ignore lint/suspicious/useExpect: each check asserts what it holds (checks/).
        it(
          kind,
          async () => {
            tally.ran += 1;
            tally.held += await handler(undefined, visiting.current as Swept);
          },
          wholeProgramTimeout,
        );
      }
    }
  });
}

/** The subjects of the slice `file`: its share of them, or all of them first when recording. */
function subjectsOf(file: string): readonly Swept[] {
  const slice = sliceOf(file);
  if (recording) {
    return slice.index === 0 ? sweptSubjects : [];
  }
  return slice.of(sweptSubjects);
}
