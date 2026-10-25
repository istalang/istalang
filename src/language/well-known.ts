/**
 * What the toolchain knows by name (§2, §3.8, §3.13, §9): the std modules the language itself refers
 * to by role, the declarations in them it treats specially, and the functions every program and
 * every disposable type are expected to name. Each name is spelled here once, for the compiler, the
 * Definition, the runtime and the std modules alike.
 */

/**
 * The std modules a program is handed by role: the prelude every module sees without importing it
 * (§3.13), and `time`, whose `Duration` types every duration literal (§2).
 */
export const languageModules = { prelude: 'prelude', time: 'time' } as const;

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
} as const satisfies Record<string, WellKnownDeclaration>;

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
