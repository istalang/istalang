/**
 * Everything the goldens record, by group (docs/work/ir-first/contracts.md, "Goldens"): each
 * subject keyed by the file it comes from, so a golden has one home beside what its source states.
 *
 * - `corpus` and `regressions`: programs whose first line states their outcome or panic, which
 *   stays the home of that result; their goldens hold the rest.
 * - `amended`: programs written by hand to a spec amendment the interpreter predates
 *   (docs/work/ir-first/design.md, "Spec amendments"), stating their results as the corpus does;
 *   their goldens are written by hand too.
 * - `spec-examples`: the examples of the spec and guide that are whole programs, checking clean
 *   alone and declaring a `main` a host starts, keyed by document, section and place in it, since
 *   lines move with every edit. An example that isn't one is the checker's to test.
 * - `form-builder`: FormBuilder's demos with their hosts, whose calls are the views shown.
 * - `scenarios`: host scenarios (scenarios.ts), whose goldens hold what each step showed.
 * - `suites`: `.test.ista` modules, a std module's or a project's together, whose assertions state
 *   their results; their goldens hold what `ista test` prints of them.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { diagnose } from '../../src/compiler/compile.ts';
import { moduleIdOf } from '../../src/compiler/program/program.ts';
import { isError } from '../../src/foundation/diagnostics/diagnostic.ts';
import { isTestModulePath } from '../../src/foundation/language/well-known/testing.ts';
import { loadProject } from '../../src/project/project.ts';
import { corpusDirectory, runProgramOf, runPrograms } from '../corpus/programs.ts';
import { specCode, specExamples } from '../corpus/spec-examples.ts';
import type { ProgramRun, SuiteProject } from './pipeline.ts';
import { type Scenario, scenarios } from './scenarios.ts';

/** What a program's first line states it ends with. */
type Stated = Pick<NonNullable<ReturnType<typeof runProgramOf>>, 'expects' | 'expected'>;

export interface ProgramSubject extends ProgramRun {
  readonly kind: 'program';
  readonly name: string;
  readonly stated?: Stated;
}

interface SuiteSubject {
  readonly kind: 'suite';
  readonly name: string;
  readonly project: SuiteProject;
  /** The test modules or folders `ista test` runs, in the project; all of them without any. */
  readonly paths: readonly string[];
}

interface ScenarioSubject {
  readonly kind: 'scenario';
  readonly name: string;
  readonly scenario: Scenario;
}

export type Subject = ProgramSubject | SuiteSubject | ScenarioSubject;

const root = fileURLToPath(new URL('../../', import.meta.url));
const regressions = `${root}test/regressions/`;
const amended = fileURLToPath(new URL('./amended/', import.meta.url));
const formBuilder = `${root}examples/FormBuilder/`;
const stdlib = `${root}src/stdlib/`;

/** A spec example declaring the `main` a host starts. */
const declaresMain = /^(?:live async )?fn main\(/mu;

function corpusSubjects(): ProgramSubject[] {
  return runPrograms.map(({ name, text, expects, expected }) => ({
    kind: 'program',
    name,
    directory: corpusDirectory,
    path: name,
    text,
    stated: { expects, expected },
  }));
}

/** The programs in `directory`, each stating its outcome or panic on its first line. */
function statingSubjects(directory: string): ProgramSubject[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.ista'))
    .toSorted()
    .map((name) => {
      const text = readFileSync(`${directory}${name}`, 'utf8');
      const program = runProgramOf({ name, text });
      if (program === undefined) {
        throw new Error(`${name} doesn't state its outcome on its first line.`);
      }
      const { expects, expected } = program;
      return { kind: 'program', name, directory, path: name, text, stated: { expects, expected } };
    });
}

function specExampleSubjects(): ProgramSubject[] {
  const places = new Map<string, number>();
  return specExamples.flatMap(({ document, section, code, form, elided }) => {
    const key = `${document} § ${section}`;
    const place = (places.get(key) ?? 0) + 1;
    places.set(key, place);
    if (form !== 'module' || elided || !declaresMain.test(code) || !checksAlone(code)) {
      return [];
    }
    const name = `${key} #${place}`;
    return [
      { kind: 'program', name, directory: corpusDirectory, path: 'example.ista', text: code },
    ];
  });
}

/** Whether `code` checks clean as a module of its own, a whole program rather than a part of one. */
function checksAlone(code: string): boolean {
  const id = moduleIdOf(pathToFileURL(`${corpusDirectory}example.ista`));
  const { program } = loadProject(corpusDirectory, [], {
    buffers: [{ id, name: 'example', label: 'example.ista', read: () => code }],
  });
  return ![...diagnose(program).values()].some(({ diagnostics }) => diagnostics.some(isError));
}

function formBuilderSubjects(): ProgramSubject[] {
  return ['order', 'supplier'].map((form) => ({
    kind: 'program',
    name: form,
    directory: formBuilder,
    path: `${form}-demo.ista`,
    text: readFileSync(`${formBuilder}${form}-demo.ista`, 'utf8'),
    host: `${form}-demo.host.mjs`,
  }));
}

/**
 * Every std module's suites, one subject per module, as `ista test` runs them, since a module's
 * test modules may share helpers that hold no suite; FormBuilder's; and spec §10's suite against
 * spec §12.1's purchase approval, written beside it when it runs.
 */
function suiteSubjects(): SuiteSubject[] {
  const stdModules = readdirSync(stdlib, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && readdirSync(`${stdlib}${entry.name}`).some(isTestModulePath),
    )
    .map(({ name }) => name)
    .toSorted();
  return [
    ...stdModules.map(
      (module): SuiteSubject => ({
        kind: 'suite',
        name: `src/stdlib/${module}`,
        project: { directory: stdlib },
        paths: [module],
      }),
    ),
    { kind: 'suite', name: 'examples/FormBuilder', project: { directory: formBuilder }, paths: [] },
    {
      kind: 'suite',
      name: 'test/spec-suites/purchase.test.ista',
      project: {
        files: {
          'purchase.ista': [...specCode('12.1 Purchase approval'), ''].join('\n'),
          'purchase.test.ista': readFileSync(`${root}test/spec-suites/purchase.test.ista`, 'utf8'),
        },
      },
      paths: [],
    },
  ];
}

/** Every subject, by the group whose golden file records it. */
export const subjectGroups: ReadonlyMap<string, readonly Subject[]> = new Map<
  string,
  readonly Subject[]
>([
  ['corpus', corpusSubjects()],
  ['regressions', statingSubjects(regressions)],
  ['amended', statingSubjects(amended)],
  ['spec-examples', specExampleSubjects()],
  ['form-builder', formBuilderSubjects()],
  ['suites', suiteSubjects()],
  ['scenarios', scenarios.map((scenario) => ({ kind: 'scenario', name: scenario.name, scenario }))],
]);
