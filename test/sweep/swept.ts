/**
 * The subjects the corpus sweep checks (../golden/subjects.ts), each as the kind of subject its
 * checks tell apart, and what they derive of a program: its compile, its Definition's text and
 * what it shows run, each once however many checks read it, and kept no longer than its subject
 * object lives.
 *
 * - A program stating its ending and one stating nothing (a spec example's, a demo's) are kinds
 *   apart, since checks hold each to different things.
 * - `GOLDEN=update` records what the checks that record something see (`recording`), instead of
 *   checking it; one process then sweeps every subject, so each file recorded has one writer.
 */

import process from 'node:process';
import { type EncodedDefinition, encodeDefinition } from '../../src/definition/definition.ts';
import type { Handlers } from '../../src/foundation/structures/kind-table.ts';
import { memo } from '../../src/foundation/structures/memo.ts';
import type { Observation } from '../golden/observation.ts';
import { type Compiled, compiledAt, observeCompiled } from '../golden/pipeline/index.ts';
import {
  type ProgramSubject,
  type ScenarioSubject,
  type SuiteSubject,
  subjectGroups,
} from '../golden/subjects.ts';

/** The kinds of program a check tells apart (the banner). */
type ProgramKind = 'stating' | 'example';

/** A subject, by the group whose golden file records it, as the kind of subject checks tell apart. */
export type Swept =
  | { readonly [Kind in ProgramKind]: SweptAs<Kind, ProgramSubject> }[ProgramKind]
  | SweptAs<'suite', SuiteSubject>
  | SweptAs<'scenario', ScenarioSubject>;

interface SweptAs<Kind extends string, Subject> {
  readonly kind: Kind;
  readonly group: string;
  readonly subject: Subject;
}

/** How many things a check held of a subject, so a check holding of nothing shows. */
export type Held = number;

/** A check: what it holds of each kind of subject it checks, and what it records when recording. */
export interface Check {
  readonly holds: Partial<Handlers<undefined, Swept, [], Held | Promise<Held>>>;
  /** Writes what it saw, having run on every subject it checks when `everySubject`. */
  readonly record?: (everySubject: boolean) => void;
}

/** Whether this run records what the checks see instead of checking it (the banner). */
// biome-ignore lint/style/noProcessEnv: the switch between checking and recording, as vitest's own -u is.
export const recording = process.env.GOLDEN === 'update';

/** Every subject, in the order of its group and its place there. */
export const sweptSubjects: readonly Swept[] = [...subjectGroups].flatMap(([group, subjects]) =>
  subjects.map((subject): Swept => {
    switch (subject.kind) {
      case 'suite':
        return { kind: subject.kind, group, subject };
      case 'scenario':
        return { kind: subject.kind, group, subject };
      default:
        return { kind: subject.stated === undefined ? 'example' : 'stating', group, subject };
    }
  }),
);

/**
 * `swept` with a subject object of its own: what checks derive of a subject is kept by that object,
 * so a visit's goes once the visit does, rather than with the process.
 */
export function visitOf(swept: Swept): Swept {
  return { ...swept, subject: { ...swept.subject } } as Swept;
}

const compiles = new WeakMap<ProgramSubject, ReturnType<typeof compiledAt>>();
const encodings = new WeakMap<ProgramSubject, EncodedDefinition>();
const observations = new WeakMap<ProgramSubject, Promise<Observation>>();

/** `subject` compiled; throws the first error it reports, every time it is asked. */
export function compiledOf(subject: ProgramSubject): Compiled {
  const compiled = memo(compiles, subject, () =>
    compiledAt(subject.directory, subject.path, subject.text),
  );
  if ('problem' in compiled) {
    throw new Error(`${subject.name} doesn't compile: ${compiled.problem}`);
  }
  return compiled;
}

/** `subject`'s Definition encoded, as a host deploys it. */
export function encodedOf(subject: ProgramSubject): EncodedDefinition {
  return memo(encodings, subject, () => encodeDefinition(compiledOf(subject).definition));
}

/** What `subject` showed run as the goldens run it. */
export function observedOf(subject: ProgramSubject): Promise<Observation> {
  return memo(observations, subject, () =>
    observeCompiled(compiledOf(subject).definition, subject),
  );
}
