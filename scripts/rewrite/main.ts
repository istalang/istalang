/**
 * Rewrites the repository's Istalang sources with one pass, for a language change that edits them
 * mechanically: `npm run rewrite -- <pass> [--check]`.
 *
 * - Without `--check`, it writes every file it rewrites and reports each one; it exits 1 when a
 *   rewrite couldn't be made in its file, which is left for a person to make.
 * - With `--check`, it writes nothing, shows each change's lines, and exits 1 if anything would
 *   change, so a run in CI states that a pass has nothing left to do.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { isPassName, passes } from './passes.ts';
import { reportOf } from './report.ts';
import { rewriteRepository } from './repository.ts';

const exitCodes = { clean: 0, changes: 1, usage: 2 } as const;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { check: { type: 'boolean', default: false } },
});
const [name = ''] = positionals;

if (positionals.length === 1 && isPassName(name)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const rewrites = rewriteRepository(root, passes[name]);
  process.stdout.write(`${reportOf(rewrites, values.check)}\n`);
  const changed = rewrites.filter(({ before, after }) => before !== after);
  if (!values.check) {
    for (const { path, after } of changed) {
      writeFileSync(join(root, path), after);
    }
  }
  const leftOver = values.check
    ? changed.length + rewrites.flatMap(({ refused }) => refused).length
    : rewrites.flatMap(({ refused }) => refused).length;
  process.exitCode = leftOver > 0 ? exitCodes.changes : exitCodes.clean;
} else {
  process.stderr.write(
    `Usage: npm run rewrite -- <pass> [--check]\nPasses: ${Object.keys(passes).join(', ')}\n`,
  );
  process.exitCode = exitCodes.usage;
}
