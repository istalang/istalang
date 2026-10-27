/**
 * The one list of std modules (§3.8): adding a module is adding its record here, and the loader
 * (stdlib-loader.ts) and the natives table (natives.ts) both derive from this list. A module the
 * language refers to by role is named by its role (language/well-known.ts); every other module's
 * name is spelled here and nowhere else.
 *
 * Each source is imported as text and compiled into the package, so loading a std module never
 * touches a file system.
 */

import { languageModules } from '../language/well-known.ts';
import futuresSource from './futures/futures.ista';
import { futuresNatives } from './futures/natives.ts';
import inboxSource from './inbox/inbox.ista';
import jsonSource from './json/json.ista';
import { jsonNatives } from './json/natives.ts';
import { preludeNatives } from './prelude/natives.ts';
import preludeSource from './prelude/prelude.ista';
import { runtimeNatives } from './runtime/natives.ts';
import runtimeSource from './runtime/runtime.ista';
import { type StdModule, stdModule } from './std-module.ts';
import { timeNatives } from './time/natives.ts';
import timeSource from './time/time.ista';

export const stdModules: readonly StdModule[] = [
  stdModule(languageModules.prelude, preludeSource, preludeNatives),
  stdModule(languageModules.time, timeSource, timeNatives),
  stdModule(languageModules.json, jsonSource, jsonNatives),
  stdModule('futures', futuresSource, futuresNatives),
  stdModule('inbox', inboxSource),
  stdModule('runtime', runtimeSource, runtimeNatives),
];
