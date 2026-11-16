/**
 * Compiled JavaScript runs every corpus program as the interpreter does: the same outcome or panic,
 * the same log records and the same calls of its host (docs/work/js-codegen/design.md,
 * "Verification"), and so FormBuilder's demos. A program whose work needs ista code is left to the
 * interpreter, and one compiled JavaScript runs differently is named with why.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { corpusDirectory, runProgramOf, runPrograms } from '../../test/corpus/programs.ts';
import { specExamples } from '../../test/corpus/spec-examples.ts';
import {
  compiledAt,
  freshHost,
  type RecordingHost,
  recording,
  shownByInterpreter,
} from '../../test/golden/pipeline.ts';
import type { Definition } from '../definition/definition.ts';
import type { LiveProgram } from '../live/program.ts';
import { asLive, compiledToJavaScript, shownByJavaScript } from './differential.test-kit.ts';

/** How a program that doesn't check names its first error (differential.test-kit.ts). */
const checkError = /^error \d+/u;

/** A spec example declaring the `main` a host starts. */
const declaresMain = /^live async fn main\(/mu;

const formBuilder = fileURLToPath(new URL('../../examples/FormBuilder/', import.meta.url));

/**
 * Programs, in the corpus's format, that compiled JavaScript once ran differently: kept here, not in
 * the corpus, when what they need trips a check every corpus program is held to (a `select` over a
 * program's own awaitables records untyped flow facts, tracker B112; a log record, which `ista run`
 * prints where a corpus program prints nothing but its outcome).
 */
const regressions = fileURLToPath(new URL('./regressions/', import.meta.url));
// Compiling the supplier form costs seconds, and the interpreter runs it slowly.
const formBuilderRun = 60_000;

/**
 * Programs compiled JavaScript runs differently, and why; each still does, or it leaves this list.
 */
const differences: ReadonlyMap<string, string> = new Map();

describe('compiled JavaScript runs each corpus program as the interpreter does', () => {
  for (const { name, text } of runPrograms) {
    const compiled = compiledAt(corpusDirectory, name, asLive(text));
    const difference = differences.get(name);
    if ('problem' in compiled) {
      it(`leaves ${name} to the interpreter: its work needs ista code, ${compiled.problem}`, () => {
        expect(compiled.problem).toMatch(checkError);
      });
    } else if (difference === undefined) {
      it(name, async () => {
        const program = await javaScriptOf(compiled.definition);
        expect(await shownByJavaScript(program)).toEqual(
          await shownByInterpreter(compiled.definition),
        );
      });
    } else {
      it(`runs ${name} differently, as known: ${difference}`, async () => {
        const program = await javaScriptOf(compiled.definition);
        expect(await shownByJavaScript(program)).not.toEqual(
          await shownByInterpreter(compiled.definition),
        );
      });
    }
  }
});

describe('compiled JavaScript runs each spec example declaring main as the interpreter does', () => {
  const programs = specExamples.filter(
    ({ form, code }) => form === 'module' && declaresMain.test(code),
  );
  for (const { document, line, code } of programs) {
    const name = `${document}:${line}`;
    const compiled = compiledAt(corpusDirectory, `spec-${line}.ista`, asLive(code));
    if ('problem' in compiled) {
      it(`leaves ${name} out: no whole program as live code, ${compiled.problem}`, () => {
        expect(compiled.problem).toMatch(checkError);
      });
    } else {
      it(name, async () => {
        const program = await javaScriptOf(compiled.definition);
        expect(await shownByJavaScript(program)).toEqual(
          await shownByInterpreter(compiled.definition),
        );
      });
    }
  }
});

describe('compiled JavaScript runs what it once ran differently as the interpreter does', () => {
  for (const name of readdirSync(regressions)) {
    const program = runProgramOf({ name, text: readFileSync(`${regressions}${name}`, 'utf8') });
    it(name, async () => {
      const compiled =
        program === undefined ? undefined : compiledAt(regressions, name, program.text);
      if (program === undefined || compiled === undefined || 'problem' in compiled) {
        throw new Error(`${name} states no outcome, or doesn't compile.`);
      }
      expect(await shownByJavaScript(await javaScriptOf(compiled.definition))).toEqual(
        await shownByInterpreter(compiled.definition),
      );
    });
  }
});

describe("compiled JavaScript serves FormBuilder's forms as the interpreter does", () => {
  it.each(['order', 'supplier'])(
    'the %s demo shows its host the same views and ends the same',
    async (form) => {
      const path = `${form}-demo.ista`;
      const compiled = compiledAt(formBuilder, path, readFileSync(`${formBuilder}${path}`, 'utf8'));
      if ('problem' in compiled) {
        throw new Error(compiled.problem);
      }
      const program = await javaScriptOf(compiled.definition);
      expect(await shownByJavaScript(program, await hostOf(form))).toEqual(
        await shownByInterpreter(compiled.definition, await hostOf(form)),
      );
    },
    formBuilderRun,
  );
});

/** The demo host of `form`, loaded afresh, recording its calls. */
async function hostOf(form: string): Promise<RecordingHost> {
  return recording(await freshHost(`${formBuilder}${form}-demo.host.mjs`));
}

/** `definition` compiled to JavaScript and loaded. */
async function javaScriptOf(definition: Definition): Promise<LiveProgram> {
  const program = await compiledToJavaScript(definition);
  if (typeof program === 'string') {
    throw new Error(program);
  }
  return program;
}
