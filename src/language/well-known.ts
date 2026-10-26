/**
 * What the toolchain knows by name (§2, §3.8, §3.13, §9): the std modules the language itself refers
 * to by role, the declarations in them it treats specially, and the functions every program and
 * every disposable type are expected to name. Each name is spelled here once, for the compiler, the
 * Definition, the runtime and the std modules alike.
 */

/**
 * The std modules a program is handed by role: the prelude every module sees without importing it
 * (§3.13), `time`, whose `Duration` types every duration literal (§2), and `json`, whose codecs
 * every value crossing to a host goes through (§9).
 */
export const languageModules = { prelude: 'prelude', time: 'time', json: 'json' } as const;

/** A role, which is also the name of the std module that plays it. */
export type LanguageModule = keyof typeof languageModules;

/** A declaration of a language module the toolchain treats specially. */
export interface WellKnownDeclaration {
  readonly module: LanguageModule;
  readonly name: string;
}

export const wellKnown = {
  /** What an async call returns and `await` waits on (§3.3, §6). */
  future: { module: 'prelude', name: 'Future' },
  /** What `T?` stands for (§3.11). */
  optional: { module: 'prelude', name: 'Optional' },
  /** The runtime's one primitive for sharing values between executions, run by natives (§6). */
  slot: { module: 'prelude', name: 'Slot' },
  /** The cell a captured or referenced variable lives in (§3.7, §3.8). */
  shared: { module: 'prelude', name: 'Shared' },
  /** What a function that can fail returns, and what `?` takes apart (§3.12). */
  result: { module: 'prelude', name: 'Result' },
  /** What `Err` carries by default, whose `trace` the runtime fills in (§3.12). */
  error: { module: 'prelude', name: 'Error' },
  /** What a duration literal is (§2). */
  duration: { module: 'time', name: 'Duration' },
  /** A point in time, which the host boundary writes as ISO 8601 (§9). */
  time: { module: 'time', name: 'Time' },
  /** The marker trait of values that may leave an instance, derived rather than declared (§3.1). */
  sendable: { module: 'prelude', name: 'Sendable' },
  /** What an array literal or a comprehension builds, and what `iterate` gives (§2, §3.10). */
  array: { module: 'prelude', name: 'Array' },
  /** What a map literal builds when no other type is expected (§2). */
  map: { module: 'prelude', name: 'Map' },
  /** What `a..b` builds (§3.8). */
  range: { module: 'prelude', name: 'Range' },
  /** A weak reference to a disposable (§7). */
  weakRef: { module: 'prelude', name: 'WeakRef' },
  /** The handle of an async call that `worker.disposing()` watches, private to the prelude (§7). */
  call: { module: 'prelude', name: '_Call' },
  /** A type with a value to start from (§3.10): a map literal's, and a skipped JSON field's (§9). */
  default: { module: 'prelude', name: 'Default' },
  /** How a type is written as text, and read back (§3.10): map keys in JSON (§9). */
  stringable: { module: 'prelude', name: 'Stringable' },
  parsable: { module: 'prelude', name: 'Parsable' },
  /** Names an `await` or `select` statement's suspension point (§10). */
  waypoint: { module: 'prelude', name: 'Waypoint' },
  /** JSON as a value: what the codecs turn typed values into and back from (§9). */
  json: { module: 'json', name: 'Json' },
  /** The traits of types that cross as JSON, written and read (§3.10, §9), each implying Sendable. */
  encodable: { module: 'json', name: 'Encodable' },
  decodable: { module: 'json', name: 'Decodable' },
  /** Annotations the boundary mapping reads on fields (§3.16, §9). */
  jsonName: { module: 'json', name: 'JsonName' },
  jsonSkip: { module: 'json', name: 'JsonSkip' },
  jsonBigInt: { module: 'json', name: 'JsonBigInt' },
} as const satisfies Record<string, WellKnownDeclaration>;

/** The functions `Encodable` and `Decodable` require (§3.10): a type's codecs, by direction. */
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
  elements: '_elements',
  element: '_element',
  elementPath: '_elementPath',
  hostResult: '_hostResult',
  hostInput: '_hostInput',
  hostHandle: '_hostHandle',
} as const;

export type CodecHelper = (typeof codecHelpers)[keyof typeof codecHelpers];

/** A json-module function the compiler calls: a derived codec or a helper. */
export type CodecName = (typeof derivedCodecs)[keyof typeof derivedCodecs] | CodecHelper;

/** A well-known declaration's module-qualified name, as a Definition spells it: `prelude.Shared`. */
export function qualifiedName({ module, name }: WellKnownDeclaration): string {
  return `${module}.${name}`;
}

/** The function `Disposable` requires (§3.10, §7). */
export const disposeFunction = 'dispose';

/** The variants of `Optional` (§3.11): what a value is wrapped in, and what `none` is. */
export const optionalVariants = { some: 'Some', none: 'None' } as const;

/** The variants of `Result` (§3.12): `?` passes on an `Err` and takes the `Ok` value. */
export const resultVariants = { ok: 'Ok', err: 'Err' } as const;

/**
 * `Error`'s field the runtime fills in when an `Error` is built without it (§3.12), and the
 * prelude's private extern that writes it: the current frames, innermost first.
 */
export const errorTrace = { field: 'trace', function: '_trace' } as const;

/** The static function a conversion `T(x)` calls (§3.10). */
export const conversionFunction = 'from';

/** The functions `x$` and `x$ = v` call (§3.9). */
export const unwrapFunction = 'unwrap';
export const rewrapFunction = 'rewrap';

/**
 * The functions collections go through (§3.9, §3.10): `x[k]`, `x[k] = v`, `for` and spreads, and
 * the static function a map literal of a type other than `Map` starts from (§2). Looping over the
 * array `iterate` gives reads its `length` and each element by `index`.
 */
export const collectionFunctions = {
  index: 'index',
  setIndex: 'setIndex',
  iterate: 'iterate',
  length: 'length',
  default: 'default',
} as const;

/** The function every program starts from (§9). */
export const entryFunction = 'main';
