/**
 * Desugaring: a sugar (surface/checked-body.ts `Sugar`) is checked as the core tree it means, built
 * where it is written from what checking knows there, and nothing after checking knows it existed.
 *
 * - One entry per sugar kind (`desugars`), everything of one sugar in its own module: how it builds
 *   its core, the mistakes it refuses itself (only those no core rule catches), and how it words
 *   the core diagnostics it can cause.
 * - The core reuses the written operand nodes, their spans and bindings; what it adds is built for
 *   the sugar (synthesized.ts). It is checked in the sugar's place by the core's own rules and
 *   recorded (`BodyFacts.coreOf`), which flow, lowering, rules and tools read instead of the sugar.
 * - A diagnostic reported while a node built for a sugar is checked is reworded by that sugar's
 *   entry, by its code (`reworded`), so a report reads as about the code written.
 */

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import type { CoreExpression, Sugar, SugarKind } from '../surface/checked-body.ts';
import type { Type } from '../types/type/index.ts';
import { errorType } from '../types/type/primitives.ts';
import { originOf } from './synthesized.ts';
import { unwraps } from './unwrap.ts';

/** How a sugar of kind `Node` is desugared. */
export interface Desugar<Node extends Sugar> {
  /** The core tree `node` means where it stands; undefined after its own refusal, reported. */
  readonly core: (context: BodyContext, node: Node) => CoreExpression | undefined;
  /** How the core diagnostics `node` can cause read for it, by code. */
  readonly wording: { readonly [code: number]: Reword<Node> };
}

type Reword<Node extends Sugar> = (
  context: BodyContext,
  diagnostic: Diagnostic<AnchoredSpan>,
  node: Node,
) => Diagnostic<AnchoredSpan>;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const desugars: { readonly [Kind in SugarKind]: Desugar<Extract<Sugar, { readonly kind: Kind }>> } =
  { Unwrap: unwraps };
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** The entry of `node`'s kind, typed for the node as its union sees it. */
function desugarOf(node: Sugar): Desugar<Sugar> {
  return desugars[node.kind] as Desugar<Sugar>;
}

/** Checks `node` as its core, recording it; the error type after the sugar's own refusal. */
export function checkSugar(context: BodyContext, node: Sugar, expected: Type | undefined): Type {
  const core = desugarOf(node).core(context, node);
  if (core === undefined) {
    return errorType;
  }
  context.recordCore(node, core);
  return context.expression(core, expected);
}

/**
 * Which sugar's words a body reports in: those of the sugar a node being checked was built for,
 * none while a written node is, its operands included.
 */
export class Wordings {
  #sugar: Sugar | undefined;

  /** Runs `check` of `node`, reporting in the words of the sugar it was built for, if any. */
  checking<T>(node: Expression, check: () => T): T {
    const outer = this.#sugar;
    this.#sugar = originOf(node);
    try {
      return check();
    } finally {
      this.#sugar = outer;
    }
  }

  /** `diagnostic`, as the sugar of the node being checked words it. */
  worded(context: BodyContext, diagnostic: Diagnostic<AnchoredSpan>): Diagnostic<AnchoredSpan> {
    const sugar = this.#sugar;
    return sugar === undefined
      ? diagnostic
      : (desugarOf(sugar).wording[diagnostic.code]?.(context, diagnostic, sugar) ?? diagnostic);
  }
}
