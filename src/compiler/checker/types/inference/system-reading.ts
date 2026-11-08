/**
 * What a system's variables are as read (system.ts), by what it holds alone: so far (`tentativeOf`),
 * fixed (`fixedOf`), solved (`solvedIn`), and whether a struct takes a struct literal's shape
 * (`takesShape`, §3.1). Each reads the system through `SystemReading`, so none mutates it.
 */

import type { Fitting } from '../fitting/fit/index.ts';
import { fitOf } from '../fitting/fit/index.ts';
import { substitute } from '../parts/substitution.ts';
import { parametersIn } from '../parts/type-parts.ts';
import type { ParameterKey, Type } from '../type/index.ts';
import { errorType } from '../type/primitives.ts';
import type { Bound, LowerBound, Related, VariableBounds } from './bounds.ts';

/** What reading a system's variables needs of it. */
export interface SystemReading {
  readonly fitting: Fitting;
  readonly isVariable: (key: ParameterKey) => boolean;
  readonly givenOf: (variable: ParameterKey) => Type | undefined;
  readonly boundsOf: (variable: ParameterKey) => VariableBounds;
  /** The variables `variable` is related to (bounds.ts). */
  readonly relatedOf: (variable: ParameterKey) => Related;
  /** The type `lower` bounds of `variable` join to (fillings.ts). */
  readonly join: (
    variable: ParameterKey,
    lower: readonly LowerBound[],
    upper: readonly Bound[],
  ) => Type | undefined;
}

/**
 * The variables `type` mentions, and every one they reach through their bounds and relations:
 * those a value of `type` given the error type leaves nothing else to bound (`CallSystem.abandon`).
 */
export function reachedFrom(type: Type, reading: SystemReading): ReadonlySet<ParameterKey> {
  const reached = new Set<ParameterKey>();
  const pending = [...parametersIn(type)];
  for (let variable = pending.pop(); variable !== undefined; variable = pending.pop()) {
    if (reading.isVariable(variable) && !reached.has(variable)) {
      reached.add(variable);
      const { equal, lower, upper } = reading.boundsOf(variable);
      const { below, above } = reading.relatedOf(variable);
      const bounds = [...(equal === undefined ? [] : [equal]), ...lower, ...upper];
      pending.push(...bounds.flatMap((bound) => parametersIn(bound.type)), ...below, ...above);
    }
  }
  return reached;
}

/** What `variable`'s bounds tell so far: its equality, its lower bounds' join, else its upper bound. */
export function tentativeOf(variable: ParameterKey, reading: SystemReading): Type | undefined {
  const { equal, lower, upper } = reading.boundsOf(variable);
  if (equal !== undefined) {
    return equal.type;
  }
  if (lower.length > 0) {
    return reading.join(variable, lower, upper);
  }
  const fits = (found: Type, expected: Type) =>
    fitOf(found, expected, reading.fitting) !== undefined;
  return upper.find((bound) => upper.every((other) => fits(bound.type, other.type)))?.type;
}

/**
 * What `variable` is taken as found as: given, or fixed by an equality from the arguments, every
 * variable that mentions fixed too; undefined while one isn't.
 */
export function fixedOf(
  variable: ParameterKey,
  reading: SystemReading,
  seen: ReadonlySet<ParameterKey> = new Set(),
): Type | undefined {
  const given = reading.givenOf(variable);
  const { equal } = reading.boundsOf(variable);
  if (given !== undefined || equal?.origin !== 'argument' || seen.has(variable)) {
    return given;
  }
  const inside = new Map<ParameterKey, Type>();
  for (const other of parametersIn(equal.type).filter(reading.isVariable)) {
    const fixed = fixedOf(other, reading, new Set(seen).add(variable));
    if (fixed === undefined) {
      return undefined;
    }
    inside.set(other, fixed);
  }
  return inside.size === 0 ? equal.type : substitute(equal.type, inside, reading.fitting);
}

/** `type` with every variable as `solved` has it, the error type for one it hasn't. */
export function solvedIn(
  type: Type,
  solved: ReadonlyMap<ParameterKey, Type> | undefined,
  reading: SystemReading,
): Type {
  const each = new Map(solved);
  for (const variable of parametersIn(type)) {
    if (reading.isVariable(variable) && !each.has(variable)) {
      each.set(variable, errorType);
    }
  }
  return substitute(type, each, reading.fitting);
}

/**
 * Whether `target` takes a struct literal of shape `shape` (§3.1): a struct, not a shape, whose
 * fields as a shape the literal's fit.
 */
export function takesShape(target: Type, shape: Type, fitting: Fitting): boolean {
  const fields = target.kind === 'nominal' ? fitting.shapeOf(target) : undefined;
  return (
    shape.kind === 'anonymous' &&
    fields !== undefined &&
    fitOf(shape, fields, fitting) !== undefined
  );
}
