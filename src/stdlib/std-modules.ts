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
import collectionsSource from './collections/collections.ista';
import cryptoSource from './crypto/crypto.ista';
import { cryptoNatives } from './crypto/natives.ts';
import fanoutSource from './fanout/fanout.ista';
import futuresSource from './futures/futures.ista';
import { futuresNatives } from './futures/natives.ts';
import inboxSource from './inbox/inbox.ista';
import jsonSource from './json/json.ista';
import { jsonNatives } from './json/natives.ts';
import logSource from './log/log.ista';
import { logNatives } from './log/natives.ts';
import { preludeNatives } from './prelude/natives.ts';
import preludeSource from './prelude/prelude.ista';
import { randomNatives } from './random/natives.ts';
import randomSource from './random/random.ista';
import { regexNatives } from './regex/natives.ts';
import regexSource from './regex/regex.ista';
import rpcSource from './rpc/rpc.ista';
import { runtimeNatives } from './runtime/natives.ts';
import runtimeSource from './runtime/runtime.ista';
import { type StdModule, stdModule } from './std-module.ts';
import { stringsNatives } from './strings/natives.ts';
import stringsSource from './strings/strings.ista';
import { testingNatives } from './testing/natives.ts';
import testingSource from './testing/testing.ista';
import { timeNatives } from './time/natives.ts';
import timeSource from './time/time.ista';

export const stdModules: readonly StdModule[] = [
  stdModule(languageModules.prelude, preludeSource, preludeNatives),
  stdModule(languageModules.time, timeSource, timeNatives),
  stdModule(languageModules.json, jsonSource, jsonNatives),
  stdModule('futures', futuresSource, futuresNatives),
  stdModule('inbox', inboxSource),
  stdModule('rpc', rpcSource),
  stdModule('fanout', fanoutSource),
  stdModule('runtime', runtimeSource, runtimeNatives),
  stdModule('strings', stringsSource, stringsNatives),
  stdModule('regex', regexSource, regexNatives),
  stdModule('collections', collectionsSource),
  stdModule('random', randomSource, randomNatives),
  stdModule('log', logSource, logNatives),
  stdModule('crypto', cryptoSource, cryptoNatives),
  stdModule(languageModules.testing, testingSource, testingNatives),
];
