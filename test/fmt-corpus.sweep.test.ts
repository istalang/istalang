/**
 * `ista fmt` over the corpus: on a copy of it, beside a module with syntax errors it must leave
 * alone, it formats every module, and `ista fmt --check` then lists nothing, so the format the
 * command writes is the format it accepts. The corpus's modules that aren't programs it runs (the
 * invalid programs, the module corpora) report the same diagnostics after it as before; that each
 * program it runs, rewritten so, does what it did is the corpus sweep's (sweep/checks/formatting.ts),
 * which compiles each once.
 *
 * `ista fmt` is what is tested, so it runs as the CLI, once for the file. What the modules report is
 * read in-process, as `ista check` loads them, the formatted modules' checker taking over what fmt
 * left alike (check.ts `checkProgram`).
 */

import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ista, type Run } from '../src/cli/cli.test-kit.ts';
import { checkProgram } from '../src/compiler/checker/check.ts';
import { diagnosticsWithoutPlaces } from '../src/compiler/compile.test-kit.ts';
import { diagnose } from '../src/compiler/compile.ts';
import type { Program } from '../src/compiler/program/program.ts';
import { formattableInputs } from '../src/formatter/format.test-kit.ts';
import { formatText } from '../src/formatter/format.ts';
import { tempProject } from '../src/project/project.test-kit.ts';
import { findProjectSources, loadProject } from '../src/project/project.ts';
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

/**
 * The modules in `root` but the programs it runs, as `ista check` loads them, reusing what
 * `previous` parsed alike.
 */
function projectAt(root: string, previous?: Program): Program {
  const programs = new Set(runPrograms.map(({ name }) => join(root, name)));
  const sources = findProjectSources(root).filter((source) => !programs.has(resolve(root, source)));
  return loadProject(root, sources, { previous }).program;
}

/** A module with syntax errors, in line breaks and a tab that fmt would rewrite if it touched it. */
const badSyntax = { name: 'bad-syntax.ista', text: 'fn   f(:\r\n\t1\n' };

describe('ista fmt over the corpus', () => {
  /** The project on a copy of the corpus, `badSyntax` beside its modules, before `ista fmt`. */
  let original: Program;
  /**
   * What `ista fmt` and then `ista fmt --check` did there, the text fmt left of `badSyntax`, and
   * the project it left, whose checker takes over what checking `original` found where fmt left a
   * module alike. All of it is read here, since the copy goes with the first test (`tempProject`).
   */
  let formatted: {
    readonly run: Run;
    readonly check: Run;
    readonly badSyntax: string;
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
    formatted = {
      run,
      check: await ista(root, 'fmt', '--check'),
      badSyntax: readFileSync(join(root, badSyntax.name), 'utf8'),
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
    expect(formatted.badSyntax).toBe(badSyntax.text);
  });

  it('leaves what the modules it runs no program of report as it was', () => {
    expect(diagnosticsWithoutPlaces(formatted.project)).toEqual(diagnosticsWithoutPlaces(original));
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
