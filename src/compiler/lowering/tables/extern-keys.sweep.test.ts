/**
 * Extern and start keys and host externs' declared types are persisted (docs/arch/definition.md,
 * "Externs"): a store and a host's tables hold them across deploys, which refuse a program whose
 * spelling of one changed (`externChanged`). So they are frozen bytes, here over every std extern,
 * the example projects' runnable modules and the runnable corpus programs: a change to how a type
 * is spelled anywhere else must leave this file as it is.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { corpusDirectory, runPrograms } from '../../../../test/corpus/programs.ts';
import type { Definition } from '../../../definition/definition.ts';
import { compareOrdered } from '../../../foundation/language/order.ts';
import { loadProject } from '../../../project/project.ts';
import { stdExterns } from '../../../stdlib/std-externs.test-kit.ts';
import { compileProgram } from '../../compile.ts';

const examples = fileURLToPath(new URL('../../../../examples/', import.meta.url));

/** The Definition running `entry`, a path under `root`; undefined when it has no `main`. */
function definitionOf(root: string, entry: string): Definition | undefined {
  const { program } = loadProject(root, [entry]);
  const [module] = program.roots;
  const compilation = module === undefined ? undefined : compileProgram(program, module);
  return compilation?.kind === 'compiled' ? compilation.definition : undefined;
}

/** Every key and declared type a Definition persists, one line each. */
function persistedSpellings(definition: Definition): readonly string[] {
  const externs = definition.functions.flatMap((entry) =>
    entry.kind === 'extern'
      ? [
          `extern ${entry.key}${entry.declaredType === undefined ? '' : ` -> ${entry.declaredType}`}`,
        ]
      : [],
  );
  return [...externs, ...definition.starts.map(({ key }) => `start ${key}`)];
}

/** Each example project's modules a host runs: those declaring `main`. */
function exampleDefinitions(): readonly Definition[] {
  return readdirSync(examples, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap(({ name }) => {
      const root = `${examples}${name}`;
      return readdirSync(root)
        .filter((file) => file.endsWith('-demo.ista'))
        .flatMap((file) => definitionOf(root, file) ?? []);
    });
}

describe('persisted keys', () => {
  it('spell every std extern, example and corpus program as before', async () => {
    const definitions = [
      ...exampleDefinitions(),
      ...runPrograms.flatMap(({ name }) => definitionOf(corpusDirectory, name) ?? []),
    ];
    const spelled = new Set([
      ...stdExterns().externs.map(({ key }) => `extern ${key}`),
      ...definitions.flatMap(persistedSpellings),
    ]);
    await expect(`${[...spelled].sort(compareOrdered).join('\n')}\n`).toMatchFileSnapshot(
      'extern-keys.txt',
    );
  }, 120_000);
});
