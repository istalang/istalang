/**
 * How a call's mark and sendability parameters settle where no bound does (§3.5; proposal 8,
 * Rule 3): to the least member of their order they may stand for (types/type/mark-orders.ts),
 * `"simple"` for a mark that may be simple, `"sendable"` for a sendability.
 *
 * - The callee's own mark, the one its head names (`Signature.kind`), is bounded by the mark of the
 *   code making the call (`UseSite.codeKind`), the call-site seam the settling handler reads: it
 *   takes the least it may stand for at or below that, so `time.delay(5s)` is an ista timer in ista
 *   code, `"ista"` being the only kind at or below it, and a `K` timer in `K` code. The bound only
 *   settles what nothing decides: a mark decided above it is the call rule's to report, naming the
 *   call (resolution/applying/call-kinds.ts), and one of the two kinds in simple code, which no kind
 *   is at or below, takes the code's mark, which the member check refuses (member-arguments.ts).
 * - Every other mark parameter is the callee's signature's alone, inferred as any type parameter
 *   is: nothing deciding one of the two kinds leaves it uninferred.
 * - Outside code no bound applies.
 */

import type { UseSite } from '../../contexts/use-site.ts';
import type { Settling } from '../../types/inference/settle.ts';
import { simpleMark } from '../../types/type/function-kinds.ts';
import type { ParameterKey, Type } from '../../types/type/index.ts';
import { dataKindOrder } from '../../types/type/mark-orders.ts';
import type { Signature } from '../choosing/choice.ts';

/**
 * `settling`, each mark or sendability parameter of `signature` nothing fixes, nor a default,
 * settled at `site`.
 */
export function kindsSettledAt(
  site: UseSite,
  signature: Pick<Signature, 'typeParameters' | 'kind'>,
  settling: Settling,
): Settling {
  const head = signature.kind();
  const least = new Map<ParameterKey, Type | undefined>(
    signature.typeParameters.flatMap((parameter): [ParameterKey, Type | undefined][] => {
      const qualifier = site.checker.fitting.qualifierOf(parameter);
      if (qualifier === undefined) {
        return [];
      }
      if (qualifier.order !== dataKindOrder) {
        return [[parameter, qualifier.order.bottom]];
      }
      if (qualifier.mayBeBottom) {
        return [[parameter, simpleMark]];
      }
      // The least at or below the bound but `"simple"` is the bound itself, the one other mark there.
      const isHead = head.kind === 'parameter' && head.declaration === parameter;
      return [[parameter, isHead ? site.codeKind : undefined]];
    }),
  );
  return least.size === 0
    ? settling
    : {
        ...settling,
        defaultOf: (key, found) => settling.defaultOf(key, found) ?? least.get(key),
      };
}
