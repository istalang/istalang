/**
 * Loads std modules (§3.8) by their simple names, such as `'time'`.
 *
 * Each std module's `.ista` source is imported into the table below and compiled into the package
 * as text, so loading one never touches a file system and the published package has no files to
 * locate. The table is the one list of std modules, and this module the one home of their names,
 * which their natives are keyed by too. A std module's id is `std:<name>`, a scheme no file can
 * have, so a std module can never be confused with a project file; a name that both this loader
 * and the project's answer is ambiguous (§3.13). Every module it loads is marked as shipped with
 * the toolchain, so its externs need no host.
 *
 * Two std modules the language itself refers to are handed to a program by role: the prelude,
 * which every module sees without importing it and no import names, and `time`, whose `Duration`
 * types every duration literal (§2), loaded with every program but visible only where imported.
 */

import type { LocatedModule, ModuleLoader } from '../compiler/program/program.ts';
import { moduleIdOf } from '../compiler/program/program.ts';
import { type LanguageModule, languageModules } from '../language/well-known.ts';
import preludeSource from './prelude/prelude.ista';
import runtimeSource from './runtime/runtime.ista';
import timeSource from './time/time.ista';

/** The prelude's name, which its declarations and natives are qualified with. */
export const preludeName = languageModules.prelude;

/** The `time` module's name. */
export const timeName = languageModules.time;

/** The `runtime` module's name. */
export const runtimeName = 'runtime';

/** Every std module's source, by name. */
export const stdSources: Readonly<Record<string, string>> = {
  [runtimeName]: runtimeSource,
  [timeName]: timeSource,
};

/** The prelude, as a module for the program to load (§3.13). */
export function preludeModule(): LocatedModule {
  return stdModule(preludeName, preludeSource);
}

/** `time`, as a module for the program to load by role (§2). */
export function timeModule(): LocatedModule {
  return stdModule(timeName, timeSource);
}

/** The std modules a program is handed by role, as every app hands them (§2, §3.13). */
export function stdRoles(): Readonly<Record<LanguageModule, LocatedModule>> {
  return { prelude: preludeModule(), time: timeModule() };
}

/** The loader of the std modules in `sources`. */
export function stdlibLoader(sources: Readonly<Record<string, string>> = stdSources): ModuleLoader {
  const texts = new Map(Object.entries(sources));
  return (name) => {
    const text = texts.get(name);
    return text === undefined ? undefined : stdModule(name, text);
  };
}

function stdModule(name: string, text: string): LocatedModule {
  const id = moduleIdOf(new URL(`std:${name}`));
  return { id, name, label: id, read: () => text, isStd: true };
}
