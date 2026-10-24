/**
 * The programs of test/corpus/run, each with the outcome it must have: its first line says
 * `# outcome: <json>` or `# panic: <message>`. Every phase that runs or compiles whole programs
 * reads them here, so a new program is picked up by all of them.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface RunProgram {
  readonly name: string;
  readonly text: string;
  readonly expects: 'outcome' | 'panic';
  /** The outcome's JSON, or the panic's message. */
  readonly expected: string;
}

/** The directory holding the programs, for running them where they are. */
export const runCorpusDirectory = fileURLToPath(new URL('./run/', import.meta.url));

const expectation = /^# (?<expects>outcome|panic): (?<expected>.*)$/mu;

export const runPrograms: readonly RunProgram[] = readdirSync(runCorpusDirectory)
  .filter((name) => name.endsWith('.ista'))
  .map((name) => {
    const text = readFileSync(`${runCorpusDirectory}${name}`, 'utf8');
    const { expects, expected } = expectation.exec(text)?.groups ?? {};
    if ((expects !== 'outcome' && expects !== 'panic') || expected === undefined) {
      throw new Error(`${name} doesn't state its expected outcome on its first line.`);
    }
    return { name, text, expects, expected };
  });
