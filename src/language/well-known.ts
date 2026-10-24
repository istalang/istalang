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
  /** What a duration literal is (§2). */
  duration: { module: 'time', name: 'Duration' },
  /** A point in time, which the host boundary writes as ISO 8601 (§9). */
  time: { module: 'time', name: 'Time' },
} as const satisfies Record<string, WellKnownDeclaration>;

/** A well-known declaration's module-qualified name, as a Definition spells it: `prelude.Shared`. */
export function qualifiedName({ module, name }: WellKnownDeclaration): string {
  return `${module}.${name}`;
}

/** The function `Disposable` requires (§3.10, §7). */
export const disposeFunction = 'dispose';

/** The function every program starts from (§9). */
export const entryFunction = 'main';
