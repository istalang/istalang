/**
 * Function types (§3.14) and the packs they end in (§3.5): built by one constructor, compared by
 * one relation. The types themselves are type/index.ts's.
 *
 * - `functionType` is the only way a function type is built, written, inferred or substituted
 *   alike, so its pack is flattened wherever a tuple fills it: into parameters by value, `Unit`
 *   into none.
 * - A function type keeps its head's reach as the head writes it (syntax/tokens/modifiers.ts), so
 *   type text and keys print it in the head's one order, with nothing converting between the two.
 * - An async head is no part of the type (§3.14): `async fn(A) -> R` is `fn(A) -> Future<R>`,
 *   which a head's call gives (`headResult`), so the two spellings are one type, one key and one
 *   text, and a function returning a future is an async one wherever its type is all that's known.
 * - A function fits where another is expected when its reach fits, by their order (`reachFits`),
 *   and it takes and gives what that one does, a declared pack taking whatever parameters are left
 *   (`functionFits`). Where a future is expected of it, the value it gives may go into that
 *   future's (`resultFitOf`): a plain function's call then gives a future already resolved.
 */

import type { FunctionQualifiers } from '../../../syntax/tokens/modifiers.ts';
import type {
  FunctionType,
  ParameterSlot,
  Type,
  TypeParameterType,
  WrittenThrough,
} from './index.ts';
import { errorType, tupleElements, tupleType } from './primitives.ts';

/** What a function's values may capture (§3.14): only sendable values, or, undefined, any. */
export type Reach = FunctionQualifiers['reach'];

/** Whether a function of reach `given` fits where one of `expected` is: a sendable one anywhere. */
function reachFits(given: Reach, expected: Reach): boolean {
  return given === expected || expected === undefined;
}

/** What `functionType` builds a function type of; its pack may be any type bound to one. */
export interface FunctionParts extends WrittenThrough {
  readonly reach: Reach;
  readonly parameters: readonly ParameterSlot[];
  readonly pack?: Type | undefined;
  readonly result: Type;
}

/**
 * The function type of `parts`, ending in its pack: a pack it keeps, a tuple it flattens into
 * parameters by value, `Unit` into none (§3.5); anything else was refused where it was bound to a
 * pack, so it leaves the error type.
 */
export function functionType({ pack, ...parts }: FunctionParts): FunctionType {
  return { kind: 'function', ...parts, ...packed(parts.parameters, pack) } as FunctionType;
}

/** The parameters and pack of a function type taking `parameters`, then `pack`. */
function packed(
  parameters: readonly ParameterSlot[],
  pack: Type | undefined,
): Pick<FunctionType, 'parameters' | 'pack'> {
  if (pack === undefined || isPack(pack) || pack.kind === 'error') {
    return { parameters, pack };
  }
  const elements = tupleElements(pack);
  if (elements === undefined) {
    return { parameters, pack: errorType };
  }
  const flattened = elements.map((element) => ({ type: element, reference: false }));
  return { parameters: [...parameters, ...flattened], pack: undefined };
}

/** A rest parameter: an array's (§3.3), whose arguments are its `item`s, or a pack's (§3.5). */
export type RestSlot = { readonly kind: 'array'; readonly item: Type } | { readonly kind: 'pack' };

/** The rest slot of a parameter or function type ending in a pack (§3.5). */
export const packRestSlot: RestSlot = { kind: 'pack' };

/** Whether `type` is a pack, a type parameter standing for a tuple of types (§3.5). */
export function isPack(type: Type): type is TypeParameterType {
  return (
    type.kind === 'parameter' &&
    type.declaration.kind === 'TypeParameter' &&
    type.declaration.isPack
  );
}

/** Whether `type` can stand for a pack: a tuple, `Unit` (the empty tuple), or a pack (§3.5). */
export function fillsPack(type: Type): boolean {
  return type.kind === 'error' || isPack(type) || tupleElements(type) !== undefined;
}

/**
 * How two function types' parameters are compared: the declared one's type and the given one's at
 * a position, and whether both take it by `&`, which they do alike or don't compare.
 */
type ParameterRelation = (declared: Type, given: Type, byReference: boolean) => boolean;

/**
 * Whether two function types take the same parameters, each by value or by `&` alike, and give the
 * same result, their types compared by `parts`: exactly (`sameType`), or as inference matches a
 * declared type against a given one. Whether each is sendable is the caller's to compare.
 * A declared pack takes the given type's parameters past the declared ones, as their tuple, or the
 * given type's own pack when none are left (§3.5).
 */
export function sameShape(
  declared: FunctionType,
  given: FunctionType,
  parts: ParameterRelation,
  results: (declared: Type, given: Type) => boolean = (declaredResult, givenResult) =>
    parts(declaredResult, givenResult, false),
): boolean {
  const fixed = declared.parameters.length;
  const samePrefix =
    given.parameters.length >= fixed &&
    declared.parameters.every((parameter, index) => {
      const other = given.parameters[index];
      return (
        other !== undefined &&
        parameter.reference === other.reference &&
        parts(parameter.type, other.type, parameter.reference)
      );
    });
  if (!samePrefix) {
    return false;
  }
  if (declared.pack === undefined) {
    return (
      given.parameters.length === fixed &&
      given.pack === undefined &&
      results(declared.result, given.result)
    );
  }
  const rest = restOf(given, fixed);
  return (
    rest !== undefined &&
    parts(declared.pack, rest, false) &&
    results(declared.result, given.result)
  );
}

/**
 * `type`'s parameters from `start` on as one pack: its own pack when none are left, otherwise the
 * tuple of those, `Unit` of none; undefined when they can't be one, since one takes a `&`.
 */
function restOf(type: FunctionType, start: number): Type | undefined {
  const rest = type.parameters.slice(start);
  if (type.pack !== undefined) {
    return rest.length === 0 ? type.pack : undefined;
  }
  return rest.some((slot) => slot.reference) ? undefined : tupleType(rest.map((slot) => slot.type));
}

/**
 * Whether a function of type `given` fits where `declared` is expected: its reach fitting
 * (§3.14), and of the same shape (`sameShape`), its parts and results compared as the caller says.
 */
export function functionFits(
  declared: FunctionType,
  given: FunctionType,
  parts: ParameterRelation,
  results: (declared: Type, given: Type) => boolean = (declaredResult, givenResult) =>
    parts(declaredResult, givenResult, false),
): boolean {
  return reachFits(given.reach, declared.reach) && sameShape(declared, given, parts, results);
}

/** What relating a function's result to a future needs of the program: the futures it has. */
export interface Futures {
  /** `Future<T>` of `value`, what calling an async function gives (§3.14). */
  readonly futureOf: (value: Type) => Type;
  /** `T` when `type` is `Future<T>`; undefined for any other type. */
  readonly futureValue: (type: Type) => Type | undefined;
}

/**
 * How a function's result fits where another's is expected (§3.14): as a value, or, where a
 * future is expected, the `value` it gives into that future's (`into`), made a future already
 * resolved where it gives none (`resolved`), awaited from the one it gives (`awaited`).
 */
export type ResultFit =
  | { readonly kind: 'value' }
  | { readonly kind: 'resolved' | 'awaited'; readonly value: Type; readonly into: Type };

/**
 * How a function's result `given` fits where `expected` is, as `fits` fits values without leaving
 * anything behind when it doesn't (`ResultFit`): `Int` and `Future<Int>` where `Future<Int?>` is
 * expected. Undefined where it doesn't fit. A result that is no future goes into the value of a
 * future expected before it is tried as it is, which only `Never` or a variable could be: what
 * is inferred of the future's value is what it gives.
 */
export function resultFitOf(
  given: Type,
  expected: Type,
  fits: (given: Type, expected: Type) => boolean,
  { futureValue }: Pick<Futures, 'futureValue'>,
): ResultFit | undefined {
  const into = futureValue(expected);
  const awaited = futureValue(given);
  if (into !== undefined && awaited === undefined && fits(given, into)) {
    return { kind: 'resolved', value: given, into };
  }
  if (fits(given, expected)) {
    return { kind: 'value' };
  }
  return into !== undefined && awaited !== undefined && fits(awaited, into)
    ? { kind: 'awaited', value: awaited, into }
    : undefined;
}

/**
 * What calling a function of `head` gives, where its body gives `value`: an async head's call a
 * future of it (§3.14), a plain one's the value.
 */
export function headResult(
  { futureOf }: Pick<Futures, 'futureOf'>,
  head: FunctionQualifiers,
  value: Type,
): Type {
  return head.kind === undefined ? value : futureOf(value);
}
