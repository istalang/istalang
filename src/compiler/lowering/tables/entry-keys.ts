/**
 * How a function-table entry's key spells what it names (entries.ts, tables.ts): the same in every
 * program holding it, never by a number one checker gives, so a key is predictable and an entry
 * lowered for one program is found by it in another (docs/arch/definition.md, "Names").
 *
 * - **A declaration** by its qualified name (names.ts); an overload with its position among its
 *   module's top-level functions of that name, in source order, since its signature can hold types
 *   only an instantiation reduces, which no qualified spelling has.
 * - **A type** by its table key (names.ts).
 * - **A node**, a lambda, a local function or a field loop's header, by its module's canonical
 *   name and where it starts there.
 *
 * A key spelling only what the std declares means one entry in every program over the same std.
 */

import { memo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { programModule } from '../../program/program.ts';
import { declaredFunctionName } from '../../syntax/declarations/field-defaults.ts';
import type {
  ContextConstantDeclaration,
  ExternConstantDeclaration,
  FunctionDeclaration,
} from '../../syntax/declarations/index.ts';
import type { VariableDeclaration } from '../../syntax/statements/index.ts';
import { type AnchoredSpan, spanIn } from '../../syntax/tree/positions.ts';
import { namesOnlyStd, qualifiedNameOf, tableKey } from './names.ts';

/** A declaration an entry's key names. */
type KeyedDeclaration =
  | FunctionDeclaration
  | VariableDeclaration
  | ExternConstantDeclaration
  | ContextConstantDeclaration;

/** How an entry's key spells what it names (the banner). */
export interface EntryKeys {
  readonly declaration: (declaration: KeyedDeclaration) => string;
  readonly type: (type: Type) => string;
  /** A node standing at `span` in the module declaring `within`. */
  readonly node: (span: AnchoredSpan, within: KeyedDeclaration) => string;
}

/** The entry keys of `checker`'s program. */
export function entryKeysOf(checker: Checker): EntryKeys {
  return memo(keysByProgram, checker, () => {
    const declarations = new WeakMap<KeyedDeclaration, string>();
    return {
      declaration: (declaration) =>
        memo(declarations, declaration, () => declarationKey(checker, declaration)),
      type: (type) => tableKey(checker, type),
      node: (span, within) => {
        const { tree, name } = programModule(checker.program, checker.moduleOf(within));
        return `${name}@${spanIn(tree, span).start}`;
      },
    };
  });
}

const keysByProgram = new WeakMap<Checker, EntryKeys>();

/**
 * Whether the key `spell` spells with an entry's keys names only the std's declarations and types
 * (`namesOnlyStd`), and nodes only in its modules.
 */
export function spellsOnlyStd(checker: Checker, spell: (keys: EntryKeys) => string): boolean {
  const keys = entryKeysOf(checker);
  let onlyStd = true;
  const inStd = (within: KeyedDeclaration) => {
    onlyStd &&= checker.isStd(checker.moduleOf(within));
  };
  spell({
    declaration: (declaration) => {
      inStd(declaration);
      return keys.declaration(declaration);
    },
    type: (type) => {
      onlyStd &&= namesOnlyStd(checker, type);
      return keys.type(type);
    },
    node: (span, within) => {
      inStd(within);
      return keys.node(span, within);
    },
  });
  return onlyStd;
}

function declarationKey(checker: Checker, declaration: KeyedDeclaration): string {
  const name = qualifiedNameOf(checker, declaration);
  if (declaration.kind !== 'FunctionDeclaration') {
    return name;
  }
  const overloads = checker.topLevelFunctions(
    checker.moduleOf(declaration),
    declaredFunctionName(declaration),
  );
  const at = overloads.indexOf(declaration);
  if (at < 0) {
    return overloads.length === 0
      ? name
      : unreachable(`${name} is keyed alike with a top-level function of its name.`);
  }
  return overloads.length > 1 ? `${name}/${at}` : name;
}
