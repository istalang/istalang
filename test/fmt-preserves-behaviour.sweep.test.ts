/**
 * `ista fmt` changes how a project reads, never what it does: on a copy of the whole corpus, beside
 * a module with syntax errors it must leave alone, the project reports the same diagnostics after
 * `ista fmt` as before, and every runnable program it rewrote ends as the original does, the
 * instances it spawned included. `ista fmt --check` then lists nothing, so the format the command
 * writes is the format it accepts.
 *
 * `ista fmt` is what is tested, so it runs as the CLI, once for the file. What the project reports
 * is read in-process, as `ista check` loads it, the formatted project's checker taking over what
 * fmt left alike (check.ts `checkProgram`). What a program does is how each instance of its run on
 * a manual clock ends, as `ista run` would print or report it; a program fmt left as it was is the
 * same program, so only those it rewrote run.
 */

import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ista, type Run } from '../src/cli/cli.test-kit.ts';
import { checkProgram } from '../src/compiler/checker/check.ts';
import { compiledText } from '../src/compiler/compile.test-kit.ts';
import { diagnose } from '../src/compiler/compile.ts';
import type { Program } from '../src/compiler/program/program.ts';
import { formattableInputs } from '../src/formatter/format.test-kit.ts';
import { formatText } from '../src/formatter/format.ts';
import { tempProject } from '../src/project/project.test-kit.ts';
import { findProjectSources, loadProject } from '../src/project/project.ts';
import { type Oracle, oracleFor } from '../src/runtime/lifetimes/oracle.test-kit.ts';
import { settleStored, testRuntime } from '../src/runtime/runtime.test-kit.ts';
import { corpusDirectory, runPrograms } from './corpus/programs.ts';

/** A copy of the corpus on disk, its `.ista` files only. */
function corpusCopy(): string {
  const root = tempProject({});
  cpSync(corpusDirectory, root, {
    recursive: true,
    filter: (path) => !path.endsWith('.ts'),
  });
  return root;
}

/** The project in `root` as `ista check` loads it, reusing what `previous` parsed alike. */
function projectAt(root: string, previous?: Program): Program {
  return loadProject(root, findProjectSources(root), { previous }).program;
}

/** Each diagnostic of `program` by module path, positions aside: formatting moves them. */
function diagnosticsOf(program: Program) {
  return [...diagnose(program).values()].flatMap(({ source, diagnostics }) =>
    diagnostics.map(({ severity, code, message }) => ({
      path: source.path,
      severity,
      code,
      message,
    })),
  );
}

/**
 * How a run of the program `text` ended, by instance: `main`, then each instance it left in the
 * store, its contexts and what they spawned, run on to the end as a later run would resume them.
 * `main`'s outcome is the JSON `ista run` prints, another's the value its function gave, and each
 * panic's message is given without its trace, which names the lines frames stood at. Its heaps are
 * checked by `oracle`.
 */
async function endingsOf(text: string, oracle: Oracle) {
  const test = testRuntime({ heapCheck: oracle.heapCheck });
  const program = test.runtime.deploy(compiledText(text));
  const main = await program.start('main');
  const stored = await settleStored(test);
  return [['main', main.state] as const, ...stored].map(([instance, ending]) => {
    switch (ending.kind) {
      case 'finished':
        return instance === 'main'
          ? { instance, kind: ending.kind, outcome: program.outcomeText(ending) }
          : { instance, kind: ending.kind, outcome: ending.outcome };
      case 'panicked':
      case 'terminated':
        return { instance, kind: ending.kind, message: ending.message };
      default:
        return { instance, kind: ending.kind };
    }
  });
}

/**
 * How a run of `text` ends, and of `rewritten`, both checked by `oracle`; neither runs when they are
 * the same program.
 */
async function bothEndings(text: string, rewritten: string, oracle: Oracle) {
  return rewritten === text
    ? { before: [], after: [] }
    : { before: await endingsOf(text, oracle), after: await endingsOf(rewritten, oracle) };
}

/** A module with syntax errors, in line breaks and a tab that fmt would rewrite if it touched it. */
const badSyntax = { name: 'bad-syntax.ista', text: 'fn   f(:\r\n\t1\n' };

describe('ista fmt over the corpus', () => {
  /** The project on a copy of the corpus, `badSyntax` beside its modules, before `ista fmt`. */
  let original: Program;
  /**
   * What `ista fmt` and then `ista fmt --check` did there, each module's text as fmt left it, and
   * the project it left, whose checker takes over what checking `original` found where fmt left a
   * module alike. All of it is read here, since the copy goes with the first test (`tempProject`).
   */
  let formatted: {
    readonly run: Run;
    readonly check: Run;
    readonly texts: ReadonlyMap<string, string>;
    readonly project: Program;
  };

  beforeAll(async () => {
    const root = corpusCopy();
    writeFileSync(join(root, badSyntax.name), badSyntax.text);
    original = projectAt(root);
    diagnose(original);
    const run = await ista(root, 'fmt');
    const project = projectAt(root, original);
    checkProgram(project, { previous: original });
    const names = [...runPrograms.map(({ name }) => name), badSyntax.name];
    formatted = {
      run,
      check: await ista(root, 'fmt', '--check'),
      texts: new Map(names.map((name) => [name, readFileSync(join(root, name), 'utf8')])),
      project,
    };
  });

  it('formats every module of the project, in the format --check accepts', () => {
    expect(formatted.run.err).not.toContain('node_modules');
    expect(formatted.check).toMatchObject({ out: '' });
  });

  it('does not touch a file that has syntax errors, byte for byte', () => {
    // Invalid programs hold syntax errors too, which fmt reports and leaves alone: exit 1, by design.
    expect(formatted.run.code).toBe(1);
    expect(formatted.run.err).toContain(badSyntax.name);
    expect(formatted.texts.get(badSyntax.name)).toBe(badSyntax.text);
  });

  it('leaves what the project reports as it was', () => {
    expect(diagnosticsOf(formatted.project)).toEqual(diagnosticsOf(original));
  });

  it.each(runPrograms)('leaves what $name does as it was', async ({ name, text }) => {
    const rewritten = formatted.texts.get(name) ?? '';
    const { before, after } = await bothEndings(text, rewritten, oracleFor(name));
    expect(after).toEqual(before);
  });
});

describe('ista fmt over line breaks (spec §2: `\\n`, `\\r\\n` or a lone `\\r`)', () => {
  /** Each formattable input formatted as written, with `\n`, once for both line breaks. */
  let lfTwins: readonly ReturnType<typeof formatText>[];

  beforeAll(() => {
    lfTwins = formattableInputs.map(({ text }) => formatText(text));
  });

  it.each([
    ['a CRLF', '\r\n'],
    ['a lone-CR', '\r'],
  ])('formats %s module as its LF twin', (_, lineBreak) => {
    const different = formattableInputs.filter(
      ({ text }, index) => formatText(text.replaceAll('\n', lineBreak)) !== lfTwins[index],
    );
    expect(different.map(({ name }) => name)).toEqual([]);
  });
});
