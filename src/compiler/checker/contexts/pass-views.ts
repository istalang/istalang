/**
 * A field loop's passes read as one body, for tools asking about a node inside it (§4): the body is
 * checked once per field it visits (passes.ts), but a position in the text is one node. The bodies
 * of every pass of the field loops around a node are read as one, each fact joined as its entry in
 * the body's facts table says (wiring/body/facts/). A loop with no pass, over a struct with no
 * fields, checked nothing, so its nodes are read as the body around it reads them.
 */

import type { FieldLoopHeader } from '../../syntax/expressions/index.ts';
import { isOverFields, passedParts } from '../../syntax/statements/readings.ts';
import type { SyntaxNode } from '../../syntax/tree/index.ts';
import type { CheckedBody } from '../surface/checked-body.ts';
import type { JoinedBody } from '../surface/denotation.ts';
import type { TypeRules } from '../types/type/type-rules.ts';

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
        (part !== undefined && headerBinds(each.header, part));
      const [pass, ...more] = passed
        ? bodies.flatMap((outer) => outer.passesOf(each.header).map((inner) => inner.body))
        : [];
      return pass === undefined ? bodies : [pass, ...more];
    },
    [body],
  );
  return first.joinedWith(others, rules);
}

/** Whether `part` of `header` is what each pass binds: a value's key or value, or a type's key. */
function headerBinds(header: FieldLoopHeader, part: SyntaxNode): boolean {
  return header.kind === 'TypeParameter'
    ? part === header.name
    : part === header.key || part === header.value;
}
