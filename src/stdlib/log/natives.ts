/**
 * The `log` module's natives (log.ista): `write`, which adds a record to its segment's log
 * (runtime/natives.ts `NativeLogs`), its level as a host reads it and its fields as the JSON a host
 * reads (§9).
 */

import { jsonTypeOf, plainOfJson } from '../../definition/values/json-values.ts';
import { wellKnown } from '../../language/well-known/index.ts';
import type { LogLevel } from '../../runtime/instance-state.ts';
import type { NativeContext, Natives, WithLogs } from '../../runtime/natives.ts';
import { given, text, variantEntry } from '../native-values.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';

// biome-ignore-start lint/style/useNamingConvention: the keys are the enum's variant names.
/** Each `log.Level` variant's level, by its declared name. */
const levels = {
  Debug: 'debug',
  Info: 'info',
  Warn: 'warn',
  Error: 'error',
} as const satisfies Record<string, LogLevel>;
// biome-ignore-end lint/style/useNamingConvention: the keys are the enum's variant names.

export const logNatives = (keys: NativeKeys): Natives<NativeContext & WithLogs> => ({
  [keys.of('write', keys.type('Level'), 'String', knownTypeKey(wellKnown.json))]: (
    [level, message, fields],
    context,
  ) => {
    context.logs.write({
      level: variantEntry(context, level, levels),
      message: text(message),
      fields: plainOfJson(given(fields), jsonTypeOf(context.types)),
    });
    return null;
  },
});
