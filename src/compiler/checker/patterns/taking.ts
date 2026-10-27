/**
 * Taking a value apart into targets (§3.11, §3.15): one target takes it whole, several a tuple of
 * as many, and a tuple or struct destructuring each of its parts. A pattern's walk (walk.ts) and an
 * assignment's (statements/assignments.ts) take apart the same way; only what stands at their
 * leaves differs, which each says through its own `take`.
 */

import type { Span } from '../../../text/span.ts';
import type { Destructuring, FieldTarget } from '../../syntax/statements.ts';
import type { FieldMember } from '../types/type.ts';
import { anyShape, type Shape } from './exhaustiveness.ts';
import {
  elementParts,
  fieldPart,
  type PatternScope,
  structParts,
  type ValuePart,
} from './parts.ts';
import { structKey, tupleKey } from './shapes.ts';

/** How a walk takes the targets a value is taken apart into: where it reports, and each target. */
export interface Taking<Target> {
  readonly scope: PatternScope;
  /** Takes `target` over the part of the value it reaches; its shape. */
  readonly take: (target: Target, part: ValuePart) => Shape | undefined;
}

/**
 * Takes a value of `part` apart into `targets`, at `span`: one takes it whole, and several a tuple
 * of as many, as if parenthesized (§3.15).
 */
export function takeTargets<Target>(
  taking: Taking<Target>,
  targets: readonly Target[],
  part: ValuePart,
  span: Span,
): Shape | undefined {
  const [only] = targets;
  if (targets.length === 1 && only !== undefined) {
    return taking.take(only, part);
  }
  return takeApart(taking, { kind: 'tuple', elements: targets, span }, part);
}

/**
 * Takes a value of `part` apart as `destructuring` says, each of its targets taking its part: a
 * tuple of exactly as many elements, or a struct value's fields (parts.ts).
 */
export function takeApart<Target>(
  taking: Taking<Target>,
  destructuring: Destructuring<Target>,
  part: ValuePart,
): Shape | undefined {
  if (destructuring.kind === 'tuple') {
    const { elements, span } = destructuring;
    const parts = elementParts(taking.scope, part, elements.length, span);
    const shapes = elements.map((element, index) => taking.take(element, parts[index] ?? part));
    return constructed(tupleKey, shapes);
  }
  const fields = structParts(taking.scope, destructuring.type, part.type, destructuring.span);
  return constructed(structKey, takeFields(taking, destructuring.items, fields, part));
}

/**
 * The shapes of a struct's or variant's fields, by position, as `items` take them: what each item
 * says of its field, anything for a field no item names. A field two items take makes the whole
 * a guard.
 */
export function takeFields<Target>(
  taking: Taking<Target>,
  items: readonly FieldTarget<Target>[],
  fields: readonly FieldMember[] | undefined,
  part: ValuePart,
): readonly (Shape | undefined)[] {
  const shapes: (Shape | undefined)[] = (fields ?? []).map(() => anyShape);
  const taken = new Set<number>();
  for (const item of items) {
    const field = fieldPart(taking.scope, fields, item, part);
    const shape = taking.take(item.target, field.part);
    if (field.index >= 0) {
      shapes[field.index] = taken.has(field.index) ? undefined : shape;
      taken.add(field.index);
    }
  }
  return shapes;
}

/** A constructor's shape; a guard when any argument is one. */
export function constructed(
  key: string,
  shapes: readonly (Shape | undefined)[],
): Shape | undefined {
  const known = shapes.filter((shape) => shape !== undefined);
  return known.length === shapes.length
    ? { kind: 'constructor', key, arguments: known }
    : undefined;
}
