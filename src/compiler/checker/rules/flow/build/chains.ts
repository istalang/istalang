/**
 * Optional chains (§10.4): `a?.b.c` meets `none` at its `?.` and gives `none` without running the
 * links after it.
 *
 * - The outermost link opens the chain. A part of a link that is no step target (an argument, an
 *   index's key) is no part of the chain, and starts any chain of its own.
 * - What a link's step works on is its target's value, the value inside after `?.`, and then made
 *   to fit as checking fitted the target (a receiver converted for the method a call chose, §4.1):
 *   inside the optional, never the optional around it. A link's own value is what its step gives
 *   (`carried`). A `?.` meeting `none` goes to the chain's end, where the chain gives `none`; the
 *   last link's value is the chain's on the other path, put into the chain's optional unless it is
 *   one already.
 */

import { chainStepOf, isOptionalStep } from '../../../../syntax/expressions/chains.ts';
import type { Expression } from '../../../../syntax/expressions/index.ts';
import { unitForm } from '../../../surface/constant-form.ts';
import type { BlockId, ValueId } from '../../../surface/flow-ir.ts';
import type { FlowBuilder, OpenChain } from './flow-builder.ts';

/** The chain open around a node, and the one the node itself opens, if it opens one. */
interface ChainFrame {
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
    result: builder.temporary(node, builder.body.typeOf(node)),
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
  const { type: carried } = builder.valueOf(value);
  const { type } = builder.valueOf(opened.result);
  const fit = carried && type && builder.inputs.checker.fitOf(carried, type);
  const wrapped = builder.fitted(node, value, { type, fit });
  builder.emit({ op: 'copy', site: node, into: opened.result, from: wrapped, fit: undefined });
  builder.continueIn(opened.end);
  return opened.result;
}

/**
 * The value `link`'s step works on (`chainStepOf`): its target's, inside the optional after `?.`,
 * fitted as checking fitted the target; an expression's own value where `link` is no chain's.
 */
export function stepTarget(builder: FlowBuilder, link: Expression, target: Expression): ValueId {
  const step = chainStepOf(link);
  const chained = builder.body.chainOf(link);
  const { chain } = builder;
  if (step === undefined || chained === undefined || chain === undefined) {
    return builder.expression(target);
  }
  const value = builder.unfitted(target);
  if (!isOptionalStep(step)) {
    return builder.fit(target, value);
  }
  const inside = builder.temporary(target, chained.base);
  presentOr(builder, value, { site: target, into: inside }, () => {
    builder.compute(chain.result, link, { kind: 'constant', form: unitForm });
    builder.end({ kind: 'goto', to: chain.end });
  });
  return builder.fit(target, inside);
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

/**
 * The value inside the optional `whole`, read into `into` at `site` where `whole` holds one; where
 * it is `none`, `absent` runs from a branch of its own, which goes on elsewhere or ends (§10.4).
 */
export function presentOr(
  builder: FlowBuilder,
  whole: ValueId,
  { site, into }: { readonly site: Expression; readonly into: ValueId },
  absent: () => void,
): void {
  const test = { kind: 'present', value: whole } as const;
  const [present, none] = builder.branch(test) as [BlockId, BlockId];
  builder.resumeIn(none);
  absent();
  builder.resumeIn(present);
  builder.emit({ op: 'read', site, into, from: whole, part: { kind: 'inside' } });
}
