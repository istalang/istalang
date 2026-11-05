/**
 * Array comprehensions (§4): `[for x in xs if c: e]` runs over any iterable like a `for`
 * (rules/iteration.ts) and builds an array of `e` for each item `c` keeps. The expected array's
 * element type, seen as an array literal sees it (collections.ts), is what `e` is expected to
 * have; `is` bindings in `c` reach `e` as the binder arranged.
 */

import type { Comprehension } from '../../syntax/expressions/index.ts';
import type { BodyContext } from '../body-context.ts';
import { checkLoopOver } from '../rules/iteration.ts';
import { boolType, type Type } from '../types/type.ts';
import { arrayOf } from '../types/well-known.ts';
import { expectedArrayItem } from './collections.ts';

export function checkComprehension(
  context: BodyContext,
  node: Comprehension,
  expected: Type | undefined,
): Type {
  const { checker } = context;
  checkLoopOver(context, node);
  if (node.condition !== undefined) {
    context.expect(node.condition, boolType);
  }
  const expectedElement = expectedArrayItem(context, expected);
  const element = context.expect(node.body, expectedElement);
  return arrayOf(checker, expectedElement ?? element);
}
