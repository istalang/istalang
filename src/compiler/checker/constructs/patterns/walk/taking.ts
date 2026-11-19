/**
 * Taking a value apart into targets (§11.3, §4.5): one target takes it whole, several a tuple of
 * as many, and a tuple or struct destructuring each of its parts. A pattern's walk (walk/index.ts)
 * and an assignment's (constructs/statements/assignments.ts) take apart the same way; only what
 * stands at their leaves differs, which each says through its own `take`.
 */

import type { Destructuring, FieldTarget } from '../../../../syntax/statements/targets.ts';
import type { AnchoredSpan } from '../../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import type { FieldStep, PartStep } from '../../../surface/checked-pattern.ts';
import type { FieldMember } from '../../../types/type/index.ts';
import { anyShape, type Shape } from '../exhaustiveness/exhaustiveness.ts';
import { structKey, tupleKey } from '../exhaustiveness/shapes.ts';
import { elementParts, fieldPart, structParts, type ValuePart } from './parts.ts';

/**
 * How a walk takes the targets a value is taken apart into: where it reports, and each target.
 * `Step` is what its parts' paths are made of: a pattern's may read an array's items or test a
 * member, an assignment's never does, so its paths are positions and fields.
 */
export interface Taking<Target, Step extends PartStep = PartStep> {
  readonly context: BodyContext;
  /** Takes `target` over the part of the value it reaches; its shape. */
  readonly take: (target: Target, part: ValuePart<Step>) => Shape | undefined;
}

/**
 * Takes a value of `part` apart into `targets`, at `span`: one takes it whole, and several a tuple
 * of as many, as if parenthesized (§4.5).
 */
export function takeTargets<Target, Step extends PartStep>(
  taking: Taking<Target, Step | number | FieldStep>,
  targets: readonly Target[],
  part: ValuePart<Step | number | FieldStep>,
  span: AnchoredSpan,
): Shape | undefined {
  const [only] = targets;
  if (targets.length === 1 && only !== undefined) {
    return taking.take(only, part);
  }
  return takeApart(taking, { kind: 'tuple', elements: targets, span }, part);
}

/**
 * Takes a value of `part` apart as `destructuring` says, each of its targets taking its part: a
 * tuple of exactly as many elements, or a struct value's fields (parts.ts). A struct whose fields
 * are unknown, after a report or for an error value, has no shape: it acts as a guard.
 */
export function takeApart<Target, Step extends PartStep>(
  taking: Taking<Target, Step | number | FieldStep>,
  destructuring: Destructuring<Target>,
  part: ValuePart<Step | number | FieldStep>,
): Shape | undefined {
  if (destructuring.kind === 'tuple') {
    const { elements, span } = destructuring;
    const parts = elementParts(taking.context, part, elements.length, span);
    const shapes = elements.map((element, index) => taking.take(element, parts[index] ?? part));
    return constructed(tupleKey, shapes);
  }
  const fields = structParts(taking.context, destructuring.type, part.type, destructuring.span);
  return takeStructFields(taking, destructuring.items, fields, part);
}

/**
 * Takes a struct value of `part` apart into `items`, each taking the field of `fields` it names, the
 * struct's (parts.ts `structParts`); unknown fields give no shape, a guard.
 */
export function takeStructFields<Target, Step extends PartStep>(
  taking: Taking<Target, Step | FieldStep>,
  items: readonly FieldTarget<Target>[],
  fields: readonly FieldMember[] | undefined,
  part: ValuePart<Step | FieldStep>,
): Shape | undefined {
  const shapes = takeFields(taking, items, fields, part);
  return fields === undefined ? undefined : constructed(structKey, shapes);
}

/**
 * The shapes of `fields`' fields, by position, as `items` take them: what each item says of its
 * field, anything for a field no item names. A field two items take makes the whole a guard.
 */
function takeFields<Target, Step extends PartStep>(
  taking: Taking<Target, Step | FieldStep>,
  items: readonly FieldTarget<Target>[],
  fields: readonly FieldMember[] | undefined,
  part: ValuePart<Step | FieldStep>,
): readonly (Shape | undefined)[] {
  const shapes: (Shape | undefined)[] = (fields ?? []).map(() => anyShape);
  const taken = new Set<number>();
  for (const item of items) {
    const field = fieldPart(taking.context, fields, item, part);
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
