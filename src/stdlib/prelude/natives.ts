/**
 * The prelude's natives: what the runtime runs for the prelude's extern functions, by the key
 * `externKey` gives their declarations (prelude.ista declares them; docs/arch/definition.md,
 * "Externs"). Its operators and conversions on `Int`, `Float` and `String` are primitive
 * operations, which every backend writes inline (definition/instructions/primitive-ops.ts), so
 * they have none here.
 *
 * - `_trace()` runs as `Error`'s `trace` default, in the entry a literal leaving the field out
 *   calls (§3.1), so it takes its caller's trace, without that entry's frame: an `Error`'s trace
 *   starts where it is built.
 */

import type { NativeKeys } from '../../definition/extern-key.ts';
import {
  type NativeContext,
  type Natives,
  Panic,
  type WithInstances,
  type WithRun,
  type WithWeakSide,
} from '../../runtime/natives.ts';
import { text } from '../values/arguments.ts';
import { arrayNatives } from './arrays.ts';
import { instanceNatives } from './instance-natives.ts';
import { mapNatives } from './maps.ts';
import { rangeNatives } from './range-natives.ts';
import { runNatives } from './run-natives.ts';
import { stringNatives } from './strings.ts';
import { textFormNatives } from './text-forms.ts';
import { weakNatives } from './weak-natives.ts';

export const preludeNatives = (
  keys: NativeKeys,
): Natives<NativeContext & WithWeakSide & WithInstances & WithRun> => ({
  ...arrayNatives(keys),
  ...instanceNatives(keys),
  ...mapNatives(keys),
  ...rangeNatives(keys),
  ...runNatives(keys),
  ...stringNatives(keys),
  ...weakNatives(keys),
  ...textFormNatives(keys),
  [keys.of('panic', 'String')]: ([message]) => {
    throw new Panic(text(message));
  },
  [keys.of('_trace')]: (_, context) => context.callerTrace(),
});
