/**
 * Array comprehensions (§4): `[for x in xs if c: e]` runs over any iterable like a `for`
 * (rules/iteration.ts) and builds an array of `e` for each item `c` keeps. The expected array's
 * element type, seen as an array literal sees it (collections.ts), is what `e` is expected to
 * have; `is` bindings in `c` reach `e` as the binder arranged.
 *
 * `[for k, v in ...x: e]` builds one of `e` per field of `x` instead (rules/field-passes.ts), `e`
 * checked once per pass as an array literal's elements are, each expected to have what those
 * before it agree on; the elements then agree as an array literal's do (rules/agreement.ts), each
 * settled back in its own pass, widened with nothing expected as disagreeing ones widen however
 * many passes there are, so a key gives a String (§4) over one field as over several, and over a
 * generic struct as over the one substituted for it. A struct with no fields gives no element, so
 * an array of `Never` with nothing expected.
 */

import type { Comprehension, FieldComprehension } from '../../syntax/expressions/index.ts';
import type { BodyContext } from '../body-context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import {
  agreedType,
  decidedSoFar,
  type Produced,
  producedBy,
  settleProduced,
  wholeWidened,
} from '../rules/agreement.ts';
import { checkedFieldPasses, inFieldPasses } from '../rules/field-passes.ts';
import { checkLoopOver } from '../rules/iteration.ts';
import { boolType, neverType, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
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

export function checkFieldComprehension(
  context: BodyContext,
  node: FieldComprehension,
  expected: Type | undefined,
): Type {
  const expectedElement = expectedArrayItem(context, expected);
  const byPass: (Produced | undefined)[] = [];
  const produced: Produced[] = [];
  const passes = checkedFieldPasses(context, node.header);
  const checked = inFieldPasses(context, node.header, passes, ({ visits }) => {
    const type = context.expression(node.body, expectedElement ?? decidedSoFar(context, produced));
    const element = producedBy(context, node.body, type);
    // A pass visiting no field gives no element: its body never runs.
    byPass.push(visits.kind === 'none' ? undefined : element);
    if (visits.kind !== 'none') {
      produced.push(element);
    }
  });
  const decided = agreedElement(context, produced, expectedElement);
  if (decided !== undefined) {
    const agreed = {
      decided,
      expected: expectedElement,
      mismatch: (span: Produced['span'], agreedOn: Type, found: Type) =>
        checkerDiagnostics.itemTypes(span, 'element', typeText(agreedOn), typeText(found)),
    };
    checked.inEach((_, index) => {
      const element = byPass[index];
      if (element !== undefined) {
        settleProduced(context, element, agreed);
      }
    });
  }
  return arrayOf(context.checker, expectedElement ?? decided ?? neverType);
}

/**
 * What a field comprehension's elements agree on: with nothing expected, widened as producers
 * that disagree widen, a key inside an element built from it too, so a key is a String whichever
 * and however many fields it names (§4), and a generic comprehension has, instantiated, the type
 * it has over the struct substituted.
 */
function agreedElement(
  context: BodyContext,
  produced: readonly Produced[],
  expected: Type | undefined,
): Type | undefined {
  const { decided } = agreedType(produced, context.checker, expected);
  return expected === undefined && decided !== undefined
    ? wholeWidened(decided, produced, context.checker)
    : decided;
}
