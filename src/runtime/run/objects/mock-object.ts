/**
 * A mock's handle (testing.ista `Mock<F>`): it replaces its target's calls while it is held, in a
 * Definition built to run tests (§10, mocks.ts), and records the calls it took.
 */

import type { Value } from '../../../definition/values/values.ts';
import { RunObject } from './run-object.ts';

export class MockObject extends RunObject {
  readonly target: number;
  /** Set once, as it is made or as its snapshot is read back. */
  replacement: Value;
  /** Each call's arguments, a tuple per call, oldest first. */
  readonly calls: Value[] = [];

  constructor(id: number, target: number, replacement: Value) {
    super(id);
    this.target = target;
    this.replacement = replacement;
  }
}
