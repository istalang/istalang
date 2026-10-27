/**
 * Loads std modules (§3.8) by their simple names, such as `'time'`, from the list of std modules
 * (std-modules.ts).
 *
 * A std module's id is `std:<name>`, a scheme no file can have, so a std module can never be
 * confused with a project file; a name that both this loader and the project's answer is ambiguous
 * (§3.13). Every module it loads is marked as shipped with the toolchain, so its externs need no
 * host.
 *
 * Three std modules the language itself refers to are handed to a program by role: the prelude,
 * which every module sees without importing it and no import names; `time`, whose `Duration`
 * types every duration literal (§2); and `json`, whose codecs every value crossing to a host goes
 * through (§9). The last two are loaded with every program but visible only where imported.
 */

import type { LocatedModule, ModuleLoader } from '../compiler/program/program.ts';
import { moduleIdOf } from '../compiler/program/program.ts';
import { type LanguageModule, languageModules } from '../language/well-known.ts';
import { unreachable } from '../structures/unreachable.ts';
import { stdModules } from './std-modules.ts';

/** Every std module an import can name, its source by name: all but the prelude. */
export const stdSources: Readonly<Record<string, string>> = Object.fromEntries(
  stdModules
    .filter((module) => module.name !== languageModules.prelude)
    .map((module) => [module.name, module.source]),
);

/** The prelude, as a module for the program to load (§3.13). */
export function preludeModule(): LocatedModule {
  return roleModule(languageModules.prelude);
}

/** The std modules a program is handed by role, as every app hands them (§2, §3.13). */
export function stdRoles(): Readonly<Record<LanguageModule, LocatedModule>> {
  return {
    prelude: preludeModule(),
    time: roleModule(languageModules.time),
    json: roleModule(languageModules.json),
  };
}

/** The loader of the std modules in `sources`. */
export function stdlibLoader(sources: Readonly<Record<string, string>> = stdSources): ModuleLoader {
  const texts = new Map(Object.entries(sources));
  return (name) => {
    const text = texts.get(name);
    return text === undefined ? undefined : located(name, text);
  };
}

/** The std module that plays a role, which bears the role's name. */
function roleModule(name: string): LocatedModule {
  const module =
    stdModules.find((each) => each.name === name) ?? unreachable(`No std module ${name}.`);
  return located(name, module.source);
}

function located(name: string, text: string): LocatedModule {
  const id = moduleIdOf(new URL(`std:${name}`));
  return { id, name, label: id, read: () => text, isStd: true };
}
