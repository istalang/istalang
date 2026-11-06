/**
 * A field loop's passes read as one body, for tools asking about a node inside it (§4): the body
 * is checked once per field it visits (passes.ts), but a position in the text is one node. The
 * bodies of every pass of the field loops around a node are read as one, each fact joined as its
 * entry in the body's facts table says (body-facts/). A loop with no pass, over a struct with no
 * fields, checked nothing, so its nodes are read as the body around it reads them.
 */

import { isOverFields, passedParts } from '../../syntax/statements.ts';
import type { SyntaxNode } from '../../syntax/tree.ts';
import type { CheckedBody } from '../check.ts';
import type { JoinedBody } from '../joined-body.ts';
import type { TypeRules } from '../types/type-rules.ts';

/** One answer per pass of a field loop, in the order checked: there is one at least. */
export type PassAnswers<Answer> = readonly [Answer, ...Answer[]];

/**
 * `body` as tools read it at `node`, below each construct over fields on `path` (from `node`
 * outward) whose header binds or whose passed parts hold `node`: every one's passes, read as one.
 */
export function passesAround(
  body: CheckedBody,
  path: readonly SyntaxNode[],
  rules: TypeRules,
): JoinedBody {
  const outward = path.toReversed();
  const [first, ...others] = outward.reduce<PassAnswers<CheckedBody>>(
    (bodies, each, index) => {
      if (!isOverFields(each)) {
        return bodies;
      }
      const child = outward[index + 1];
      const part = child === each.header ? outward[index + 2] : undefined;
      const passed =
        passedParts(each).some((passedPart) => passedPart === child) ||
        part === each.header.key ||
        part === each.header.value;
      const [pass, ...more] = passed
        ? bodies.flatMap((outer) => outer.passesOf(each.header).map((inner) => inner.body))
        : [];
      return pass === undefined ? bodies : [pass, ...more];
    },
    [body],
  );
  return first.joinedWith(others, rules);
}
