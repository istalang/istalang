/**
 * Placeholders of a constraint scope (docs/work/variance-inference/i2-scope.md §3): a variable no
 * declaration introduces, standing for the type of an expression the scope checks once it knows
 * what is expected of it (../constructs/expressions/postponed.ts), or of what several producers
 * agree on (open-agreement.ts).
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import { unparenthesized } from '../../syntax/expressions/readings.ts';
import type { BodyContext } from '../contexts/body-context.ts';
import { Inference } from '../types/inference/infer.ts';
import type { Placeholder, Type } from '../types/type/index.ts';
import { writtenLiteral } from '../types/unions/unions.ts';

/**
 * A variable of the current constraint scope standing for `node`'s type (i2-scope.md §3), with the
 * inference holding it, in the scope's system. It is its value's whole type, so it stands at the
 * top of it: what consumes the value never chooses it (settle.ts rule 2), and the value converts
 * where it goes, as a literal `3` goes into an `Int?`.
 */
export function placeholderOf(
  context: BodyContext,
  node: Expression,
): { readonly inference: Inference; readonly type: Type } {
  const placeholder: Placeholder = { kind: 'Placeholder', node };
  const inference = new Inference([placeholder], context.checker.fitting, undefined, {
    site: node,
  });
  context.scopes.commit(inference);
  const declared: Type = { kind: 'parameter', declaration: placeholder };
  inference.expect(declared, undefined);
  return { inference, type: inference.open(declared) };
}

/**
 * `node`, when it is a literal written where the current scope still infers what is expected of
 * it, as an element of a tuple or a branch's value (i2-scope.md §2): a variable bounded below by its
 * literal type, fresh, and above by what is `expected` of it, so it settles to that literal type
 * where what it goes into holds one, else to its base (§2); undefined for anything else. One
 * negated or in parentheses is checked as ever too, so lowering finds what it holds.
 */
export function freshLiteralOf(
  context: BodyContext,
  node: Expression,
  expected: Type | undefined,
): Type | undefined {
  const literal = writtenLiteral(unparenthesized(node));
  const { scopes } = context;
  if (
    literal === undefined ||
    !scopes.isOpen ||
    (expected !== undefined && !scopes.holds(expected))
  ) {
    return undefined;
  }
  if (node.kind === 'Unary' || node.kind === 'Parenthesized') {
    context.settled(node);
  }
  const { inference, type } = placeholderOf(context, node);
  inference.matchLiteral(type, literal);
  if (expected !== undefined) {
    inference.match(expected, type);
  }
  return type;
}
