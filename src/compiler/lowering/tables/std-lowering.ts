/**
 * The std's entries, lowered once per process: after a program is lowered, the entries in it only
 * the std decides are kept (kept-entries.ts), and a later program over the same std takes them over
 * (docs/arch/definition.md, "Names").
 *
 * - **Per std:** by the program's std modules, their ids and their texts' digests, so a program
 *   over other std sources (a test laying its own over the shipped ones) never meets another's
 *   entries.
 * - **Per build:** by the options a program's tables are made with that change what lowering
 *   writes, as a test build's does (`DefinitionTables.rebindable`).
 */

import { utf8ToBytes } from '@noble/hashes/utils.js';
import { contentHash } from '../../../definition/formats/binary-format.ts';
import { compareOrdered } from '../../../foundation/language/order.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import type { Program } from '../../program/program.ts';
import { KeptEntries } from './kept-entries.ts';

/** The entries kept of the programs over one std, per build. */
export class StdLowering {
  readonly #builds = new Map<string, KeptEntries>();

  /** The entries kept of the programs lowered for `build`. */
  of(build: object): KeptEntries {
    return memo(this.#builds, JSON.stringify(build), () => new KeptEntries());
  }
}

/** The std lowerings of this process, by std. */
const lowerings = new Map<string, StdLowering>();

/** The std lowering of the programs over `program`'s std, this process's. */
export function stdLoweringOf(program: Program): StdLowering {
  const std = [...program.modules.values()]
    .filter(({ isStd }) => isStd)
    .map(({ id, tree }) => `${id}=${digestOf(tree.source.text)}`)
    .sort(compareOrdered);
  return memo(lowerings, std.join('|'), () => new StdLowering());
}

/** Each std text's digest, by the text. */
const digests = new Map<string, string>();

function digestOf(text: string): string {
  return memo(digests, text, () => contentHash(utf8ToBytes(text)));
}
