/**
 * What checking decides of which code of a body runs (§2, §4), recorded per pass as every record of
 * a node is (passes.ts): a branch or case a condition its operands' types decide rules out, the
 * operands an operation runs before one with no value stops it, and the value such a condition
 * always has. Lowering reads them, so nothing ruled out is lowered.
 */

import type { Expression } from '../../../syntax/expressions/index.ts';
import type { Assignment, Block } from '../../../syntax/statements/index.ts';
import type { DecisionRecord } from '../../contexts/body-context.ts';
import type { Pass, Passes, PassTable } from '../../contexts/passes.ts';

/** What checking one body decided of the code that runs in it. */
export class FlowDecisions implements DecisionRecord {
  readonly #ruledOut: PassTable<Block, true>;
  readonly #stops: PassTable<Expression | Assignment, readonly Expression[]>;
  readonly #decided: PassTable<Expression, boolean>;

  constructor(passes: Passes) {
    this.#ruledOut = passes.table();
    this.#stops = passes.table();
    this.#decided = passes.table();
  }

  ruleOut(body: Block): void {
    this.#ruledOut.set(body, true);
  }

  isRuledOut(body: Block, pass?: Pass): boolean {
    return this.#ruledOut.has(body, pass);
  }

  stopAt(operation: Expression | Assignment, operands: readonly Expression[]): void {
    this.#stops.set(operation, operands);
  }

  stopsAt(operation: Expression | Assignment, pass?: Pass): readonly Expression[] | undefined {
    return this.#stops.get(operation, pass);
  }

  decide(condition: Expression, value: boolean): void {
    this.#decided.set(condition, value);
  }

  decidedAt(node: Expression, pass?: Pass): boolean | undefined {
    return this.#decided.get(node, pass);
  }
}
