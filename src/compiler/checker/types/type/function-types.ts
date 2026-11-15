/**
 * Function types (§3.14) and the packs they end in (§3.5): built by one constructor, compared by
 * one relation. The types themselves are type/index.ts's.
 *
 * - `functionType` is the only way a function type is built, written, inferred or substituted
 *   alike, so its pack is flattened wherever a tuple fills it: into parameters by value, `Unit`
 *   into none.
 * - A function type is `Fn<Args, Result, Kind, Send>` (proposal 8, Rule 4), whatever spelling wrote
 *   it: its mark and sendability are type slots, each a `Mark` or `Sendability` member or a
 *   variable, `"simple"` and `"plain"` where its head writes none (`sendOf`), and its text and key
 *   print the head's words for them (`modifiersOf`).
 * - An async head is no part of the type (§3.14): `async fn(A) -> R` is `fn(A) -> Future<R>`,
 *   which a head's call gives (`headResult`), so the two spellings are one type, one key and one
 *   text, and a function returning a future is an async one wherever its type is all that's known.
 * - A function fits where another is expected when its sendability fits, by `Sendability`'s order
 *   (`sendFits`), its mark fits as the caller says (`marks`), and it takes
 *   and gives what that one does, a declared pack taking whatever parameters are left
 *   (`functionFits`). Where a future is expected of it, the value it gives may go into that
 *   future's (`resultFitOf`): a plain function's call then gives a future already resolved.
 */

import {
  type Sendability,
  sendabilities,
} from '../../../../foundation/language/well-known/index.ts';
import {
  awaits,
  type FunctionQualifiers,
  type Modifiers,
} from '../../../syntax/tokens/modifiers.ts';
import { persistenceOf } from './function-kinds.ts';
import type {
  FunctionType,
  ParameterSlot,
  Type,
  TypeParameterType,
  WrittenThrough,
} from './index.ts';
import { sendabilityOrder } from './mark-orders.ts';
import { errorType, sendType, tupleElements, tupleType } from './primitives.ts';

export const plainSend: Type = sendType('plain');

export const inertSend: Type = sendType('inert');

export const sendableSend: Type = sendType('sendable');

/** The `Send` slot a head's `qualifiers` write: the member they name, or `plain` for none. */
export function sendOf(qualifiers: FunctionQualifiers): Type {
  return qualifiers.send === undefined ? plainSend : sendType(qualifiers.send);
}

/** Which sendability the `Send` slot `send` holds; undefined for a variable. */
function sendabilityOf(send: Type): Sendability | undefined {
  return sendabilities.find((each) => send.kind === 'literal' && send.value === each);
}

/** Whether values of the function type `type` capture only sendable values (§3.14). */
export function isSendableFunction(type: FunctionType): boolean {
  return sendabilityOf(type.send) === 'sendable';
}

/**
 * The modifiers a head of `type` writes, which its text and key print: its sendability unless
 * plain, and its mark where it is one of the two kinds; a simple or variable mark, or a variable
 * `Send`, writes none.
 */
export function modifiersOf({ send, mark }: FunctionType): Modifiers {
  const sendability = sendabilityOf(send);
  return {
    send: sendability === 'plain' ? undefined : sendability,
    kind: persistenceOf(mark),
  };
}

/**
 * Whether a function of sendability `given` fits where one of `expected` is, by `Sendability`'s
 * order (mark-orders.ts), the two compared by `same`, which may infer them.
 */
export function sendFits(
  given: Type,
  expected: Type,
  same: (expected: Type, given: Type) => boolean,
): boolean {
  return sendabilityOrder.below(given, expected, same);
}

/** What `functionType` builds a function type of; its pack may be any type bound to one. */
interface FunctionParts extends WrittenThrough {
  readonly send: Type;
  readonly mark: Type;
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

/**
 * The function type `Fn<Args, Result, Kind, Send>` names (§3.14), given its arguments in that
 * order: `Args`, a tuple, gives its parameters, each by value unless `byReference` says its written
 * item is a `&T`; a pack, or anything else, ends it as `functionType` takes a pack.
 */
export function fnType(
  [args = errorType, result = errorType, mark = errorType, send = errorType]: readonly Type[],
  byReference: readonly boolean[],
): FunctionType {
  const items = tupleElements(args);
  return items === undefined
    ? functionType({ mark, send, parameters: [], pack: args, result })
    : functionType({
        mark,
        send,
        parameters: items.map((type, index) => ({ type, reference: byReference[index] === true })),
        result,
      });
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
 * Whether `type` is a function type taking nothing, `fn() -> X`, as the function a deferred call
 * gives is (§3.14); one ending in a pack may take something.
 */
export function takesNothing(type: Type): type is FunctionType {
  return type.kind === 'function' && type.parameters.length === 0 && type.pack === undefined;
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
 * A pack on either side takes the other's parameters past its own fixed ones, as their tuple, or
 * the other's own pack when none are left (§3.5).
 */
function sameShape(
  declared: FunctionType,
  given: FunctionType,
  parts: ParameterRelation,
  results: ((declared: Type, given: Type) => boolean) | undefined = (declaredResult, givenResult) =>
    parts(declaredResult, givenResult, false),
): boolean {
  const packsGiven = declared.pack === undefined && given.pack !== undefined;
  const fixed = (packsGiven ? given : declared).parameters.length;
  const samePrefix =
    Math.min(declared.parameters.length, given.parameters.length) >= fixed &&
    declared.parameters.slice(0, fixed).every((parameter, index) => {
      const other = given.parameters[index];
      return (
        other !== undefined &&
        parameter.reference === other.reference &&
        parts(parameter.type, other.type, parameter.reference)
      );
    });
  return (
    samePrefix && sameRest(declared, given, fixed, parts) && results(declared.result, given.result)
  );
}

/**
 * Whether the parameters past `fixed` match: none on either side, or a pack taking the other side's
 * rest (`restOf`).
 */
function sameRest(
  declared: FunctionType,
  given: FunctionType,
  fixed: number,
  parts: ParameterRelation,
): boolean {
  if (declared.pack === undefined && given.pack === undefined) {
    return declared.parameters.length === fixed && given.parameters.length === fixed;
  }
  const declaredRest = restOf(declared, fixed);
  const givenRest = restOf(given, fixed);
  return (
    declaredRest !== undefined && givenRest !== undefined && parts(declaredRest, givenRest, false)
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

/** How `functionFits` compares two function types' parts, results, marks and sendabilities. */
export interface FunctionRelation {
  readonly parts: ParameterRelation;
  /** How the results compare; as parameters by value do where it's left out. */
  readonly results?: ((declared: Type, given: Type) => boolean) | undefined;
  /**
   * How the given mark relates to the declared one: as code of the declared mark calling the given
   * one (`kindAdmits`), or exactly, where types are compared for identity.
   */
  readonly marks: (declared: Type, given: Type) => boolean;
  /** How the given `Send` relates to the declared one: by its order (`sendFits`), or exactly. */
  readonly sends: (declared: Type, given: Type) => boolean;
}

/**
 * Whether a function of type `given` fits where `declared` is expected: its sendability and mark
 * related as the caller says, since its calls run in the declared one's mark (proposal 8, Rule 4),
 * and of the same shape (`sameShape`), its parts and results compared as the caller says.
 */
export function functionFits(
  declared: FunctionType,
  given: FunctionType,
  { parts, results, marks, sends }: FunctionRelation,
): boolean {
  return (
    sends(declared.send, given.send) &&
    marks(declared.mark, given.mark) &&
    sameShape(declared, given, parts, results)
  );
}

/** What awaiting a value gives (§6): the value it resumes with, and the kind of its wait. */
export interface AwaitedType {
  readonly value: Type;
  /** The kind of code it is awaited in (proposal 8, Rule 5): a `Persistence` member or variable. */
  readonly mode: Type;
}

/** What relating a function's result to a future needs of the program: the futures it has. */
export interface Futures {
  /** `Future<T, K>` of `value`, what calling an async function of kind `mode` gives (§3.14). */
  readonly futureOf: (value: Type, mode: Type) => Type;
  /** What awaiting a value of `type` gives; undefined where it can't be awaited. */
  readonly awaitedOf: (type: Type) => AwaitedType | undefined;
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
  futures: Pick<Futures, 'awaitedOf'>,
): ResultFit | undefined {
  const resolved = resolvedInto(given, expected, futures);
  if (resolved !== undefined && fits(given, resolved)) {
    return { kind: 'resolved', value: given, into: resolved };
  }
  if (fits(given, expected)) {
    return { kind: 'value' };
  }
  const into = futures.awaitedOf(expected);
  const awaited = futures.awaitedOf(given);
  return into !== undefined &&
    awaited !== undefined &&
    sameMode(awaited.mode, into.mode, fits) &&
    fits(awaited.value, into.value)
    ? { kind: 'awaited', value: awaited.value, into: into.value }
    : undefined;
}

/**
 * Whether futures of modes `given` and `expected` wait alike, as `fits` relates them both ways: the
 * kinds never meet (proposal 8, Rule 4), and a kind variable takes the kind it is related to.
 */
function sameMode(
  given: Type,
  expected: Type,
  fits: (given: Type, expected: Type) => boolean,
): boolean {
  return fits(given, expected) && fits(expected, given);
}

/**
 * The value of the future `expected` of a function's result, where what it gives, `given`, is no
 * future: what it goes into, made a future already resolved (§3.14). Undefined where `expected`
 * is no future, or `given` is one, so an async function's result is never made a future of one.
 */
export function resolvedInto(
  given: Type,
  expected: Type,
  { awaitedOf }: Pick<Futures, 'awaitedOf'>,
): Type | undefined {
  return awaitedOf(given)?.value === undefined ? awaitedOf(expected)?.value : undefined;
}

/**
 * `type` made async: a function giving a future of kind `mode` of what `type` gives, already
 * resolved, where it gives no future (`resolvedInto`); undefined where it gives one.
 */
export function madeAsync(
  type: FunctionType,
  futures: Futures,
  mode: Type,
): FunctionType | undefined {
  return futures.awaitedOf(type.result) === undefined
    ? functionType({ ...type, result: futures.futureOf(type.result, mode) })
    : undefined;
}

/**
 * What calling a function of `head` and kind `kind` gives, where its body gives `value`: an async
 * head's call a future of it of that kind (§3.14), a plain one's the value.
 */
export function headResult(
  { futureOf }: Pick<Futures, 'futureOf'>,
  head: FunctionQualifiers,
  kind: Type | (() => Type),
  value: Type,
): Type {
  if (!awaits(head)) {
    return value;
  }
  return futureOf(value, typeof kind === 'function' ? kind() : kind);
}
