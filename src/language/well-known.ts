/**
 * What the toolchain knows by name (§2, §3.8, §3.13, §9): the std modules the language itself refers
 * to by role, the declarations in them it treats specially, and the functions every program and
 * every disposable type are expected to name. Each name is spelled here once, for the compiler, the
 * Definition, the runtime and the std modules alike.
 */

/**
 * The std modules a program is handed by role: the prelude every module sees without importing it
 * (§3.13), `time`, whose `Duration` types every duration literal (§2), `json`, whose codecs every
 * value crossing to a host goes through (§9), and `testing`, which only test modules may import
 * and whose suites `ista test` runs (§10).
 */
export const languageModules = {
  prelude: 'prelude',
  time: 'time',
  json: 'json',
  testing: 'testing',
} as const;

/** A role, which is also the name of the std module that plays it. */
export type LanguageModule = keyof typeof languageModules;

/**
 * The scheme of a std module's id, `std:<name>`. No file can have it, so a std module is never
 * confused with a project file; an editor shows one by asking the language server for its text.
 */
export const stdScheme = 'std';

/** A declaration of a language module the toolchain treats specially. */
export interface WellKnownDeclaration {
  readonly module: LanguageModule;
  readonly name: string;
}

export const wellKnown = {
  /** What an async call returns and `await` waits on (§3.3, §6). */
  future: { module: 'prelude', name: 'Future' },
  /** What `spawn` gives: a handle to the new instance, whose end `result()` waits for (§9). */
  instance: { module: 'prelude', name: 'Instance' },
  /** What `T?` stands for (§3.11). */
  optional: { module: 'prelude', name: 'Optional' },
  /** The runtime's one primitive for sharing values between executions, run by natives (§6). */
  slot: { module: 'prelude', name: 'Slot' },
  /** The cell a captured or referenced variable lives in (§3.7, §3.14). */
  cell: { module: 'prelude', name: '_Cell' },
  /** What a function that can fail returns, and what `?` takes apart (§3.12). */
  result: { module: 'prelude', name: 'Result' },
  /** What a cursor gives each call: the next item, or the end (§3.10). */
  step: { module: 'prelude', name: 'Step' },
  /** What a duration literal is (§2). */
  duration: { module: 'time', name: 'Duration' },
  /** A point in time, which the host boundary writes as ISO 8601 (§9). */
  time: { module: 'time', name: 'Time' },
  /** The marker trait of values that may leave an instance, derived rather than declared (§3.1). */
  sendable: { module: 'prelude', name: 'Sendable' },
  /** What an array literal or a comprehension builds (§2, §3.10). */
  array: { module: 'prelude', name: 'Array' },
  /** What a map literal builds when no other type is expected (§2). */
  map: { module: 'prelude', name: 'Map' },
  /** What `a..b` builds (§3.8). */
  range: { module: 'prelude', name: 'Range' },
  /** A weak reference to a disposable (§7). */
  weakRef: { module: 'prelude', name: 'WeakRef' },
  /** The handle of an async call that `worker.disposing()` watches, private to the prelude (§7). */
  call: { module: 'prelude', name: '_Call' },
  /** The future a call's disposal resolves, whose `select` case is the call's cleanup (§7). */
  disposing: { module: 'prelude', name: 'disposing' },
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
  /** The annotation of a function returning a suite's tests (§10). */
  suite: { module: 'testing', name: 'Suite' },
  /** What a suite function returns a list of (§10). */
  test: { module: 'testing', name: 'Test' },
} as const satisfies Record<string, WellKnownDeclaration>;

/**
 * The testing module's functions the toolchain calls or checks (§10): the runner's listing and
 * running of a suite's tests, `mock`, whose target must name a function, and `handle`, whose type
 * must be an extern type.
 */
export const testingFunctions = {
  list: '_list',
  run: '_run',
  mock: 'mock',
  handle: 'handle',
} as const;

/** What a test module's file name ends with (§10). */
export const testModuleSuffix = '.test.ista';

/** Whether the file at `path` holds a test module (§10), by its name. */
export function isTestModulePath(path: string): boolean {
  return path.endsWith(testModuleSuffix);
}

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
  notAmong: '_notAmong',
  elements: '_elements',
  element: '_element',
  elementPath: '_elementPath',
  hostResult: '_hostResult',
  hostInput: '_hostInput',
} as const;

export type CodecHelper = (typeof codecHelpers)[keyof typeof codecHelpers];

/** A json-module function the compiler calls: a derived codec or a helper. */
export type CodecName = (typeof derivedCodecs)[keyof typeof derivedCodecs] | CodecHelper;

/** A declaration's module-qualified name, as a Definition spells it: `prelude.Future`. */
export function qualifiedName({
  module,
  name,
}: {
  readonly module: string;
  readonly name: string;
}): string {
  return `${module}.${name}`;
}

/** The function `Disposable` requires (§3.10, §7). */
export const disposeFunction = 'dispose';

/**
 * How a union's enum lays out its values (§2, lowering/type-table.ts): a variant per member, named
 * as the member is spelled, so `none`'s is `None`, holding a member's value in its one field.
 */
export const unionLayout = { noneVariant: 'None', valueField: 'value' } as const;

/** The variants of `json.Json` (§9): JSON held as a value, by its kind. */
export const jsonVariants = {
  null: 'Null',
  boolean: 'Boolean',
  integer: 'Integer',
  number: 'Number',
  text: 'Text',
  list: 'List',
  object: 'Object',
} as const;

/** The variants of `Result` (§3.12): `?` passes on an `Err` and takes the `Ok` value. */
export const resultVariants = { ok: 'Ok', err: 'Err' } as const;

/** The one field of each of `Result`'s variants (§3.12): `Ok`'s value and `Err`'s error. */
export const resultFields = { ok: 'value', err: 'error' } as const;

/** The variants of `Step` (§3.10): a loop runs its body on a `Next`'s one field, and ends on `Done`. */
export const stepVariants = { next: 'Next', done: 'Done' } as const;

/** The static function a conversion `T(x)` calls (§3.10). */
export const conversionFunction = 'from';

/** The functions collections go through (§3.9, §3.10): `x[k]`, `x[k] = v`, `for` and spreads. */
export const collectionFunctions = {
  index: 'index',
  setIndex: 'setIndex',
  iterate: 'iterate',
} as const;

/**
 * The functions an untagged template calls (§2): each value's `toString`, found as an operator's
 * function is, and the prelude's `join` of its texts and values.
 */
export const templateFunctions = {
  toString: 'toString',
  join: 'join',
} as const;

/** The function every program starts from (§9). */
export const entryFunction = 'main';

/** What a method's first parameter is named, which makes it one (§3.7). */
export const receiverParameter = 'self';

/** What a trait calls the type meeting it (§3.10). */
export const selfType = 'Self';

/** The end `..=` stores, one past the written end in the step's direction (§3.8). */
export const inclusiveEndFunction = '_inclusiveEnd';

/** What `x!` calls on none (§4), and what a program calls to panic (§3.12). */
export const panicFunction = 'panic';

/**
 * What an array pattern calls in the prelude once its length test passed (§3.11): its length, an
 * item counted from the start or, when negative, from the end, and the items between.
 */
export const arrayPatternFunctions = {
  length: 'length',
  item: '_patternItem',
  rest: '_patternRest',
} as const;
