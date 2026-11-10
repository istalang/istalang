/**
 * What a system's variables are as read (system.ts), by what it holds alone: so far (`tentativeOf`),
 * fixed (`fixedOf`), solved (`solvedIn`), and whether a struct takes a struct literal's shape
 * (`takesShape`, §3.1). Each reads the system through `SystemReading`, so none mutates it.
 */

import type { Fitting } from '../fitting/fit/index.ts';
import { fitOf } from '../fitting/fit/index.ts';
import { sameType } from '../identity/identity.ts';
import { type Substitution, substitute } from '../parts/substitution.ts';
import { parametersIn } from '../parts/type-parts.ts';
import { declaresDefault } from '../type/field-defaults.ts';
import type { ParameterKey, Type } from '../type/index.ts';
import { errorType } from '../type/primitives.ts';
import { membersOf } from '../unions/unions.ts';
import { hasBounds, type Settling, type SettlingView, waitedOn } from './settle.ts';
import {
  type Bound,
  isAdvice,
  type LowerBound,
  mentionedBy,
  type Related,
  type VariableBounds,
} from './variable-bounds.ts';
import type { CallVariables } from './variables.ts';

/** What reading a system's variables needs of it. */
export interface SystemReading {
  readonly fitting: Fitting;
  readonly isVariable: (key: ParameterKey) => boolean;
  /** The call `variable` is one of the variables of. */
  readonly callOf: (variable: ParameterKey) => CallVariables | undefined;
  readonly givenOf: (variable: ParameterKey) => Type | undefined;
  /**
   * What `variable` is taken as found as (`fixedByBounds`), each variable read once per state of
   * the system, as readiness and fixing ask it of every variable they pass.
   */
  readonly fixedOf: (variable: ParameterKey) => Type | undefined;
  readonly boundsOf: (variable: ParameterKey) => VariableBounds;
  /** The variables `variable` is related to (bounds.ts). */
  readonly relatedOf: (variable: ParameterKey) => Related;
  /** The type `lower` bounds of `variable` join to (fillings.ts). */
  readonly join: (
    variable: ParameterKey,
    lower: readonly LowerBound[],
    upper: readonly Bound[],
  ) => Type | undefined;
  /** What `variable` falls back to where no bound settles it: the error type or `Never` it met. */
  readonly fallbackOf: (variable: ParameterKey) => Type | undefined;
  /** The system's variables. */
  readonly variables: () => Iterable<ParameterKey>;
}

/**
 * The variables a value of `type` given the error type leaves nothing to bound
 * (`CallSystem.abandon`): of those it mentions and every one they reach through their bounds and
 * relations, those bounded by nothing; one bounded on its own still settles by its bounds,
 * reporting what disagrees there.
 */
export function abandonedFrom(type: Type, reading: SystemReading): readonly ParameterKey[] {
  return [...reachedFrom([type], reading)].filter((variable) => {
    const { equal, lower, upper } = reading.boundsOf(variable);
    return equal === undefined && lower.length === 0 && upper.length === 0;
  });
}

/**
 * The variables `types` mention, and every one they reach through their bounds and relations, each
 * once, as they are reached, so a search stops at the one it looks for; of those `passes` refuses,
 * none they reach.
 */
function* reachedFrom(
  types: readonly Type[],
  reading: SystemReading,
  passes: (variable: ParameterKey) => boolean = () => true,
): Generator<ParameterKey, void, undefined> {
  const reached = new Set<ParameterKey>();
  const pending = types.flatMap(parametersIn);
  for (let variable = pending.pop(); variable !== undefined; variable = pending.pop()) {
    if (reading.isVariable(variable) && !reached.has(variable)) {
      reached.add(variable);
      yield variable;
      if (passes(variable)) {
        const { below, above } = reading.relatedOf(variable);
        pending.push(...mentionedBy(reading.boundsOf(variable)), ...below, ...above);
      }
    }
  }
}

/** What `variable`'s bounds tell so far: its equality, its lower bounds' join, else its upper bound. */
export function tentativeOf(variable: ParameterKey, reading: SystemReading): Type | undefined {
  const { equal, lower, upper } = reading.boundsOf(variable);
  if (equal !== undefined) {
    return equal.type;
  }
  if (lower.length > 0) {
    // A variable a bound mentions may be fixed already (fixing-toward.ts), which tells the bound more.
    const fixedLower = lower.map((bound) => ({ ...bound, type: fixedIn(bound.type, reading) }));
    return reading.join(variable, fixedLower, upper);
  }
  const order = reading.fitting.qualifierOf(variable)?.order;
  const fits = (found: Type, expected: Type) =>
    order === undefined
      ? fitOf(found, expected, reading.fitting) !== undefined
      : order.below(found, expected, sameType);
  return upper.find((bound) => upper.every((other) => fits(bound.type, other.type)))?.type;
}

/**
 * `type` with each variable what its bounds tell so far, and so on for those that mentions, as
 * `struct{x: 1}`'s shape mentions its fresh literal's; undefined where one's tell nothing, or tell
 * only of themselves.
 */
export function tentativeIn(
  type: Type,
  reading: SystemReading,
  seen: ReadonlySet<ParameterKey> = new Set(),
): Type | undefined {
  const found = new Map<ParameterKey, Type>();
  for (const variable of parametersIn(type).filter(reading.isVariable)) {
    const tentative = seen.has(variable) ? undefined : tentativeOf(variable, reading);
    const told =
      tentative === undefined
        ? undefined
        : tentativeIn(tentative, reading, new Set(seen).add(variable));
    if (told === undefined) {
      return undefined;
    }
    found.set(variable, told);
  }
  return found.size === 0 ? type : substitute(type, found, reading.fitting);
}

/**
 * What `variable` is taken as found as: given, as a judged placeholder is, or fixed by an equality
 * from the arguments, every variable that mentions fixed too (`SystemReading.fixedOf`); undefined
 * while one isn't.
 */
export function fixedByBounds(variable: ParameterKey, reading: SystemReading): Type | undefined {
  const { equal } = reading.boundsOf(variable);
  const found =
    reading.givenOf(variable) ?? (equal === undefined || isAdvice(equal) ? undefined : equal.type);
  if (found === undefined) {
    return undefined;
  }
  const inside = new Map<ParameterKey, Type>();
  for (const other of parametersIn(found).filter(reading.isVariable)) {
    const fixed = reading.fixedOf(other);
    if (fixed === undefined) {
      return undefined;
    }
    inside.set(other, fixed);
  }
  return inside.size === 0 ? found : substitute(found, inside, reading.fitting);
}

/**
 * `type` with every variable as `solved` has it, the error type for one it hasn't. `solved` holds
 * every variable of the scope and each record is solved through it, so it is copied only where
 * `type` mentions one it lacks.
 */
export function solvedIn(
  type: Type,
  solved: ReadonlyMap<ParameterKey, Type> | undefined,
  reading: SystemReading,
): Type {
  const unsolved = parametersIn(type).filter(
    (variable) => reading.isVariable(variable) && solved?.has(variable) !== true,
  );
  if (unsolved.length === 0) {
    return solved === undefined ? type : substitute(type, solved, reading.fitting);
  }
  const each = new Map(solved);
  for (const variable of unsolved) {
    each.set(variable, errorType);
  }
  return substitute(type, each, reading.fitting);
}

/**
 * Whether `target` takes a struct literal of shape `shape` (§3.1): a struct, not a shape, whose
 * fields as a shape the literal's fit, those it leaves out having defaults.
 */
export function takesShape(target: Type, shape: Type, fitting: Fitting): boolean {
  const fields = shapeTaking(target, shape, fitting);
  return fields !== undefined && fitOf(shape, fields, fitting) !== undefined;
}

/**
 * The fields of `target`, a struct, a literal of `shape` must give, as a shape: those it gives, and
 * those without a default (§3.1); undefined for a target that is no struct.
 */
export function shapeTaking(target: Type, shape: Type, fitting: Fitting): Type | undefined {
  const fields = target.kind === 'nominal' ? fitting.shapeOf(target) : undefined;
  if (shape.kind !== 'anonymous' || fields?.kind !== 'anonymous') {
    return undefined;
  }
  const given = new Set(shape.fields.map(({ name }) => name));
  const taken = fields.fields.filter((field) => given.has(field.name) || !declaresDefault(field));
  return { ...fields, fields: taken };
}

/** The variables of the system `type` mentions that aren't taken as found yet. */
export function openIn(type: Type, reading: SystemReading): readonly ParameterKey[] {
  return parametersIn(type).filter(
    (key) => reading.isVariable(key) && reading.fixedOf(key) === undefined,
  );
}

/**
 * Whether checking a value of `inputs` waits on what judging values of `given` bounds: both reach,
 * through bounds and relations (`reachedFrom`), a variable still open, so what those values turn
 * out to be still bounds what `inputs` are. A bound is read one way, from the variable it bounds,
 * so `T` of `T >= Box<U>` reaches `U` but not the other way: hence reach from both. A fixed
 * variable passes nothing on.
 */
export function waitsOn(inputs: Type, given: readonly Type[], reading: SystemReading): boolean {
  const isOpen = (variable: ParameterKey) => reading.fixedOf(variable) === undefined;
  const waiting = new Set([...reachedFrom([inputs], reading, isOpen)].filter(isOpen));
  if (waiting.size === 0) {
    return false;
  }
  for (const variable of reachedFrom(given, reading, isOpen)) {
    if (waiting.has(variable)) {
      return true;
    }
  }
  return false;
}

/**
 * What only a default decides of the variables `type` reaches (`reachedFrom`): each one not fixed,
 * bounded by nothing and related to nothing, by the default it settles to (settle.ts rule 5), as
 * `settlingOf` says; nothing a call could choose by until the scope settles.
 */
export function defaultsIn(
  type: Type,
  reading: SystemReading,
  settlingOf: (variable: ParameterKey) => Settling,
): ReadonlyMap<ParameterKey, Type> {
  const fixed = fixedSubstitution(reading, reading.variables());
  const defaults = new Map<ParameterKey, Type>();
  for (const variable of reachedFrom([type], reading)) {
    const { below, above } = reading.relatedOf(variable);
    const isFree =
      !hasBounds(reading.boundsOf(variable)) &&
      below.length === 0 &&
      above.length === 0 &&
      reading.fixedOf(variable) === undefined;
    const fallback = isFree ? settlingOf(variable).defaultOf(variable, fixed) : undefined;
    if (fallback !== undefined) {
      defaults.set(variable, fallback);
    }
  }
  return defaults;
}

/** `type` with each variable taken as found (`fixedOf`) in place, the rest left. */
export function fixedIn(type: Type, reading: SystemReading): Type {
  const fixed = new Map<ParameterKey, Type>();
  for (const variable of parametersIn(type)) {
    const found = reading.isVariable(variable) ? reading.fixedOf(variable) : undefined;
    if (found !== undefined) {
      fixed.set(variable, found);
    }
  }
  return fixed.size === 0 ? type : substitute(type, fixed, reading.fitting);
}

/**
 * What is expected of `variable` so far (i2-scope.md §3): the error type where it met it, as a
 * placeholder an unmade call abandoned did; what it is taken as, else its equality, else an upper
 * bound, the arguments' first; else what a variable it is related to from below is expected to
 * be, or, with `siblings`, holds: what the siblings bounding that one give.
 */
export function expectationOf(
  variable: ParameterKey,
  reading: SystemReading,
  siblings = true,
  seen = new Set<ParameterKey>(),
): Type | undefined {
  if (seen.has(variable)) {
    return undefined;
  }
  if (reading.fallbackOf(variable)?.kind === 'error') {
    return errorType;
  }
  seen.add(variable);
  const { equal, upper } = reading.boundsOf(variable);
  const bound = equal ?? upper.find((each) => !isAdvice(each)) ?? upper.find(isAdvice);
  const found = reading.fixedOf(variable) ?? bound?.type;
  if (found !== undefined) {
    return found;
  }
  for (const above of reading.relatedOf(variable).above) {
    const told =
      expectationOf(above, reading, siblings, seen) ??
      (siblings ? tentativeOf(above, reading) : undefined);
    if (told !== undefined) {
      return told;
    }
  }
  return undefined;
}

/** What has been found so far for `variables`, as a substitution: the types given, else tentative. */
export function tentativeSubstitution(
  reading: SystemReading,
  variables: Iterable<ParameterKey>,
): Substitution {
  const found = new Map<ParameterKey, Type>();
  for (const variable of variables) {
    const type = reading.givenOf(variable) ?? tentativeOf(variable, reading);
    if (type !== undefined) {
      found.set(variable, type);
    }
  }
  return found;
}

/**
 * What settling `variable` waits on, not fixed yet, as settling them all would order them (settle.ts
 * `waitedOn`).
 */
export function settledBefore(
  variable: ParameterKey,
  reading: SystemReading,
): readonly ParameterKey[] {
  return waitedOn(variable, reading).filter(
    (other) => reading.isVariable(other) && reading.fixedOf(other) === undefined,
  );
}

/** What is taken as found of `variables` so far, given or fixed (`fixedOf`), as a substitution. */
export function fixedSubstitution(
  reading: SystemReading,
  variables: Iterable<ParameterKey>,
): Substitution {
  const found = new Map<ParameterKey, Type>();
  for (const variable of variables) {
    const type = reading.fixedOf(variable);
    if (type !== undefined) {
      found.set(variable, type);
    }
  }
  return found;
}

/** What settling reads of a system (settle.ts), `atTop` its variables at the top of the result. */
export function settlingViewOf(
  reading: SystemReading,
  atTop: ReadonlySet<ParameterKey>,
): SettlingView {
  const { fitting } = reading;
  return {
    rules: fitting,
    boundsOf: reading.boundsOf,
    isAtTop: (parameter) => atTop.has(parameter),
    callOf: reading.callOf,
    fits: (found, expected) => fitOf(found, expected, fitting) !== undefined,
    qualifierOf: fitting.qualifierOf,
    takesShape: (target, shape) => takesShape(target, shape, fitting),
    join: reading.join,
    fallbackOf: reading.fallbackOf,
    relatedOf: reading.relatedOf,
  };
}

/** The variables of the system standing at the top of `result`: it itself, or a member of it. */
export function atTopOf(result: Type, reading: SystemReading): ReadonlySet<ParameterKey> {
  return new Set(
    membersOf(result).flatMap((member) =>
      member.kind === 'parameter' && reading.isVariable(member.declaration)
        ? [member.declaration]
        : [],
    ),
  );
}

/** What `solved` settled each of `variables` to, those it couldn't left out. */
export function settledAmong(
  solved: ReadonlyMap<ParameterKey, Type>,
  variables: readonly ParameterKey[],
): ReadonlyMap<ParameterKey, Type> {
  return new Map(
    variables.flatMap((variable) => {
      const type = solved.get(variable);
      return type === undefined ? [] : [[variable, type] as const];
    }),
  );
}
