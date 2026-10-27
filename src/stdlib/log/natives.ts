/**
 * The `log` module's natives (log.ista): `write`, which adds a record to its segment's log
 * (runtime/natives.ts `NativeLogs`), its level named as its `Level` variant is, lowercased, and its
 * fields as the JSON a host reads (§9).
 */

import { jsonTypeOf, plainOfJson } from '../../definition/json-values.ts';
import { wellKnown } from '../../language/well-known.ts';
import type { NativeContext, Natives, WithLogs } from '../../runtime/natives.ts';
import { given, text, variantName } from '../native-values.ts';
import { knownTypeKey, type NativeKeys } from '../std-module.ts';

export const logNatives = (keys: NativeKeys): Natives<NativeContext & WithLogs> => ({
  [keys.of('write', keys.type('Level'), 'string', knownTypeKey(wellKnown.json))]: (
    [level, message, fields],
    context,
  ) => {
    context.logs.write({
      level: variantName(context, level).toLowerCase(),
      message: text(message),
      fields: plainOfJson(given(fields), jsonTypeOf(context.types)),
    });
    return null;
  },
});
