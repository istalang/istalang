/**
 * Loads std modules (§3.8) by their simple names, such as `'time'`, from the list of std module
 * sources (std-sources.ts), which holds no natives: compiling a program needs none.
 *
 * A std module's id is `std:<name>`, a scheme no file can have, so a std module can never be
 * confused with a project file; a name that both this loader and the project's answer is ambiguous
 * (§3.13). Every module it loads is marked as shipped with the toolchain, so its externs need no
 * host.
 *
 * Four std modules the language itself refers to are handed to a program by role: the prelude,
 * which every module sees without importing it and no import names; `time`, whose `Duration`
 * types every duration literal (§2); `json`, whose codecs every value crossing to a host goes
 * through (§9); and `testing`, which only test modules may import (§10). The last three are loaded
 * with every program but visible only where imported.
 *
 * Tests lay sources of their own over the shipped ones. The loader then answers only theirs, while
 * each role still loads, from theirs when they give its module and from the shipped one otherwise:
 * a program can't be built without its prelude.
 */

import type { LocatedModule, ModuleId, ModuleLoader } from '../compiler/program/program.ts';
import { moduleIdOf } from '../compiler/program/program.ts';
import { type LanguageModule, languageModules, stdScheme } from '../language/well-known/index.ts';
import { stdModuleSources } from './std-sources.ts';

/** Std module sources by name. */
export type StdSources = Readonly<Record<string, string>>;

/** The prelude, as a module for the program to load (§3.13). */
export function preludeModule(): LocatedModule {
  return roleModule(languageModules.prelude, stdModuleSources);
}

/** The std modules a program is handed by role, as every app hands them (§2, §3.13). */
export function stdRoles(
  sources: StdSources = stdModuleSources,
): Readonly<Record<LanguageModule, LocatedModule>> {
  return {
    prelude: roleModule(languageModules.prelude, sources),
    time: roleModule(languageModules.time, sources),
    json: roleModule(languageModules.json, sources),
    testing: roleModule(languageModules.testing, sources),
  };
}

/** The loader of the std modules in `sources`. */
export function stdlibLoader(sources: StdSources = stdModuleSources): ModuleLoader {
  const texts = importableSources(sources);
  return (name) => {
    const text = texts.get(name);
    return text === undefined ? undefined : located(name, text);
  };
}

/** The names of the shipped std modules an import may name, which an editor offers as paths. */
export const importableStdModules: readonly string[] = [
  ...importableSources(stdModuleSources).keys(),
];

/** The modules of `sources` an import may name: all but the prelude, which no import names. */
function importableSources(sources: StdSources): ReadonlyMap<string, string> {
  const texts = new Map(Object.entries(sources));
  texts.delete(languageModules.prelude);
  return texts;
}

/** The std module that plays a role, which bears the role's name: from `sources`, or shipped. */
function roleModule(role: LanguageModule, sources: StdSources): LocatedModule {
  return located(role, sources[role] ?? stdModuleSources[role]);
}

/** The shipped source of the std module `id`; undefined for an id that names none. */
export function stdSourceOf(id: ModuleId): string | undefined {
  const url = new URL(id);
  return url.protocol === `${stdScheme}:` ? shippedSources.get(url.pathname) : undefined;
}

const shippedSources: ReadonlyMap<string, string> = new Map(Object.entries(stdModuleSources));

function located(name: string, text: string): LocatedModule {
  const id = moduleIdOf(new URL(`${stdScheme}:${name}`));
  return { id, name, label: id, read: () => text, isStd: true };
}
