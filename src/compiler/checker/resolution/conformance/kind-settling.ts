/**
 * How a call's kind parameters settle where nothing fixes them (§3.3, §3.5): to the kind of the
 * code making the call, the call-site seam the settling handler reads (`UseSite.codeKind`), so an
 * unmarked function's implicit kind and a `K in Persistence` alike take their caller's kind, and
 * `time.delay(5s)` is a live timer in live code and an ista one in ista code. It is the one place
 * a callee's kind takes its caller's: nothing binds it before the call's arguments are inferred,
 * so an argument of a kind fixes it first (`retry(fetchLive, 3)`).
 *
 * Outside code, a kind that only function types in the signature read takes either kind, which
 * their code is the same for; one a future reads takes none, which leaves it to what fixes it.
 */

import { isKindParameter } from '../../../syntax/declarations/function-kinds.ts';
import type { TypeParameter } from '../../../syntax/declarations/index.ts';
import type { UseSite } from '../../contexts/use-site.ts';
import type { Settling } from '../../types/inference/settle.ts';
import { unmarkedKind } from '../../types/type/function-kinds.ts';
import type { ParameterKey, Type } from '../../types/type/index.ts';

/** `settling`, each kind parameter of `parameters` nothing fixes, nor a default, settled at `site`. */
export function kindsSettledAt(
  site: UseSite,
  parameters: readonly TypeParameter[],
  settling: Settling,
): Settling {
  const kinds = new Map<ParameterKey, Type | undefined>(
    parameters
      .filter(isKindParameter)
      .map((parameter) => [
        parameter,
        site.codeKind ?? (parameter.memberOf === undefined ? unmarkedKind : undefined),
      ]),
  );
  return kinds.size === 0
    ? settling
    : {
        ...settling,
        defaultOf: (key, found) => settling.defaultOf(key, found) ?? kinds.get(key),
      };
}
