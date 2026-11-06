/**
 * How the `time` module's natives read and build its structs (time.ista): by the names the fields
 * are declared with, so a reordered declaration can't swap two of them.
 */

import { fieldValueOf } from '../../definition/values/declared-values.ts';
import type { Value } from '../../definition/values/values.ts';
import type { NativeContext } from '../../runtime/natives.ts';
import { int } from '../values/arguments.ts';
import { okStruct, resultStruct } from '../values/results.ts';

/** The field of a `Time` or a `Duration` holding its milliseconds. */
const millisecondsField = 'value';

/** The milliseconds a `Time` or a `Duration` argument holds. */
export function millisecondsOf(context: NativeContext, value: Value | undefined): bigint {
  return int(fieldValueOf(context.types, value, millisecondsField));
}

/** A `Time` or a `Duration` holding `milliseconds`, the type the extern declares it returns. */
export function resultMilliseconds(context: NativeContext, milliseconds: bigint): Value {
  return resultStruct(context, { [millisecondsField]: milliseconds });
}

/** A `Time` or a `Duration` holding `milliseconds`, the type the extern's `Result` holds. */
export function okMilliseconds(context: NativeContext, milliseconds: bigint): Value {
  return okStruct(context, { [millisecondsField]: milliseconds });
}
