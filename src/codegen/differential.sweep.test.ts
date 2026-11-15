/**
 * Compiled JavaScript runs every corpus program as the interpreter does: the same outcome or panic,
 * the same log records and the same calls of its host (docs/work/js-codegen/design.md,
 * "Verification"), and so FormBuilder's demos. A program whose work needs ista code is left to the
 * interpreter, and one compiled JavaScript runs differently is named with why.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { corpusDirectory, runPrograms } from '../../test/corpus/programs.ts';
import { specExamples } from '../../test/corpus/spec-examples.ts';
import { loadHostModule } from '../cli/host-module.ts';
import type { Definition } from '../definition/definition.ts';
import type { LiveProgram } from '../live/program.ts';
import {
  asLive,
  compiledAt,
  compiledToJavaScript,
  recording,
  shownByInterpreter,
  shownByJavaScript,
} from './differential.test-kit.ts';

/** How a program that doesn't check names its first error (differential.test-kit.ts). */
const checkError = /^error \d+/u;

/** A spec example declaring the `main` a host starts. */
const declaresMain = /^live async fn main\(/mu;

const formBuilder = fileURLToPath(new URL('../../examples/FormBuilder/', import.meta.url));
// Compiling the supplier form costs seconds, and the interpreter runs it slowly.
const formBuilderRun = 60_000;

/** Why a program disposing what it holds runs differently until disposal lands. */
const disposal = 'a disposal runs once disposal lands (js-codegen P2)';

/**
 * Programs compiled JavaScript runs differently, and why; each still does, or it leaves this list.
 */
const differences: ReadonlyMap<string, string> = new Map([
  ['holders/bindings.ista', disposal],
  ['holders/block-tail.ista', disposal],
  ['holders/defer.ista', disposal],
  ['holders/dispose.ista', disposal],
  ['holders/exits.ista', disposal],
  ['holders/function-holdings.ista', disposal],
  ['holders/hold-scopes.ista', disposal],
  ['holders/lifetimes.ista', disposal],
  ['run/recursion.ista', 'it recurses 100,000 calls deep, past the JavaScript stack'],
]);

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
      expect(await shownByJavaScript(program, await freshHost(form))).toEqual(
        await shownByInterpreter(compiled.definition, await freshHost(form)),
      );
    },
    formBuilderRun,
  );
});

/** The demo host of `form`, loaded afresh, since it keeps the events it serves as it serves them. */
async function freshHost(form: string): Promise<ReturnType<typeof recording>> {
  vi.resetModules();
  const loaded = await loadHostModule(`${formBuilder}${form}-demo.host.mjs`);
  if (loaded.kind === 'unfit') {
    throw new Error(loaded.problem);
  }
  return recording(loaded.externs);
}

/** `definition` compiled to JavaScript and loaded. */
async function javaScriptOf(definition: Definition): Promise<LiveProgram> {
  const program = await compiledToJavaScript(definition);
  if (typeof program === 'string') {
    throw new Error(program);
  }
  return program;
}
