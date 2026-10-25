/**
 * The JSON form model (§9; docs/arch/boundary.md): how a type crosses as JSON, which the checker
 * decides (index.ts) and lowering writes each type's codecs from, and what later phases may ask
 * of the forms. It holds no decisions beyond which marker means which direction, so the checker's
 * surface (check.ts) and lowering depend on it without depending on how forms are decided.
 */

import {
  type CodecHelper,
  type WellKnownDeclaration,
  wellKnown,
} from '../../../../language/well-known.ts';
import type { FunctionCall } from '../../check.ts';
import type { Type } from '../../types/type.ts';

/** Which way a value crosses to the host (§9): written to JSON, or read from it. */
export type JsonDirection = 'write' | 'read';

/** The derived marker of each direction: a type with a JSON form to write, or to read (§3.10). */
export const jsonMarkers = {
  write: wellKnown.encodable,
  read: wellKnown.decodable,
} as const satisfies Record<JsonDirection, WellKnownDeclaration>;

/** What a `@JsonSkip` field reads back as (§9): `none`, `[]` or `[:]`. */
export type EmptyValue = 'none' | 'array' | 'map';

/** The two json-module helper calls of a leaf or a container; `decode` undefined when unreadable. */
export interface Codec {
  readonly encode: FunctionCall;
  readonly decode: FunctionCall | undefined;
}

/** A field of a struct or variant as it crosses as JSON (§9). */
export interface JsonField {
  readonly name: string;
  /** Its name in JSON: its own, or its `@JsonName` (§3.16). */
  readonly key: string;
  readonly type: Type;
  /** `@JsonSkip`: never written, read back as this empty value; undefined for a field that crosses. */
  readonly skipped: EmptyValue | undefined;
  /** Whether its type is optional, so JSON lacking it reads as `none` rather than failing. */
  readonly optional: boolean;
  /** `@JsonBigInt`: the field's own codec, in place of its type's. */
  readonly codec: Codec | undefined;
}

export interface JsonVariant {
  readonly name: string;
  readonly fields: readonly JsonField[];
}

/** How a type crosses as JSON, which lowering writes its codecs from. */
export type JsonForm =
  /** `json.Json`, which is its own JSON. */
  | { readonly kind: 'json' }
  | { readonly kind: 'leaf'; readonly codec: Codec; readonly unreadable: string | undefined }
  /** An array, an optional or a map: a helper given the codec of `element`. */
  | {
      readonly kind: 'container';
      readonly element: Type;
      readonly codec: Codec;
      readonly unreadable: string | undefined;
    }
  | { readonly kind: 'record'; readonly fields: readonly JsonField[] }
  | { readonly kind: 'enum'; readonly variants: readonly JsonVariant[] }
  | { readonly kind: 'tuple'; readonly elements: readonly Type[] }
  /** No form; `reason` finishes "it has no JSON form: …". */
  | { readonly kind: 'none'; readonly reason: string };

/** What later phases ask of JSON forms: a type's form, why it can't cross, a json-module call. */
export interface JsonFormQueries {
  readonly formOf: (type: Type) => JsonForm;
  /** Why `type` can't cross in `direction`, finishing "it has no JSON form: …"; undefined if it can. */
  readonly problemOf: (type: Type, direction: JsonDirection) => string | undefined;
  /** The call to the json module's helper `name` with `typeArguments`. */
  readonly callOf: (name: CodecHelper, typeArguments: readonly Type[]) => FunctionCall;
  /** The call to `_encode<T>` of `type`, which writes it as `Json`. */
  readonly encoderOf: (type: Type) => FunctionCall;
  /** The call to `_decodeAt<T>` of `type`, which reads it from `Json` at a path. */
  readonly decoderOf: (type: Type) => FunctionCall;
}
