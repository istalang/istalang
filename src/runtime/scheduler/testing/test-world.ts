/**
 * The world a test runs in (§10), as the scheduler sees it: the seam through which an instance a
 * test started reaches the test's mocks, a watch learns how the watched instance stands, and the
 * `testing` natives read what only the runtime running the test knows. Only that runtime gives
 * one (runtime/testing/), so a program running anywhere else meets none of it.
 *
 * Every answer is read from the last commit of the instance asked about, as a host's view is: an
 * instance a test started runs between the test's segments, never inside one.
 */

import type { FunctionId } from '../../../definition/operands.ts';
import type { Value } from '../../../definition/values/values.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Inspection } from '../../instance-state.ts';
import { Panic } from '../../natives.ts';
import type { TestWatch } from '../../snapshot/objects.ts';

/** The future a call to another instance's mock fills: its caller, and the token it named it. */
export interface CallerFuture {
  readonly instance: string;
  readonly token: string;
}

/** A call another instance made to one of a holder's mocks, as the holder answers it (§10). */
export interface MockCall extends CallerFuture {
  readonly mock: number;
  readonly arguments: readonly Value[];
}

/**
 * The answer to a `MockCall`: given at once, with whether it came from a future the replacement
 * returned; pending, to fill the caller's future once the holder gives it; or failed, when the
 * holder panicked answering it or no longer runs.
 */
export type MockAnswer =
  | { readonly kind: 'given'; readonly value: Value; readonly followed: boolean }
  | { readonly kind: 'pending' }
  | { readonly kind: 'failed' };

export interface TestWorld {
  /** The mock `holder` holds for `target`, as its last commit has it: the newest; none without. */
  readonly mockOf: (holder: string, target: FunctionId) => number | undefined;
  /**
   * Answers `call` in `holder`, which runs the mock's replacement and commits before this returns.
   */
  readonly answer: (holder: string, call: MockCall) => MockAnswer;
  /**
   * What a test's pending wait on `instance` resolves with once `until` holds; undefined until
   * then. A wait on an instance's end is the scheduler's, as anywhere else
   * (../instance/instance-ends.ts).
   */
  readonly watched: (instance: string, until: TestWatch) => Value | undefined;
  /** Panics unless the instance runs inside `ista test` (§10). */
  readonly requireTest: () => void;
  /** Where `instance` stands and waits, from its last commit; undefined before its first. */
  readonly inspect: (instance: string) => Inspection | undefined;
  /** A host payload no other `testing.handle` gives. */
  readonly handlePayload: () => string;
}

function outsideTest(): never {
  throw new Panic('Only a test run by ista test reaches other instances (§10).');
}

/**
 * The world every runtime outside `ista test` runs in: no mocks held elsewhere, no test watches.
 */
export const noTestWorld: TestWorld = {
  mockOf: () => undefined,
  answer: () => unreachable('No mock is held outside a test world.'),
  watched: () => undefined,
  requireTest: outsideTest,
  inspect: outsideTest,
  handlePayload: outsideTest,
};
