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
 * Three std modules the language itself refers to are handed to a program by role: the prelude,
 * which every module sees without importing it and no import names; `time`, whose `Duration`
 * types every duration literal (§2); and `json`, whose codecs every value crossing to a host goes
 * through (§9). The last two are loaded with every program but visible only where imported.
 */

import type { LocatedModule, ModuleLoader } from '../compiler/program/program.ts';
import { moduleIdOf } from '../compiler/program/program.ts';
import { type LanguageModule, languageModules } from '../language/well-known.ts';
import futuresSource from './futures/futures.ista';
import inboxSource from './inbox/inbox.ista';
import jsonSource from './json/json.ista';
import preludeSource from './prelude/prelude.ista';
import runtimeSource from './runtime/runtime.ista';
import timeSource from './time/time.ista';

/** The prelude's name, which its declarations and natives are qualified with. */
export const preludeName = languageModules.prelude;

/** The `time` module's name. */
export const timeName = languageModules.time;

/** The `json` module's name. */
export const jsonName = languageModules.json;

/** The `runtime` module's name. */
export const runtimeName = 'runtime';

/** The `futures` module's name. */
export const futuresName = 'futures';

/** The `inbox` module's name. */
const inboxName = 'inbox';

/** Every std module's source, by name. */
export const stdSources: Readonly<Record<string, string>> = {
  [futuresName]: futuresSource,
  [inboxName]: inboxSource,
  [jsonName]: jsonSource,
  [runtimeName]: runtimeSource,
  [timeName]: timeSource,
};

/** The prelude, as a module for the program to load (§3.13). */
export function preludeModule(): LocatedModule {
  return stdModule(preludeName, preludeSource);
}

/** `time`, as a module for the program to load by role (§2). */
function timeModule(): LocatedModule {
  return stdModule(timeName, timeSource);
}

/** The std modules a program is handed by role, as every app hands them (§2, §3.13). */
export function stdRoles(): Readonly<Record<LanguageModule, LocatedModule>> {
  return { prelude: preludeModule(), time: timeModule(), json: stdModule(jsonName, jsonSource) };
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
