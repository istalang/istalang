/**
 * Reading a part of a value along the steps the checker found to it (checked-pattern.ts): what a
 * pattern tests and binds, and what a declaration's or loop's targets bind (§3.11, §3.15).
 *
 * - Fields, tuple elements and what a union's or an `any`'s variant holds are read as a place, by
 *   position: a field the checker named at the position its struct type, as instantiated, gives
 *   the name (§3.1 "Field order"); a tuple's element or a variant's field at its own.
 * - An array's item or rest is what the call the checker made at its pattern gives, and a struct
 *   pattern's rest a struct built anew from the fields it takes (`rebuiltAs`): what follows such a
 *   step reads that new value.
 */

import type { Register } from '../../definition/operands.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { ArrayStep, PartStep, StructStep } from '../checker/surface/checked-pattern.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import type { FunctionContext } from './context.ts';
import { emitImplicitCall } from './emit-call.ts';
import { heldPositions, holdingOf } from './holdings.ts';
import { rebuiltAs } from './struct-values.ts';

/** A step that makes a new value of the part it stands at, rather than reading a place in it. */
type BuildingStep = ArrayStep | Extract<StructStep, { kind: 'fieldRest' }>;

/** The part of `subject` along `path`. */
export function readPartAlong(
  context: FunctionContext,
  subject: Register,
  path: readonly PartStep[],
  span: AnchoredSpan,
): Register {
  let value = subject;
  let positions: number[] = [];
  for (const step of path) {
    if (isBuilding(step)) {
      value = builtAt(context, context.code.readPath(value, positions, span), step, span);
      positions = [];
    } else {
      positions.push(...positionsOf(context, step));
    }
  }
  return context.code.readPath(value, positions, span);
}

function isBuilding(step: PartStep): step is BuildingStep {
  return (
    typeof step !== 'number' &&
    step.kind !== 'member' &&
    step.kind !== 'downcast' &&
    step.kind !== 'field'
  );
}

/** What `step` makes of `part`: an array's length, item or rest, or a struct pattern's rest. */
function builtAt(
  context: FunctionContext,
  part: Register,
  step: BuildingStep,
  span: AnchoredSpan,
): Register {
  if (step.kind === 'fieldRest') {
    const { from, to } = step;
    return to.kind === 'nominal' || to.kind === 'anonymous'
      ? rebuiltAs(context, part, { from, to }, span)
      : unreachable("A rest's struct type reached lowering unreduced.");
  }
  const offsets = stepOffsets(step).map((offset) => context.constant(BigInt(offset), span));
  return emitImplicitCall(context, step.site, step.kind, [part, ...offsets]);
}

/**
 * The positions `step` reads as a place: an element's or variant field's own, a named field's in
 * the struct an instantiation made, the one field of the variant an `any`'s value is held in, or where a union
 * holds its member's value as an instantiation made it (holdings.ts): none where the union
 * collapsed into that one type (§3.5), inside the `any` type that took the member whole.
 */
function positionsOf(
  context: FunctionContext,
  step: Exclude<PartStep, BuildingStep>,
): readonly number[] {
  if (typeof step === 'number') {
    return [step];
  }
  switch (step.kind) {
    case 'downcast':
      return [0];
    case 'field': {
      const position = (context.checker.fieldsOf(step.of) ?? []).findIndex(
        (field) => field.name === step.name,
      );
      return position < 0 ? unreachable(`'${step.name}' is no field of its struct.`) : [position];
    }
    case 'member': {
      const holding = holdingOf(context, step.union, step.member);
      return holding === undefined ? [] : heldPositions(step.union, holding);
    }
    default: {
      const unhandled: never = step;
      return unhandled;
    }
  }
}

function stepOffsets(step: ArrayStep): readonly number[] {
  if (step.kind === 'length') {
    return [];
  }
  return step.kind === 'item' ? [step.offset] : [step.before, step.after];
}
