/**
 * What highlighting asks of checking (§2): a bare key of an indented value is a field where the
 * value is built as a struct, which the tree tells, but a String where it is built as a map, which
 * only the type it is built as tells. So these names, and only these, are read from the checked
 * body: a map's key written with its value is a String, a shorthand key the variable it reads.
 */

import { nodesUnder } from '../../compiler/syntax/tree/index.ts';
import { spanIn } from '../../compiler/syntax/tree/positions.ts';
import type { CheckedModule } from '../reading/checked-module.ts';
import type { SemanticType } from './semantic-types.ts';

/** The kind of each bare key of `checked`'s indented values built as maps, by where it starts. */
export function builtKeyTypesOf({
  checker,
  module,
  tree,
}: CheckedModule): ReadonlyMap<number, SemanticType> {
  const found = new Map<number, SemanticType>();
  const values = nodesUnder(tree, tree.root).filter((node) => node.kind === 'IndentedValue');
  for (const value of values) {
    const built = checker.lookup.bodyHolding(module, value)?.builtLiteralOf(value);
    const keys = built?.kind === 'MapLiteral' ? value.entries : [];
    for (const entry of keys) {
      if (entry.kind === 'FieldInitializer') {
        const { start } = spanIn(tree, entry.name.span);
        found.set(start, entry.value === undefined ? 'variable' : 'string');
      }
    }
  }
  return found;
}
