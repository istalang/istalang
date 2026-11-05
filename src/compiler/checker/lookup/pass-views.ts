/**
 * A field loop's passes read as one body, for tools asking about a node inside it (§4): the body
 * is checked once per field it visits (passes.ts), but a position in the text is one node.
 *
 * - A type joins every pass's: a key is each field's name, a value each field's type. Tools show
 *   what the text means across the loop, as a hover over the loop's value shows the union of its
 *   fields' types.
 * - Anything else, a call, a pattern, a field read, is the first pass's that has one: each pass
 *   checked the same text, and what differs between them is their types.
 * - A loop with no pass, over a struct with no fields, checked nothing, so its nodes answer
 *   nothing.
 */

import type { FieldHeader } from '../../syntax/expressions/index.ts';
import { isOverFields, passedParts } from '../../syntax/statements.ts';
import type { SyntaxNode } from '../../syntax/tree.ts';
import type { CheckedBody } from '../check.ts';
import type { Type } from '../types/type.ts';
import type { TypeRules } from '../types/type-rules.ts';
import { unionOf } from '../types/unions.ts';

/**
 * `body` as tools read it at `node`, below each construct over fields on `path` (from `node`
 * outward) whose header binds or whose passed parts hold `node`: each one's passes, joined.
 */
export function passesAround(
  body: CheckedBody,
  path: readonly SyntaxNode[],
  rules: TypeRules,
): CheckedBody {
  const outward = path.toReversed();
  return outward.reduce((outer, each, index) => {
    if (!isOverFields(each)) {
      return outer;
    }
    const child = outward[index + 1];
    const part = child === each.header ? outward[index + 2] : undefined;
    const passed =
      passedParts(each).some((passedPart) => passedPart === child) ||
      part === each.header.key ||
      part === each.header.value;
    return passed ? joined(outer, each.header, rules) : outer;
  }, body);
}

/** `outer`'s passes of the loop `header` heads read as one body; `outer` when it has none. */
function joined(outer: CheckedBody, header: FieldHeader, rules: TypeRules): CheckedBody {
  const passes = outer.passesOf(header).map((pass) => pass.body);
  const [first] = passes;
  if (first === undefined) {
    return outer;
  }
  const typeJoined =
    <Node>(read: (body: CheckedBody) => (node: Node) => Type | undefined) =>
    (node: Node): Type | undefined => {
      const types = passes.flatMap((pass) => read(pass)(node) ?? []);
      return types.length === 0 ? undefined : unionOf(types, rules);
    };
  const firstOf =
    <Node, Value>(read: (body: CheckedBody) => (node: Node) => Value | undefined) =>
    (node: Node): Value | undefined => {
      for (const pass of passes) {
        const value = read(pass)(node);
        if (value !== undefined) {
          return value;
        }
      }
      return undefined;
    };
  return {
    ...first,
    typeOf: typeJoined((pass) => pass.typeOf),
    expectedOf: typeJoined((pass) => pass.expectedOf),
    declaredTypeOf: typeJoined((pass) => pass.declaredTypeOf),
    resolved: {
      get: firstOf((pass) => pass.resolved.get),
      has: (site) => passes.some((pass) => pass.resolved.has(site)),
    },
    valueCalls: {
      get: firstOf((pass) => pass.valueCalls.get),
      has: (call) => passes.some((pass) => pass.valueCalls.has(call)),
    },
    implicitCallOf: (node, role) =>
      passes.map((pass) => pass.implicitCallOf(node, role)).find((call) => call !== undefined),
    targetsOf: (owner) =>
      passes.find((pass) => pass.targetsOf(owner).length > 0)?.targetsOf(owner) ?? [],
    assignedOf: (assignment) =>
      passes.find((pass) => pass.assignedOf(assignment).length > 0)?.assignedOf(assignment) ?? [],
    functionOf: firstOf((pass) => pass.functionOf),
    sourcesOf: firstOf((pass) => pass.sourcesOf),
    literalFieldsOf: firstOf((pass) => pass.literalFieldsOf),
    patternOf: firstOf((pass) => pass.patternOf),
    chainOf: firstOf((pass) => pass.chainOf),
    fieldReadOf: firstOf((pass) => pass.fieldReadOf),
    namedFieldOf: firstOf((pass) => pass.namedFieldOf),
    keyOwnerOf: firstOf((pass) => pass.keyOwnerOf),
    chosenVariantOf: firstOf((pass) => pass.chosenVariantOf),
    candidatesAt: (site) =>
      passes.find((pass) => pass.candidatesAt(site).length > 0)?.candidatesAt(site) ?? [],
    passesOf: (inner) => passes.flatMap((pass) => pass.passesOf(inner)),
    isRuledOut: (body) => passes.every((pass) => pass.isRuledOut(body)),
    stopsAt: firstOf((pass) => pass.stopsAt),
    decidedOf: firstOf((pass) => pass.decidedOf),
  };
}
