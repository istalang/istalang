/**
 * What each argument of a call still being written is expected to be (§8.1), for tools to read
 * (editor completion): a call short of an argument takes nothing, so nothing fits its arguments,
 * yet each written one expects what its parameter will be once the call is whole.
 *
 * - Only a call with one candidate expects anything: with several, which one is meant waits for
 *   the arguments.
 * - Arguments bind as a call binds them (../../choosing/binding.ts), but a parameter no argument
 *   gives yet is left out, as while the call is written. Inference runs as for the whole call: the
 *   arguments with types of their own are matched, and the type the call is expected to give
 *   advises, so `Rejected(‸` as a `Verdict<Color>` expects a `Color`. An argument whose
 *   parameter's type is still open expects nothing, and so does the function a deferred call
 *   gives, which is no expression written (§6.5).
 */

import type { BodyContext } from '../../../contexts/body-context.ts';
import { bodySite } from '../../../contexts/use-site.ts';
import { Inference } from '../../../types/inference/infer.ts';
import { mentionsAnyVariable } from '../../../types/inference/variables.ts';
import type { CallApplication } from '../../applying/applied-call.ts';
import { writtenFor } from '../../choosing/applicability.ts';
import { argumentSlotsOf, bindArguments, isBinding } from '../../choosing/binding.ts';
import { candidateSignature } from '../../choosing/choice.ts';
import { settlingAt } from '../../conformance/conformance.ts';

/** Records, for each argument of `request` written so far, the type its parameter will be. */
export function expectWrittenArguments(context: BodyContext, request: CallApplication): void {
  const [candidate, ...others] = request.candidates;
  if (candidate === undefined || others.length > 0) {
    return;
  }
  const { checker } = context;
  const signature = candidateSignature(checker, candidate);
  const lenient = signature.parameters.map((slot) => ({ ...slot, hasDefault: true }));
  const callArguments = request.arguments;
  const binding = bindArguments(lenient, callArguments);
  if (!isBinding(binding)) {
    return;
  }
  const inference = new Inference(
    signature.typeParameters,
    checker.fitting,
    writtenFor(signature, request.typeArguments),
  );
  const slots = argumentSlotsOf(signature.parameters, binding);
  for (const [index, { type }] of callArguments.entries()) {
    const slot = slots.get(index);
    if (slot !== undefined && type !== undefined && type.kind !== 'error') {
      inference.match(slot.type, type);
    }
  }
  inference.expect(signature.result(), request.expected);
  const settling = settlingAt(bodySite(context, request.span), signature);
  for (const [index, { node, isDeferred }] of request.arguments.entries()) {
    const slot = slots.get(index);
    const expected = slot === undefined ? undefined : inference.guided(slot.type, settling);
    const expects = isDeferred !== true && expected !== undefined;
    if (node !== undefined && expects && !mentionsAnyVariable(expected)) {
      context.expectAt(node, expected);
    }
  }
}
