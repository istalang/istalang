/**
 * Array patterns (§3.11): `[first, ...rest, last]` tests its part's length first, then takes each
 * item against the item it names, counted from the start before the rest and from the end after
 * it; the rest is the items between. A call pattern's arguments past its variant's fixed fields
 * match the rest field's items the same way (variant-calls.ts), any items past them too when its
 * last `...` leaves them open. A target never takes them, since the length can fail (../index.ts),
 * so only a walk with tests comes here.
 */

import type { Pattern, PatternPart } from '../../../../../syntax/patterns.ts';
import type { PatternTest } from '../../../../surface/checked-pattern.ts';
import { errorType } from '../../../../types/type/primitives.ts';
import { anyShape, type Shape } from '../../exhaustiveness/exhaustiveness.ts';
import type { ValuePart } from '../parts.ts';
import type { ArrayItems, PatternTests } from '../pattern-tests.ts';
import type { Taking } from '../taking.ts';

/** A walk taking an array's items: each takes its part, and its tests are found. */
export interface ItemTaking extends Taking<Pattern | PatternPart> {
  readonly found: PatternTest[];
}

/** `items` over `part`: its length test, then its items and rest; its shape. */
export function takeArray(
  walk: ItemTaking,
  tests: PatternTests,
  items: ArrayItems,
  part: ValuePart,
): Shape | undefined {
  const { site, elements, isOpen = false } = items;
  const array = tests.array(items, part);
  const restAt = elements.findIndex((element) => element.kind === 'RestPattern');
  const prefix = restAt < 0 ? elements : elements.slice(0, restAt);
  const later = restAt < 0 ? [] : elements.slice(restAt + 1);
  const suffix = later.filter((element) => element.kind !== 'RestPattern');
  // A second rest, which the parser refused, takes no items: it binds its name at the error type.
  for (const extra of later.filter((element) => element.kind === 'RestPattern')) {
    walk.take(extra, { type: errorType, path: part.path });
  }
  const item = (offset: number): ValuePart => ({
    type: array?.items ?? errorType,
    path: [...part.path, { kind: 'item', site, offset }],
  });
  if (array !== undefined) {
    walk.found.push(array.test);
  }
  const shapes = {
    prefix: prefix.map((element, index) => walk.take(element, item(index))),
    suffix: suffix.map((element, index) => walk.take(element, item(index - suffix.length))),
  };
  const rest = elements[restAt];
  if (rest !== undefined) {
    const between = {
      kind: 'rest',
      site,
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
    hasRest: restAt >= 0 || isOpen,
  };
}

function isShape(shape: Shape | undefined): shape is Shape {
  return shape !== undefined;
}
