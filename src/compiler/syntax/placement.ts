/**
 * Where an item may stand: the top level of a module, a block, or both (spec §3, §3.4, §3.6,
 * §3.7, §3.13).
 *
 * The parser rejects an item in the wrong place, and the binder relies on the same answer, so it
 * is one function of the item. A module holds declarations and a block holds statements. Functions
 * and `const` values are both, with two exceptions:
 * - an extern or static function (`fn Duration.zero()`) declares something the whole program
 *   sees, so it stays at the top level
 * - a mutable or function-held variable lives in a function, so it stays in blocks.
 */

import type { Declaration } from './declarations.ts';
import type { Statement } from './statements.ts';

export type Item = Declaration | Statement;

export function allowedInModule(item: Item): item is Declaration {
  return placeOf(item) !== 'block';
}

export function allowedInBlock(item: Item): item is Statement {
  return placeOf(item) !== 'module';
}

function placeOf(item: Item): 'module' | 'block' | 'both' {
  switch (item.kind) {
    case 'NamedImport':
    case 'NamespaceImport':
    case 'StructDeclaration':
    case 'ExternStructDeclaration':
    case 'ExternConstantDeclaration':
    case 'EnumDeclaration':
    case 'TraitDeclaration':
    case 'TypeAliasDeclaration':
    case 'HandleDeclaration':
      return 'module';
    case 'FunctionDeclaration':
      return item.isExtern || item.owner !== undefined ? 'module' : 'both';
    case 'VariableDeclaration':
      return item.isMutable || item.heldByFunction ? 'block' : 'both';
    case 'ExpressionStatement':
    case 'Assignment':
    case 'Return':
    case 'Break':
    case 'Continue':
    case 'For':
    case 'While':
    case 'Defer':
    case 'Drop':
    case 'Spawn':
      return 'block';
    default: {
      const unhandled: never = item;
      return unhandled;
    }
  }
}
