/**
 * Desugaring: a sugar (surface/checked-body.ts `Sugar`) is checked as the core tree it means, built
 * where it is written from what checking knows there, and nothing after checking knows it existed.
 *
 * - One entry per sugar kind (`desugars`), everything of one sugar in its own module: how it builds
 *   its core, the mistakes it refuses itself (only those no core rule catches), and how it words
 *   the core diagnostics it can cause.
 * - The core reuses the written operand nodes, their spans and bindings; what it adds is built for
 *   a part of the sugar (../contexts/synthesized.ts). It is checked in the sugar's place by the
 *   core's own rules and recorded (`BodyFacts.coreOf`), which flow, lowering, rules and tools read
 *   instead of the sugar. Checking reaches a sugar through its body's `sugars`, so no construct
 *   knows one.
 * - A diagnostic reported while a node built for a sugar is checked is reworded by that sugar's
 *   entry, by its code and the part the node plays, so a report reads as about the code written.
 */

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { BodyContext, Sugars } from '../contexts/body-context.ts';
import type { Pass, Passes, PassTable } from '../contexts/passes.ts';
import { type Origin, originOf } from '../contexts/synthesized.ts';
import type { CoreExpression, Sugar, SugarKind } from '../surface/checked-body.ts';
import type { Type } from '../types/type/index.ts';
import { errorType } from '../types/type/primitives.ts';
import { chainedComparisons } from './chained-comparisons.ts';
import { deferredCalls } from './deferred-calls.ts';
import { templates } from './templates.ts';
import { unwraps } from './unwrap.ts';

/** How a sugar of kind `Node` is desugared. */
export interface Desugar<Node extends Sugar> {
  /** The core tree `node` means where it stands; undefined after its own refusal, reported. */
  readonly core: (context: BodyContext, node: Node) => CoreExpression | undefined;
  /** How the core diagnostics `node` can cause read for it, by code. */
  readonly wording: { readonly [code: number]: Reword<Node> };
}

/** `diagnostic`, reported where a node built as `origin` says was checked, as the sugar words it. */
export type Reword<Node extends Sugar> = (
  context: BodyContext,
  diagnostic: Diagnostic<AnchoredSpan>,
  origin: Origin & { readonly sugar: Node },
) => Diagnostic<AnchoredSpan>;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const desugars: { readonly [Kind in SugarKind]: Desugar<Extract<Sugar, { readonly kind: Kind }>> } =
  {
    ChainedComparison: chainedComparisons,
    DeferredCall: deferredCalls,
    TemplateLiteral: templates,
    Unwrap: unwraps,
  };
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** The entry of `node`'s kind, typed for the node as its union sees it. */
function desugarOf(node: Sugar): Desugar<Sugar> {
  return desugars[node.kind] as Desugar<Sugar>;
}

/**
 * What checking a body keeps of its sugars as it goes: the core each was checked as, the operands a
 * sugar checked before its core, which checking the core reads rather than checks again, and what
 * the node being checked was built for, whose words the body reports in; none while a written node
 * is, a sugar's operands included.
 */
export class Desugarings implements Sugars {
  readonly #operands: PassTable<Expression, Type>;
  readonly #cores: PassTable<NodeOf<string>, CoreExpression>;
  #origin: Origin | undefined;

  constructor(passes: Passes) {
    this.#operands = passes.table();
    this.#cores = passes.table();
  }

  check(context: BodyContext, node: Sugar, expected: Type | undefined): Type {
    const core = desugarOf(node).core(context, node);
    if (core === undefined) {
      return errorType;
    }
    this.record(node, core);
    return context.expression(core, expected);
  }

  record(node: Expression, core: CoreExpression): void {
    this.#cores.set(node, core);
  }

  coreOf(node: NodeOf<string>, pass?: Pass): CoreExpression | undefined {
    return this.#cores.get(node, pass);
  }

  operand(context: BodyContext, node: Expression): Type {
    const type = context.settled(node);
    this.#operands.set(node, type);
    return type;
  }

  /**
   * `node`'s type: an operand's as checked, else what `check` gives, reporting in the words of
   * what it was built for, if anything.
   */
  checking(node: Expression, check: () => Type): Type {
    const operand = this.#operands.get(node);
    if (operand !== undefined) {
      return operand;
    }
    return this.#within(originOf(node), check);
  }

  /** Runs work later in the words reported in now. */
  here(): <Result>(work: () => Result) => Result {
    const origin = this.#origin;
    return (work) => this.#within(origin, work);
  }

  /** `diagnostic`, as the sugar of the node being checked words it. */
  worded(context: BodyContext, diagnostic: Diagnostic<AnchoredSpan>): Diagnostic<AnchoredSpan> {
    const origin = this.#origin;
    if (origin === undefined) {
      return diagnostic;
    }
    const reword = desugarOf(origin.sugar).wording[diagnostic.code];
    return reword === undefined ? diagnostic : reword(context, diagnostic, origin);
  }

  #within<Result>(origin: Origin | undefined, work: () => Result): Result {
    const outer = this.#origin;
    this.#origin = origin;
    try {
      return work();
    } finally {
      this.#origin = outer;
    }
  }
}
