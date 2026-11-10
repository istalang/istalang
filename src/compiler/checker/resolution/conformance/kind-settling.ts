/**
 * How a call's kind parameters settle where nothing fixes them (§3.3, §3.5): to the kind of the
 * code making the call, the call-site seam the settling handler reads (`UseSite.codeKind`), so an
 * unmarked function's implicit kind and a `K in Persistence` alike take their caller's kind, and
 * `time.delay(5s)` is a live timer in live code and an ista one in ista code. It is the one place
 * a callee's kind takes its caller's: nothing binds it before the call's arguments are inferred,
 * so an argument of a kind fixes it first (`retry(fetchLive, 3)`).
 *
 * Outside code, a mark that may be simple (a carried kind, `M in DataKind`) takes `"simple"`, which
 * code of every mark may call; one of the two kinds (`K in Persistence`) takes none, which leaves
 * it to what fixes it.
 *
 * A sendability parameter (`S in Sendability`) nothing fixes was given only sendable functions,
 * which bind nothing (`sendFits`), so it takes the least, `"sendable"`.
 */

import {
  isKindParameter,
  isSendabilityParameter,
  standsForOneKind,
} from '../../../syntax/declarations/function-kinds.ts';
import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { UseSite } from '../../contexts/use-site.ts';
import type { Settling } from '../../types/inference/settle.ts';
import { simpleMark } from '../../types/type/function-kinds.ts';
import { sendableSend } from '../../types/type/function-types.ts';
import type { ParameterKey, Type } from '../../types/type/index.ts';

/**
 * `settling`, each kind or sendability parameter of `parameters` nothing fixes, nor a default,
 * settled at `site`.
 */
export function kindsSettledAt(
  site: UseSite,
  parameters: readonly TypeParameter[],
  settling: Settling,
): Settling {
  const kinds = new Map<ParameterKey, Type | undefined>(
    parameters.flatMap((parameter): [ParameterKey, Type | undefined][] => {
      if (isSendabilityParameter(parameter)) {
        return [[parameter, sendableSend]];
      }
      return isKindParameter(parameter)
        ? [[parameter, site.codeKind ?? (standsForOneKind(parameter) ? undefined : simpleMark)]]
        : [];
    }),
  );
  return kinds.size === 0
    ? settling
    : {
        ...settling,
        defaultOf: (key, found) => settling.defaultOf(key, found) ?? kinds.get(key),
      };
}
