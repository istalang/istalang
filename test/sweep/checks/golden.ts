/**
 * The goldens: what each subject shows when run, held to what was recorded
 * (docs/work/done/ir-first/contracts.md, "Goldens"; ../../golden/golden.md).
 *
 * - A group's goldens are one JSON file, `test/golden/<group>.json`, by subject name. An entry
 *   holds only what the subject's source doesn't state, and a subject with nothing more to record
 *   has none, so the stated result keeps its one home. A suite's assertions state all of it, so a
 *   suite has no golden: it passes.
 * - Recording writes what each subject showed instead of checking it, except the `amended`
 *   group's, written by hand to spec amendments, and keeps the goldens of subjects it didn't run.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect } from 'vitest';
import { memo } from '../../../src/foundation/structures/memo.ts';
import { type Ending, withoutEmpty } from '../../golden/observation.ts';
import { runSuite } from '../../golden/pipeline/index.ts';
import { observeScenario } from '../../golden/pipeline/scenario-run.ts';
import {
  amendedGroup,
  type ProgramSubject,
  statedEnding,
  subjectGroups,
} from '../../golden/subjects.ts';
import { type Check, observedOf, recording, type Swept } from '../swept.ts';

/** A golden: what running its subject showed beyond what its source states. */
type Golden = Readonly<Record<string, unknown>>;

/** A group's goldens as recorded, and what this process saw of its subjects when recording. */
interface GroupGoldens {
  readonly file: URL;
  readonly recorded: Readonly<Record<string, Golden>>;
  readonly fresh: Record<string, Golden>;
  /** The subjects this run recorded, so a filtered recording keeps every other golden. */
  readonly ran: Set<string>;
}

const groups = new Map<string, GroupGoldens>();

/** The goldens `group` recorded; none for a group never recorded yet. */
export function goldensOf(group: string): GroupGoldens {
  return memo(groups, group, () => {
    const file = new URL(`../../golden/${group}.json`, import.meta.url);
    const recorded = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, Golden>)
      : {};
    return { file, recorded, fresh: {}, ran: new Set() };
  });
}

/**
 * What running a subject showed: its golden, and the ending its source states beside the part of
 * the ending shown in its place, both absent for a subject stating none.
 */
interface Run {
  readonly golden: Golden;
  readonly stated?: Partial<Ending> | undefined;
  readonly shown?: Partial<Ending>;
}

async function programRun(subject: ProgramSubject): Promise<Run> {
  const { logs, hostCalls, ending } = await observedOf(subject);
  const stated = statedEnding(subject);
  if (stated === undefined) {
    return { golden: withoutEmpty({ ...ending, logs, hostCalls }) };
  }
  // A panic's frame is what its header leaves unstated; any other ending is stated whole.
  const [shown, rest] =
    'panic' in ending ? [{ panic: ending.panic }, { frame: ending.frame }] : [ending, {}];
  return { golden: withoutEmpty({ ...rest, logs, hostCalls }), stated, shown };
}

/** Holds `swept` to what it shows, its golden to what was recorded, or records it. */
function held({ group, subject }: Swept, { golden: shownGolden, stated, shown }: Run): number {
  expect(shown).toEqual(stated);
  const goldens = goldensOf(group);
  if (recording && group !== amendedGroup) {
    goldens.ran.add(subject.name);
    if (Object.keys(shownGolden).length > 0) {
      goldens.fresh[subject.name] = shownGolden;
    }
  } else {
    expect(shownGolden).toEqual(goldens.recorded[subject.name] ?? {});
  }
  return 1;
}

async function programHeld(_: undefined, swept: Swept & { readonly subject: ProgramSubject }) {
  return held(swept, await programRun(swept.subject));
}

/**
 * Writes each group's goldens this process recorded, keeping those of the group's subjects it
 * didn't run.
 */
function written(): void {
  for (const [group, { file, recorded, fresh, ran }] of groups) {
    if (ran.size > 0) {
      const names = new Set(subjectGroups.get(group)?.map(({ name }) => name));
      const kept = Object.entries(recorded).filter(([name]) => names.has(name) && !ran.has(name));
      const sorted = Object.fromEntries(
        [...kept, ...Object.entries(fresh)].toSorted(([first], [second]) =>
          first.localeCompare(second),
        ),
      );
      writeFileSync(file, `${JSON.stringify(sorted, undefined, 2)}\n`);
    }
  }
}

export const golden: Check = {
  holds: {
    stating: programHeld,
    example: programHeld,
    suite: async (_, { subject }) => {
      await runSuite(subject.project, subject.paths);
      return 1;
    },
    scenario: async (_, swept) =>
      held(swept, { golden: { steps: await observeScenario(swept.subject.scenario) } }),
  },
  record: written,
};
