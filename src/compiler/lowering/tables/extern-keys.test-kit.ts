/**
 * Extern and start keys and host externs' declared types are persisted (docs/arch/definition.md,
 * "Externs"): a store and a host's tables hold them across deploys, which refuse a program whose
 * spelling of one changed (`externChanged`). So they are frozen bytes, `extern-keys.txt`, one line
 * each: every std extern's (extern-keys.test.ts), and every one a program the corpus sweep compiles
 * persists (test/sweep). A change to how a type is spelled anywhere else must leave the file as it
 * is; only recording the goldens writes it (test/golden/golden.md).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { Definition } from '../../../definition/definition.ts';
import { compareOrdered } from '../../../foundation/language/order.ts';
import { stdExterns } from '../../../stdlib/std-externs.test-kit.ts';

const file = new URL('./extern-keys.txt', import.meta.url);

/** Every spelling the file holds. */
export const frozenSpellings: ReadonlySet<string> = new Set(
  readFileSync(file, 'utf8').split('\n').filter(Boolean),
);

/** Every key and declared type `definition` persists, one line each. */
export function persistedSpellings(definition: Definition): readonly string[] {
  const externs = definition.functions.flatMap((entry) =>
    entry.kind === 'extern'
      ? [
          `extern ${entry.key}${entry.host?.declaredType === undefined ? '' : ` -> ${entry.host.declaredType}`}`,
        ]
      : [],
  );
  return [...externs, ...definition.starts.map(({ key }) => `start ${key}`)];
}

/** The key of every extern the std modules declare, as a line of the file. */
export function stdSpellings(): readonly string[] {
  return stdExterns().externs.map(({ key }) => `extern ${key}`);
}

/** Freezes `spellings`, sorted, as the file's lines. */
export function writeFrozenSpellings(spellings: Iterable<string>): void {
  writeFileSync(file, `${[...new Set(spellings)].sort(compareOrdered).join('\n')}\n`);
}
