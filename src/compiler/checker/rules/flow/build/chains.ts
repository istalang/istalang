/**
 * Optional chains (§4): `a?.b.c` meets `none` at its `?.` and gives `none` without running the
 * links after it. The outermost link opens the chain; each link stepping through an optional goes
 * to the chain's end with `none` where its target is none, and on with the value inside where it
 * isn't; the last link's value is the chain's on the other path. A part of a link that is no step
 * target (an argument, an index's key) is no part of the chain, and starts any chain of its own.
 */

import { chainStepOf, isOptionalStep } from '../../../../syntax/expressions/chains.ts';
import type { Expression } from '../../../../syntax/expressions/index.ts';
import type { ValueId } from '../flow-ir.ts';
import type { FlowBuilder, OpenChain } from './flow-builder.ts';

/** The chain open around a node, and the one the node itself opens, if it opens one. */
export interface ChainFrame {
  readonly outer: OpenChain | undefined;
  readonly opened: OpenChain | undefined;
}

/**
 * The chain `node` is built in: the open one, where `node` is one of its links; one `node` opens,
 * where it is the outermost link of a chain; none for any other node.
 */
export function openChain(builder: FlowBuilder, node: Expression): ChainFrame {
  const outer = builder.chain;
  if (outer?.links.has(node)) {
    return { outer, opened: undefined };
  }
  if (builder.body.chainOf(node) === undefined) {
    builder.chain = undefined;
    return { outer, opened: undefined };
  }
  const opened: OpenChain = {
    links: linksOf(builder, node),
    end: builder.newBlock(),
    result: builder.temporaryOf(node),
  };
  builder.chain = opened;
  return { outer, opened };
}

/** `value`, the value of `node` as its handler built it, as the chain it opened gives it. */
export function closeChain(
  builder: FlowBuilder,
  node: Expression,
  { outer, opened }: ChainFrame,
  value: ValueId,
): ValueId {
  builder.chain = outer;
  if (opened === undefined) {
    return value;
  }
  builder.emit({ op: 'copy', site: node, into: opened.result, from: value, fit: undefined });
  builder.continueIn(opened.end);
  return opened.result;
}

/**
 * `target`, the value `node`'s step works on: where the step reads through an optional, the value
 * inside it, the chain going to its end with `none` where there is none.
 */
export function throughOptional(builder: FlowBuilder, node: Expression, target: ValueId): ValueId {
  const step = chainStepOf(node);
  const { chain } = builder;
  const link = builder.body.chainOf(node);
  if (step === undefined || !isOptionalStep(step) || chain === undefined || link === undefined) {
    return target;
  }
  const [none, some] = builder.branch(2) as [number, number];
  builder.resumeIn(none);
  builder.emit({ op: 'compute', site: node, into: chain.result, operands: [] });
  builder.end({ kind: 'goto', to: chain.end });
  builder.resumeIn(some);
  const inside = builder.temporary(node, link.base);
  builder.emit({ op: 'read', site: node, into: inside, from: target, part: { kind: 'inside' } });
  return inside;
}

/** The links of the chain whose outermost link is `node`: it, and each step target that is one. */
function linksOf(builder: FlowBuilder, node: Expression): ReadonlySet<Expression> {
  const links = new Set<Expression>();
  for (let link: Expression | undefined = node; link !== undefined; ) {
    if (builder.body.chainOf(link) === undefined) {
      break;
    }
    links.add(link);
    link = chainStepOf(link)?.target;
  }
  return links;
}
