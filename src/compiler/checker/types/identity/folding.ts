/**
 * Folding (§4.6): the labelled recursive type a type holding recursion is equal to, when a graph
 * it reaches has one, so a union naming a recursive alias's members, or a recursive member with
 * more of its members, reads as that alias. Apart from building graphs (recursive-types.ts), so the
 * union constructor folding its unions (../unions/unions.ts) is one that building graphs uses too.
 */

import { holdsRecursion, typeChildren } from '../parts/type-children.ts';
import type { RecursiveGraph } from '../type/computed-types.ts';
import type { Type } from '../type/index.ts';
import { typeKeys } from './type-keys.ts';

/** The recursive type equal to `type` among the nodes of the graphs it reaches (the banner). */
export function folded(type: Type): Type {
  if (type.kind === 'recursive' || !holdsRecursion(type)) {
    return type;
  }
  const key = typeKeys.typeKey(type);
  for (const graph of graphsIn(type)) {
    const equal = graph.types.find(
      (node) => node.alias !== undefined && typeKeys.typeKey(node) === key,
    );
    if (equal !== undefined) {
      return type.alias === undefined ? equal : { ...equal, alias: type.alias };
    }
  }
  return type;
}

/** The graphs of the recursive types `type` is or is built from. */
function graphsIn(type: Type): ReadonlySet<RecursiveGraph> {
  const graphs = new Set<RecursiveGraph>();
  const visit = (each: Type): void => {
    if (each.kind === 'recursive') {
      graphs.add(each.graph);
    } else if (holdsRecursion(each)) {
      typeChildren(each).forEach(visit);
    }
  };
  visit(type);
  return graphs;
}
