/**
 * The goldens: what each subject (subjects.ts) shows when run, held to what was recorded from the
 * interpreter before the IR-first rewrite (docs/work/ir-first/contracts.md, "Goldens").
 *
 * - A group's goldens are one JSON file beside this one, `<group>.json`, by subject name. An entry
 *   holds only what the subject's source doesn't state, and a subject with nothing more to record
 *   has none, so the stated result keeps its one home.
 * - `GOLDEN=update` records what each subject shows instead of checking it, except the `amended`
 *   group's, written by hand to spec amendments. A pipeline predating them must show something
 *   else than they state, so a program of theirs that stops compiling still fails.
 * - The `defects` group's programs are expected red the same way, each still showing something else
 *   than it states, so a fix turns its check red until the program moves into the corpus. A
 *   toolchain invariant breaking on one is something else shown; a diagnostic is still a failure.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';
import { Unreachable } from '../../src/foundation/structures/unreachable.ts';
import { type Ending, withoutEmpty } from './observation.ts';
import { observeProgram, observeScenario, observeSuite, runsAmendments } from './pipeline.ts';
import { defectsGroup, type ProgramSubject, type Subject, subjectGroups } from './subjects.ts';

/** A golden: what running its subject showed beyond what its source states. */
type Golden = Readonly<Record<string, unknown>>;

// biome-ignore lint/style/noProcessEnv: the switch between checking and recording, as vitest's own -u is.
const updating = process.env.GOLDEN === 'update';

/** The group of programs written to spec amendments, which a pipeline predating them fails. */
const amendedGroup = 'amended';

/** A subject run past a unit test's time: the supplier demo compiles for seconds. */
const subjectTimeout = 120_000;

for (const [group, subjects] of subjectGroups) {
  const file = new URL(`./${group}.json`, import.meta.url);
  const recorded = readRecorded(file);
  const fresh: Record<string, Golden> = {};
  /** The subjects this run recorded, so a filtered update keeps every other golden. */
  const ran = new Set<string>();

  describe(`${group} shows what was recorded`, () => {
    it('records no subject that is gone', () => {
      const names = new Set(subjects.map(({ name }) => name));
      expect(Object.keys(recorded).filter((name) => !names.has(name))).toEqual([]);
    });

    const handWritten = group === amendedGroup;
    if (group === defectsGroup || (handWritten && !runsAmendments)) {
      for (const subject of subjects) {
        it(
          `${subject.name} still shows something else than it states`,
          async () => {
            const { stated, shown } = await runOrBreak(subject);
            expect(shown).not.toEqual(stated);
          },
          subjectTimeout,
        );
      }
      return;
    }
    for (const subject of subjects) {
      it(
        subject.name,
        async () => {
          const { golden, stated, shown } = await runOf(subject);
          expect(shown).toEqual(stated);
          if (updating && !handWritten) {
            ran.add(subject.name);
            if (Object.keys(golden).length > 0) {
              fresh[subject.name] = golden;
            }
            return;
          }
          expect(golden).toEqual(recorded[subject.name] ?? {});
        },
        subjectTimeout,
      );
    }
  });

  afterAll(() => {
    if (updating && ran.size > 0) {
      const names = new Set(subjects.map(({ name }) => name));
      const kept = Object.entries(recorded).filter(([name]) => names.has(name) && !ran.has(name));
      const sorted = Object.fromEntries(
        [...kept, ...Object.entries(fresh)].toSorted(([first], [second]) =>
          first.localeCompare(second),
        ),
      );
      writeFileSync(file, `${JSON.stringify(sorted, undefined, 2)}\n`);
    }
  });
}

/** The goldens `file` records; none for a group never recorded yet. */
function readRecorded(file: URL): Readonly<Record<string, Golden>> {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, Golden>) : {};
}

/**
 * What running a subject showed: its golden, and the ending its source states beside the part of
 * the ending shown in its place, both absent for a subject stating none.
 */
interface Run {
  readonly golden: Golden;
  readonly stated?: Partial<Ending>;
  readonly shown?: Partial<Ending>;
}

async function runOf(subject: Subject): Promise<Run> {
  if (subject.kind === 'suite') {
    return { golden: { lines: await observeSuite(subject.project, subject.paths) } };
  }
  if (subject.kind === 'scenario') {
    return { golden: { steps: await observeScenario(subject.scenario) } };
  }
  const observed = await observeProgram(subject);
  if ('problem' in observed) {
    throw new Error(`${subject.name} doesn't compile: ${observed.problem}`);
  }
  const { logs, hostCalls, ending } = observed;
  const stated = statedEnding(subject);
  if (stated === undefined) {
    return { golden: withoutEmpty({ ...ending, logs, hostCalls }) };
  }
  // A panic's frame is what its header leaves unstated; any other ending is stated whole.
  const [shown, rest] =
    'panic' in ending ? [{ panic: ending.panic }, { frame: ending.frame }] : [ending, {}];
  return { golden: withoutEmpty({ ...rest, logs, hostCalls }), stated, shown };
}

/** What running `subject` showed, or the toolchain invariant its run broke. */
async function runOrBreak(subject: Subject): Promise<Run> {
  try {
    return await runOf(subject);
  } catch (error) {
    if (error instanceof Unreachable && subject.kind === 'program') {
      const stated = statedEnding(subject);
      return {
        golden: {},
        shown: { panic: error.message },
        ...(stated === undefined ? {} : { stated }),
      };
    }
    throw error;
  }
}

/** The ending `subject`'s first line states, if it states one. */
function statedEnding({ stated }: ProgramSubject): Partial<Ending> | undefined {
  if (stated === undefined) {
    return undefined;
  }
  return stated.expects === 'outcome' ? { outcome: stated.expected } : { panic: stated.expected };
}
