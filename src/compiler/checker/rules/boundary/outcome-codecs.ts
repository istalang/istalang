/**
 * The codec an instance's outcome is encoded by for its host (§9), as a call its start makes.
 *
 * An extern giving an `Instance<R>` starts a new instance: only the runtime gives one, and
 * `Instance<R>` never crosses to a host, so every such extern spawns, `spawn` and the `runtime` and
 * `testing` modules' alike. Its runtime encodes the outcome by the codec writing `R`, which the
 * Definition's `Instance<R>` type entry names (lowering/tables/type-table.ts). That is a call the
 * start makes, so it is recorded as the call's implicit `encodeOutcome`: found in a generic body
 * against its type parameters' constraints, it counts in the body's expansion (§3.5) as any call
 * its code makes does, and a codec spawning an instance of what it writes is reported there.
 */

import { wellKnown } from '../../../../foundation/language/well-known/index.ts';
import type { CallingNode } from '../../../syntax/expressions/calls.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import type { ResolvedCall, ResolvedSite } from '../../surface/resolved-call.ts';
import { wellKnownArguments } from '../../types/type/well-known.ts';

/** Records the codec writing the outcome of each instance one of `calls`, a body's, starts. */
export function recordOutcomeCodecs(
  context: BodyContext,
  calls: Iterable<readonly [ResolvedSite, ResolvedCall]>,
): void {
  const { checker } = context;
  for (const [site, call] of calls) {
    const type = isCalling(site) && call.function.isExtern ? context.typeOf(site) : undefined;
    const [outcome] =
      type === undefined ? [] : (wellKnownArguments(checker, wellKnown.instance, type) ?? []);
    const codec = outcome === undefined ? undefined : checker.json.codecOf(outcome, 'write');
    if (codec !== undefined) {
      context.implicit.record(site, 'encodeOutcome', codec);
    }
  }
}

/** Whether `site` calls what it resolves to, as a written or a deferred call does. */
function isCalling(site: ResolvedSite): site is CallingNode {
  return site.kind === 'Call' || site.kind === 'DeferredCall';
}
