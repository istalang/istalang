/**
 * Items (§3): where each may stand, and the annotations it carries (§3.16).
 *
 * An item stands at the top level of a module, in a block, or both (spec §3, §3.4, §3.6, §3.7,
 * §3.13). The parser rejects an item in the wrong place, and the binder relies on the same answer,
 * so it is one function of the item. A module holds declarations and a block holds statements.
 * Functions and `const` values are both, with two exceptions:
 * - an extern or static function (`fn Duration.zero()`) declares something the whole program
 *   sees, so it stays at the top level
 * - a mutable or function-held variable lives in a function, so it stays in blocks.
 *
 * The same rule, read by the word an item starts with, says what a module's item may start with:
 * a declaration's word, or a statement's whose items a module holds too (`statementWordPlaces`).
 *
 * An annotation is a struct value after `@`. The parser keeps it as an expression of a restricted
 * shape (a name or a struct literal). Whether that names an annotation struct, and whether the
 * annotation means anything where it stands, is the checker's call.
 *
 * An item's annotations are one list in source order, whether written above it (`@Suite{…}` over a
 * function) or after it on its line (`userId: Int @JsonName{"user_id"}`): which side each stands on
 * is in its span, and traversal orders children by span (tree/index.ts). The field is absent when
 * there are none, which keeps every unannotated item free of annotation noise.
 */

import type { Declaration } from './declarations/index.ts';
import type { Expression } from './expressions/index.ts';
import type { Statement } from './statements/index.ts';
import {
  type DeclarationWord,
  declarationWords,
  type StatementWord,
  statementWords,
} from './tokens/grammar-words.ts';
import type { NodeOf } from './tree/node.ts';

export type Item = Declaration | Statement;

type Place = 'module' | 'block' | 'both';

/** Where the items each statement word starts may stand: a function and a `const` in both. */
const statementWordPlaces = {
  let: 'block',
  const: 'both',
  fn: 'both',
  async: 'both',
  return: 'block',
  break: 'block',
  continue: 'block',
  for: 'block',
  while: 'block',
  defer: 'block',
  drop: 'block',
  hold: 'block',
} as const satisfies Record<StatementWord, Exclude<Place, 'module'>>;

/** What a module's item may start with (§3, §3.13). */
export const moduleItemWords: readonly (DeclarationWord | StatementWord)[] = [
  ...declarationWords,
  ...statementWords.filter((word) => statementWordPlaces[word] === 'both'),
];

export function allowedInModule(item: Item): item is Declaration {
  return placeOf(item) !== 'block';
}

export function allowedInBlock(item: Item): item is Statement {
  return placeOf(item) !== 'module';
}

function placeOf(item: Item): Place {
  switch (item.kind) {
    case 'NamedImport':
    case 'NamespaceImport':
    case 'StructDeclaration':
    case 'SharedStructDeclaration':
    case 'ExternStructDeclaration':
    case 'ExternConstantDeclaration':
    case 'EnumDeclaration':
    case 'TraitDeclaration':
    case 'TypeAliasDeclaration':
      return 'module';
    case 'FunctionDeclaration':
      return item.isExtern || item.owner !== undefined ? 'module' : 'both';
    case 'VariableDeclaration':
      return item.isMutable || item.hold !== undefined ? 'block' : 'both';
    case 'ExpressionStatement':
    case 'Assignment':
    case 'Return':
    case 'Break':
    case 'Continue':
    case 'For':
    case 'FieldLoop':
    case 'While':
    case 'LabelledBlock':
    case 'Defer':
    case 'Drop':
      return 'block';
    default: {
      const unhandled: never = item;
      return unhandled;
    }
  }
}

export interface Annotation extends NodeOf<'Annotation'> {
  readonly value: Expression;
}

/** What every declaration, statement, field and enum variant may carry. */
export interface Annotatable {
  readonly annotations?: readonly Annotation[];
}
