/**
 * `ista fmt` changes how a project reads, never what it does: over a copy of the whole corpus,
 * `ista check` reports the same diagnostics, and every runnable program prints the same outcome or
 * panic, before and after `ista fmt`. A second `ista fmt --check` then lists nothing, so the
 * format the command writes is the format it accepts.
 */

import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ista } from '../src/cli/cli.test-kit.ts';
import { formattableInputs } from '../src/formatter/format.test-kit.ts';
import { formatText } from '../src/formatter/format.ts';
import { tempProject } from '../src/project/project.test-kit.ts';
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

const diagnosticLine = /^(?<file>\S+):\d+:\d+: (?<what>.*)$/gmu;

/** Each diagnostic of `ista check`'s report as file and message: formatting moves positions. */
function diagnosticsIn(report: string): readonly string[] {
  return [...report.matchAll(diagnosticLine)].map(
    ({ groups }) => `${groups?.file}: ${groups?.what}`,
  );
}

/** What `ista check` and every `ista run` say in `root`, positions aside. */
async function behaviour(root: string) {
  const runs = await Promise.all(runPrograms.map(({ name }) => ista(root, 'run', name)));
  const check = await ista(root, 'check');
  return {
    check: { code: check.code, diagnostics: diagnosticsIn(check.out) },
    // A panic's trace names the lines frames stood at, which formatting moves.
    runs: runs.map(({ code, out, err }) => ({ code, out, err: err.split('\n')[0] })),
  };
}

describe('ista fmt over the corpus', () => {
  it('leaves what check reports and what every program does as it was, and is then stable', {
    timeout: 120_000,
  }, async () => {
    const root = corpusCopy();
    const before = await behaviour(root);
    const formatted = await ista(root, 'fmt');
    // Invalid programs hold syntax errors, which fmt reports and leaves alone: exit 1, by design.
    expect(formatted.err).not.toContain('node_modules');
    const after = await behaviour(root);
    expect(after.check).toEqual(before.check);
    after.runs.forEach((run, index) => {
      expect(run, runPrograms[index]?.name).toEqual(before.runs[index]);
    });
    expect(await ista(root, 'fmt', '--check')).toMatchObject({ out: '' });
  });

  it('does not touch a file that has syntax errors, byte for byte', async () => {
    const root = corpusCopy();
    const bad = join(root, 'bad-syntax.ista');
    const text = 'fn   f(:\r\n\t1\n';
    writeFileSync(bad, text);
    const run = await ista(root, 'fmt');
    expect(run.code).toBe(1);
    expect(run.err).toContain('bad-syntax.ista');
    expect(readFileSync(bad, 'utf8')).toBe(text);
  });
});

describe('ista fmt over line breaks (spec §2: `\\n`, `\\r\\n` or a lone `\\r`)', () => {
  const breaks = { 'a CRLF': '\r\n', 'a lone CR': '\r' } as const;

  // Open bug: a CRLF is read as two line breaks, so it writes a blank line after every statement
  // and item. `it.fails` turns green-by-accident into a loud failure once it is fixed.
  it.fails('formats a CRLF module as its LF twin', () => {
    const different = formattableInputs.filter(
      ({ text }) => formatText(text.replaceAll('\n', breaks['a CRLF'])) !== formatText(text),
    );
    expect(different.map(({ name }) => name)).toEqual([]);
  });

  it('formats a lone-CR module as its LF twin', () => {
    const different = formattableInputs.filter(
      ({ text }) => formatText(text.replaceAll('\n', breaks['a lone CR'])) !== formatText(text),
    );
    expect(different.map(({ name }) => name)).toEqual([]);
  });
});
