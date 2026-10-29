/**
 * Every name of a program, by the declaration it denotes: what finding references and renaming
 * read.
 *
 * The names are found by asking the identifier query of every identifier in every module, std
 * modules included. The binder's `usesOf` would serve its own entities, but fields, methods and
 * statics are resolved by type, so only the checker knows which names reach them; asking one query
 * of every name keeps references, renaming and going to a definition in agreement. The answer
 * depends on the whole program, so it is made once per program, on the first question, and kept
 * with it.
 */

import type { EntityUse } from '../../compiler/binder/entities.ts';
import { checkProgram } from '../../compiler/checker/check.ts';
import type { ModuleId, Program } from '../../compiler/program/program.ts';
import { isMissingName } from '../../compiler/syntax/node.ts';
import { nodesUnder } from '../../compiler/syntax/tree.ts';
import { memo } from '../../structures/memo.ts';
import { declarationsOf, isSamePlace, nameAt, spanOfUse } from './declarations.ts';

/** A name denoting a declaration. */
export interface Reference extends EntityUse {
  /** Whether the name declares it, rather than referring to it. */
  readonly declares: boolean;
}

/** Where a declaring name stands, as one key: its module, then its offset. */
type PlaceKey = `${ModuleId} ${number}`;

const indexes = new WeakMap<Program, ReadonlyMap<PlaceKey, readonly EntityUse[]>>();

/** Every name of `program` denoting what `declaring` declares, `declaring` among them. */
export function namesDenoting(program: Program, declaring: EntityUse): readonly EntityUse[] {
  return memo(indexes, program, () => indexOf(program)).get(placeKeyOf(program, declaring)) ?? [];
}

function placeKeyOf(program: Program, use: EntityUse): PlaceKey {
  return `${use.module} ${spanOfUse(program, use).start}`;
}

/** The names denoting what the name at `offset` of `module` stands for (`NameAt.targets`), each once. */
export function referencesAt(
  program: Program,
  module: ModuleId,
  offset: number,
): readonly Reference[] {
  const targets = nameAt(program, module, offset)?.targets ?? [];
  const references = targets.flatMap(({ at }) =>
    namesDenoting(program, at).map((use) => ({ ...use, declares: isSamePlace(use, at) })),
  );
  return references.filter(
    ({ name }, index) => references.findIndex((other) => other.name === name) === index,
  );
}

function indexOf(program: Program): ReadonlyMap<PlaceKey, readonly EntityUse[]> {
  const checker = checkProgram(program);
  const denoting = [...program.modules].flatMap(([module, { tree }]) =>
    nodesUnder(tree, tree.root).flatMap((name) =>
      name.kind === 'Identifier' && !isMissingName(name)
        ? declarationsOf(checker, module, name).map(({ at }) => ({
            declaring: placeKeyOf(program, at),
            module,
            name,
          }))
        : [],
    ),
  );
  const byDeclaring = Map.groupBy(denoting, ({ declaring }) => declaring);
  return new Map(
    [...byDeclaring].map(([declaring, uses]) => [
      declaring,
      uses.map(({ module, name }) => ({ module, name })),
    ]),
  );
}
