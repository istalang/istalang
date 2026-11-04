/**
 * The expansion graph (§3.5). Generics compile per instantiation, so a generic that uses itself,
 * directly or not, with a type argument built from its own type parameter would need endlessly many
 * instantiations: `f<T>` calling `f<Array<T>>`.
 *
 * The rule is the one .NET applies to generic expansion. The graph's nodes are type parameters; a
 * use of a generic adds an edge from each of the user's own type parameters that a type argument
 * mentions to the parameter the argument is given for, an expanding edge when the parameter is
 * nested inside the argument rather than being the whole of it. Instantiation is endless exactly
 * when a cycle holds an expanding edge. Functions find their uses in their calls (rules/
 * expansion.ts), types in their fields (declarations/type-expansion.ts).
 *
 * Each user knows its graph only node by node (a function's calls, a type's fields), so the
 * verdict walks from the nodes it judges to what their edges reach (`endlessEdgesFrom`), and the
 * user says what its nodes are, their edges, and the node an edge leads to.
 */

import { edgesReachedFrom } from '../../../structures/reachable.ts';
import { stronglyConnected } from '../../../structures/strongly-connected.ts';
import {
  type TypeParameter,
  type TypeParameters,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import { errorType, type ParameterKey, type Type } from './type.ts';
import { parametersIn } from './type-parts.ts';

/** An edge of the expansion graph: a type parameter given, in an argument, for another. */
export interface ArgumentEdge {
  readonly from: TypeParameter;
  readonly to: TypeParameter;
  readonly expanding: boolean;
}

/**
 * The edges a use giving `typeArguments` for `parameters` makes, from the user's `own` type
 * parameters.
 */
export function argumentEdges(
  own: ReadonlySet<ParameterKey>,
  parameters: TypeParameters,
  typeArguments: readonly Type[],
): readonly ArgumentEdge[] {
  return typeParametersOf(parameters).flatMap((to, index) => {
    const argument = typeArguments[index] ?? errorType;
    return parametersIn(argument)
      .filter((from): from is TypeParameter => own.has(from))
      .map((from) => ({ from, to, expanding: !isWhole(argument, from) }));
  });
}

/**
 * The edges that make instantiation endless, the expanding ones on a cycle, among those of `roots`
 * and of every node their edges lead to: `targetOf` gives the node an edge's use reaches, or
 * undefined for one outside the graph.
 */
export function endlessEdgesFrom<Node, Edge extends ArgumentEdge>(
  roots: Iterable<Node>,
  edgesOf: (node: Node) => readonly Edge[],
  targetOf: (edge: Edge) => Node | undefined,
): readonly Edge[] {
  const edges = edgesReachedFrom(roots, edgesOf, targetOf);
  const componentOf = stronglyConnected(edges);
  return edges.filter((edge) => edge.expanding && componentOf(edge.from) === componentOf(edge.to));
}

/** Whether `argument` is the parameter `from` itself, rather than a type built around it. */
function isWhole(argument: Type, from: TypeParameter): boolean {
  return argument.kind === 'parameter' && argument.declaration === from;
}
