/**
 * The json module's codecs the compiler knows by name (§8.4, §17.4; docs/arch/boundary.md): the
 * functions `Encodable` and `Decodable` require, the codecs it derives per type, and the helpers
 * those call.
 */

/** The functions `Encodable` and `Decodable` require (§8.4): a type's codecs, by direction. */
export const codecFunctions = { write: 'toJson', read: 'fromJson' } as const;

/**
 * The json module's functions whose bodies the compiler writes per type (docs/arch/boundary.md):
 * the codecs it derives for a struct, an enum, a tuple or a host type declaring none of its own.
 */
export const derivedCodecs = { write: '_toJson', read: '_fromJson' } as const;

/**
 * The json module's helpers derived codecs and wrappers call (docs/arch/boundary.md): writing and
 * reading an `@JsonBigInt` field and a host type's JSON, taking JSON apart, and accepting what a
 * host gave.
 */
export const codecHelpers = {
  encodeBigInt: '_encodeBigInt',
  decodeBigInt: '_decodeBigInt',
  encodeHandle: '_encodeHandle',
  decodeHandle: '_decodeHandle',
  fields: '_fields',
  field: '_field',
  optionalField: '_optionalField',
  fieldPath: '_fieldPath',
  tag: '_tag',
  unknownVariant: '_unknownVariant',
  notAmong: '_notAmong',
  elements: '_elements',
  element: '_element',
  elementPath: '_elementPath',
  hostResult: '_hostResult',
  hostInput: '_hostInput',
} as const;

export type CodecHelper = (typeof codecHelpers)[keyof typeof codecHelpers];

/**
 * The json module's function every value a host gets is written through (docs/arch/boundary.md):
 * it keeps the JSON of a value written before, so the host gets the same object for it again.
 */
export const writeThrough = 'encode';

/** A json-module function the compiler calls: a derived codec, a helper, or `writeThrough`. */
export type CodecName =
  | (typeof derivedCodecs)[keyof typeof derivedCodecs]
  | CodecHelper
  | typeof writeThrough;
