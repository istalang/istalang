/**
 * Every name of a program, by the declaration it denotes: what finding references and renaming
 * read.
 *
 * The names are found by asking the identifier query of every identifier in every module, std
 * modules included, and the key query of every String literal outside std and in std's annotations
 * (§3.1 Key types, §3.16): fields, methods and statics are resolved by type, so only the checker
 * knows which names reach them, and asking one query of every name keeps references, renaming and
 * going to a definition in agreement.
 * This is the program's one index of the names denoting each declaration. The answer depends on the
 * whole program, so it is made once per program, on the first question, and kept with it.
 */

import { checkProgram } from '../../../compiler/checker/check.ts';
import { isStdModule, type ModuleId, type Program } from '../../../compiler/program/program.ts';
import {
  ancestorsOf,
  nodesUnder,
  type SyntaxNode,
  type SyntaxTree,
} from '../../../compiler/syntax/tree/index.ts';
import { isMissingName } from '../../../compiler/syntax/tree/node.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import {
  actedOnBy,
  isSamePlace,
  type NamePlace,
  nameAt,
  spanOfUse,
  type WrittenName,
} from './declarations.ts';

/** A name denoting a declaration. */
interface Reference extends NamePlace {
  /** Whether the name declares it, rather than referring to it. */
  readonly declares: boolean;
}

/** Where a declaring name stands, as one key: its module, then its offset. */
type PlaceKey = `${ModuleId} ${number}`;

const indexes = new WeakMap<Program, ReadonlyMap<PlaceKey, readonly NamePlace[]>>();

/** Every name of `program` denoting what `declaring` declares, `declaring` among them. */
export function namesDenoting(program: Program, declaring: NamePlace): readonly NamePlace[] {
  return memo(indexes, program, () => indexOf(program)).get(placeKeyOf(program, declaring)) ?? [];
}

function placeKeyOf(program: Program, use: NamePlace): PlaceKey {
  return `${use.module} ${spanOfUse(program, use).start}`;
}

/**
 * The names denoting what the name at `offset` of `module` stands for (`NameAt.targets`), each
 * once.
 */
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

function indexOf(program: Program): ReadonlyMap<PlaceKey, readonly NamePlace[]> {
  const checker = checkProgram(program);
  const denoting = [...program.modules].flatMap(([module, { tree }]) =>
    nodesUnder(tree, tree.root).flatMap((name) =>
      isName(program, module, tree, name)
        ? actedOnBy(checker, module, name).map(({ at }) => ({
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

/**
 * Whether `node`, of `module` parsed as `tree`, may name a declaration: an identifier; a String
 * literal outside std, which may be a key naming a field (§3.1 Key types); or one in std's
 * annotations, which may name a parameter in a `@Keeps` (§3.16). A std module can name no field of
 * the program's own, and reading the literals of its bodies would check each of them.
 */
function isName(
  program: Program,
  module: ModuleId,
  tree: SyntaxTree,
  node: SyntaxNode,
): node is WrittenName {
  if (node.kind === 'Identifier') {
    return !isMissingName(node);
  }
  return (
    node.kind === 'StringLiteral' &&
    (!isStdModule(program, module) ||
      ancestorsOf(tree, node).some((holder) => holder.kind === 'Annotation'))
  );
}
