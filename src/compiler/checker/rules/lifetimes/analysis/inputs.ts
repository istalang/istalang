/**
 * The inputs a function's findings are lifted to (design.md §5.3), and the parts of them it read
 * (design.md §5.7, pulled forward from C4): a requirement on two fields of one input, `p.a` and
 * `p.b`, is its caller's to check of what it gave, where `p` and `p` would be no requirement.
 *
 * - **An input path** is a part read of an input: of its node as given, or of the parameter that
 *   holds it, where nothing assigns that parameter (`Nodes.isStable`), so the part read is the part
 *   given. A part of an input path is one too.
 * - **Pairs** are lifted between inputs on different branches: an input and a part of it are one
 *   value's, so neither may come to reach the other but through a cycle.
 */

import type { NodeId } from '../reach-state.ts';
import { type Input, inputKey } from '../summary.ts';
import type { BodyAnalysis } from './body.ts';
import type { FlowState } from './flow-state.ts';
import type { Nodes } from './nodes.ts';

/** An input, or a part of one, and the node standing for it now. */
export interface Candidate {
  readonly input: Input;
  readonly node: NodeId;
}

/** The inputs and the input paths `state` holds live: what a finding may be lifted to. */
export function candidatesIn(analysis: BodyAnalysis, state: FlowState): readonly Candidate[] {
  const { nodes } = analysis;
  const inputs = nodes.inputs
    .map((slot) => ({ input: slot.input, node: analysis.inputNodeOf(slot) }))
    .filter(({ node }) => state.reach.isLive(node) && nodes.isRelevant(node));
  const paths = nodes.allPaths().flatMap((node) => {
    const input = inputPathOf(nodes, node);
    return input !== undefined && state.reach.isLive(node) && nodes.isRelevant(node)
      ? [{ input, node }]
      : [];
  });
  return [...inputs, ...paths];
}

/** The input path `node` is: a part read of an input, or of a part of one. */
function inputPathOf(nodes: Nodes, node: NodeId): Input | undefined {
  const read = nodes.pathOf(node);
  if (read === undefined) {
    return undefined;
  }
  const of = inputPathOf(nodes, read.root) ?? inputAt(nodes, read.root);
  return of === undefined
    ? undefined
    : {
        kind: 'path',
        of,
        part: read.part,
        key: nodes.partKey(read.part),
        read: read.kind,
        type: read.type,
      };
}

/** The input `node` is as given: its node, or the parameter holding it that nothing assigns. */
function inputAt(nodes: Nodes, node: NodeId): Input | undefined {
  const slot = nodes.inputs.find(
    (each) => each.node === node || (each.value === node && nodes.isStable(node)),
  );
  return slot?.input;
}

/** Whether `node` is an input or a part of one: its parts' sharing is its caller's to know. */
export function isInputRooted(nodes: Nodes, node: NodeId): boolean {
  return inputPathOf(nodes, node) !== undefined || inputAt(nodes, node) !== undefined;
}

/** Whether two inputs are on different branches: neither is the other or a part of it. */
export function apart(first: Input, second: Input): boolean {
  const firstKey = inputKey(first);
  const secondKey = inputKey(second);
  return !(
    firstKey === secondKey ||
    firstKey.startsWith(`${secondKey}/`) ||
    secondKey.startsWith(`${firstKey}/`)
  );
}
