/**
 * Function types (§3.14) and the packs they end in (§3.5): a pack substituted by a tuple flattens
 * into parameters, and two function types are compared parameter by parameter, a declared pack
 * taking whatever parameters are left. The types themselves are type.ts's.
 */

import {
  errorType,
  type FunctionType,
  type Type,
  type TypeParameterType,
  tupleElements,
  tupleType,
} from './type.ts';

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
 * `type` ending in `pack`: a pack it keeps, a tuple it flattens into parameters by value, `Unit`
 * into none (§3.5); anything else was refused where it was bound to a pack, so it leaves the error
 * type.
 */
export function withPack(type: FunctionType, pack: Type | undefined): FunctionType {
  if (pack === undefined) {
    return { ...type, pack: undefined };
  }
  if (isPack(pack) || pack.kind === 'error') {
    return { ...type, pack };
  }
  const elements = tupleElements(pack);
  if (elements === undefined) {
    return { ...type, pack: errorType };
  }
  const flattened = elements.map((element) => ({ type: element, reference: false }));
  return { ...type, parameters: [...type.parameters, ...flattened], pack: undefined };
}

/**
 * Whether two function types take the same parameters, each by value or by `&` alike, and give the
 * same result, their types compared by `parts`: exactly (`sameType`), or as inference matches a
 * declared type against a given one. Whether each is sendable or async is the caller's to compare.
 * A declared pack takes the given type's parameters past the declared ones, as their tuple, or the
 * given type's own pack when none are left (§3.5).
 */
export function sameShape(
  declared: FunctionType,
  given: FunctionType,
  parts: (declared: Type, given: Type) => boolean,
  results: (declared: Type, given: Type) => boolean = parts,
): boolean {
  const fixed = declared.parameters.length;
  const samePrefix =
    given.parameters.length >= fixed &&
    declared.parameters.every((parameter, index) => {
      const other = given.parameters[index];
      return (
        other !== undefined &&
        parameter.reference === other.reference &&
        parts(parameter.type, other.type)
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
  return rest !== undefined && parts(declared.pack, rest) && results(declared.result, given.result);
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
 * Whether a function of type `given` fits where `declared` is expected: async alike, sendable
 * where `declared` is (§3.14), and of the same shape (`sameShape`), its parts and results compared
 * as the caller says.
 */
export function functionFits(
  declared: FunctionType,
  given: FunctionType,
  parts: (declared: Type, given: Type) => boolean,
  results: (declared: Type, given: Type) => boolean = parts,
): boolean {
  return (
    given.isAsync === declared.isAsync &&
    (given.isSendable || !declared.isSendable) &&
    sameShape(declared, given, parts, results)
  );
}
