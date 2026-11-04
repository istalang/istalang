/**
 * The JSON form model (§9; docs/arch/boundary.md): how the compiler derives the codecs of a type
 * that declares none of its own, which the checker decides (rules/json-forms/) and lowering writes
 * the derived codecs from, and what later phases may ask of codecs. It holds no decisions beyond
 * which trait means which direction, so the checker's surface (check.ts) and lowering depend on it
 * without depending on how codecs are found.
 */

import {
  type CodecHelper,
  type WellKnownDeclaration,
  wellKnown,
} from '../../language/well-known.ts';
import type { FunctionCall, ResolvedCall } from './resolved-call.ts';
import type { Type } from './types/type.ts';
import type { UseSite } from './use-site.ts';

/** Which way a value crosses as JSON (§9): written to it, or read from it. */
export type JsonDirection = 'write' | 'read';

/** The trait of each direction (§3.10), whose one function is the codec. */
export const jsonTraits = {
  write: wellKnown.encodable,
  read: wellKnown.decodable,
} as const satisfies Record<JsonDirection, WellKnownDeclaration>;

/** A field of a struct or variant as its derived codecs write and read it (§9). */
export interface JsonField {
  readonly name: string;
  /** Its name in JSON: its own, or its `@JsonName` (§3.16). */
  readonly key: string;
  readonly type: Type;
  /**
   * `@JsonSkip`: never written, read back as what this call gives, its type's `default()`;
   * undefined for a field that crosses.
   */
  readonly skipped: ResolvedCall | undefined;
  /** Whether its type is optional, so JSON lacking it reads as `none` rather than failing. */
  readonly optional: boolean;
  /** `@JsonBigInt`: the field's own codecs, in place of its type's. */
  readonly codec: Readonly<Record<JsonDirection, FunctionCall>> | undefined;
}

/**
 * The key naming an enum value's variant in its JSON object (§9), which the json module's helpers
 * are given, so no field of a variant may take it.
 */
export const variantTagKey = 'type';

interface JsonVariant {
  readonly name: string;
  readonly fields: readonly JsonField[];
}

/**
 * What the compiler derives a type's codecs from. What a struct, an enum or a tuple holds crosses
 * through its own codecs, found as every witness is (§3.10).
 */
export type DerivedForm =
  | { readonly kind: 'record'; readonly fields: readonly JsonField[] }
  | { readonly kind: 'enum'; readonly variants: readonly JsonVariant[] }
  | { readonly kind: 'tuple'; readonly elements: readonly Type[] }
  /** A host type: whatever JSON its host gave it, handed back unchanged (§9). */
  | { readonly kind: 'host' }
  /** Nothing to derive from; `reason` finishes "it needs …" when there is more to say. */
  | { readonly kind: 'none'; readonly reason: string | undefined };

/** What later phases ask of codecs: a derived form, a type's codec, a json-module helper call. */
export interface JsonFormQueries {
  readonly formOf: (type: Type) => DerivedForm;
  /**
   * The codec writing or reading `type`, which may name type parameters, then met by their
   * constraints; undefined when it has none. A disposable host type has one, to cross to its own
   * host, though it isn't Encodable or Decodable.
   */
  readonly codecOf: (type: Type, direction: JsonDirection) => ResolvedCall | undefined;
  /** The call to the json module's helper `name` with `typeArguments`. */
  readonly callOf: (name: CodecHelper, typeArguments: readonly Type[]) => FunctionCall;
}

/**
 * The codec the compiler derives for a type, or what the type lacks to have one: what its form
 * says, or else, with nothing to say, the codec declared for it (undefined).
 */
export type DerivedCodec =
  | { readonly kind: 'derived'; readonly call: FunctionCall }
  | { readonly kind: 'lacking'; readonly missing: string | undefined };

/** What meeting `Encodable` and `Decodable` asks, beside what later phases do. */
export interface JsonCodecs extends JsonFormQueries {
  /** Why `type` has no codec at all: a nested optional, whose two nones JSON can't tell apart. */
  readonly refusalOf: (type: Type) => string | undefined;
  /** The codec derived for `type` where `site` meets the trait, found for no declared one. */
  readonly derivedOf: (site: UseSite, type: Type, direction: JsonDirection) => DerivedCodec;
}
