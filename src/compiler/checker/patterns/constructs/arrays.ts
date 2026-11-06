/**
 * Array patterns (§3.11): `[first, ...rest, last]` tests its part's length first, then takes each
 * item against the item it names, counted from the start before the rest and from the end after
 * it; the rest is the items between. A target never takes one, since the length can fail
 * (../walk.ts), so only a walk with tests comes here.
 */

import type { ArrayPattern, Pattern, PatternPart } from '../../../syntax/patterns.ts';
import type { PatternTest } from '../../surface/checked-pattern.ts';
import { errorType } from '../../types/type/primitives.ts';
import { anyShape, type Shape } from '../exhaustiveness/exhaustiveness.ts';
import type { ValuePart } from '../parts.ts';
import type { PatternTests } from '../pattern-tests.ts';
import type { Taking } from '../taking.ts';

/** A walk taking an array pattern's items: each takes its part, and its tests are found. */
interface ItemTaking extends Taking<Pattern | PatternPart> {
  readonly found: PatternTest[];
}

/** `node` over `part`: its length test, then its items and rest; its shape. */
export function takeArray(
  walk: ItemTaking,
  tests: PatternTests,
  node: ArrayPattern,
  part: ValuePart,
): Shape | undefined {
  const array = tests.array(node, part);
  const restAt = node.elements.findIndex((element) => element.kind === 'RestPattern');
  const prefix = restAt < 0 ? node.elements : node.elements.slice(0, restAt);
  const suffix = restAt < 0 ? [] : node.elements.slice(restAt + 1);
  const item = (offset: number): ValuePart => ({
    type: array?.items ?? errorType,
    path: [...part.path, { kind: 'item', site: node, offset }],
  });
  if (array !== undefined) {
    walk.found.push(array.test);
  }
  const shapes = {
    prefix: prefix.map((element, index) => walk.take(element, item(index))),
    suffix: suffix.map((element, index) => walk.take(element, item(index - suffix.length))),
  };
  const rest = node.elements[restAt];
  if (rest !== undefined) {
    const between = {
      kind: 'rest',
      site: node,
      before: prefix.length,
      after: suffix.length,
    } as const;
    walk.take(rest, {
      type: array === undefined ? errorType : part.type,
      path: [...part.path, between],
    });
  }
  const known = [...shapes.prefix, ...shapes.suffix];
  if (array === undefined || known.some((shape) => shape === undefined)) {
    return array === undefined ? anyShape : undefined;
  }
  return {
    kind: 'array',
    prefix: shapes.prefix.filter(isShape),
    suffix: shapes.suffix.filter(isShape),
    hasRest: restAt >= 0,
  };
}

function isShape(shape: Shape | undefined): shape is Shape {
  return shape !== undefined;
}
