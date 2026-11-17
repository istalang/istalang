/**
 * The std's entries, lowered once per process: after a program is lowered, the entries in it only
 * the std decides are kept (kept-entries.ts), and a later program over the same std takes them over
 * (docs/arch/definition.md, "Names").
 *
 * - **Per std:** by the program's std modules, their ids and their texts' digests, so a program
 *   over other std sources (a test laying its own over the shipped ones) never meets another's
 *   entries.
 * - **Per build:** by what changes how the std's entries lower: whether the build is a test build,
 *   whose functions' slots are rebindable (`DefinitionTables.rebindable`), and the std functions
 *   its test modules mock, by their keys, whose instances are never shared across types.
 */

import { utf8ToBytes } from '@noble/hashes/utils.js';
import { contentHash } from '../../../definition/formats/binary-format.ts';
import { compareOrdered } from '../../../foundation/language/order.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import type { Program } from '../../program/program.ts';
import { KeptEntries } from './kept-entries.ts';

/** What changes how the std's entries lower (the banner). */
export interface Build {
  readonly rebindable: boolean;
  /** The keys of the std functions the program's test modules mock (entry-keys.ts). */
  readonly mocked: readonly string[];
}

/** The entries kept of the programs over one std, per build. */
export class StdLowering {
  readonly #builds = new Map<string, KeptEntries>();

  /** The entries kept of the programs lowered for `build`. */
  of({ rebindable, mocked }: Build): KeptEntries {
    const key = `${rebindable ? 'rebindable' : 'fixed'}:${[...mocked].sort(compareOrdered).join(',')}`;
    return memo(this.#builds, key, () => new KeptEntries());
  }
}

/** The std lowerings of this process, by std: one per std its programs are over, never let go of. */
const lowerings = new Map<string, StdLowering>();

/** The std lowering of the programs over `program`'s std, this process's. */
export function stdLoweringOf(program: Program): StdLowering {
  const std = [...program.modules.values()]
    .filter(({ isStd }) => isStd)
    .map(({ id, tree }) => `${id}=${digestOf(tree.source)}`)
    .sort(compareOrdered);
  return memo(lowerings, std.join('|'), () => new StdLowering());
}

/** Each std source's digest, kept with the source, so a source nothing holds lets its digest go. */
const digests = new WeakMap<object, string>();

function digestOf(source: { readonly text: string }): string {
  return memo(digests, source, () => contentHash(utf8ToBytes(source.text)));
}
