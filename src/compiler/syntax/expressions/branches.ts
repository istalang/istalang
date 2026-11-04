/**
 * The blocks whose tails give a branching expression its value (§4): every branch of an `if` and
 * its `else`, every case of a `match`, every case of a `select` and its `else`. An `if` without
 * `else` has `Unit` of its own, so none of its blocks gives it a value. What takes a value's type
 * from the expected one reads the branches here: the type a call decides, and the lambdas inferred
 * in them.
 */

import type { Block } from '../statements.ts';
import { casesOf, type If, type Match, type Select, selectCasesOf } from './index.ts';

export function valueBranchesOf(node: If | Match | Select): readonly Block[] {
  switch (node.kind) {
    case 'If': {
      const elseBody = node.elseClause?.body;
      return elseBody === undefined ? [] : [...node.branches.map(({ body }) => body), elseBody];
    }
    case 'Match':
      return casesOf(node).map(({ body }) => body);
    case 'Select': {
      const cases = selectCasesOf(node).map(({ body }) => body);
      const elseBody = node.elseClause?.body;
      return elseBody === undefined ? cases : [...cases, elseBody];
    }
    default: {
      const unhandled: never = node;
      return unhandled;
    }
  }
}
