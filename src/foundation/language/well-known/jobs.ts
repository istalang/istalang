/**
 * What the toolchain knows by name of jobs (§5): the runtime module's `delegate`, whose use has
 * lowering add the loop serving jobs to the program, and that loop, `_serve`, which the
 * Definition names as its job server for `Runtime.open` to start. A program that never delegates
 * has no jobs, so it lowers no loop.
 */

export const jobFunctions = {
  module: 'runtime',
  delegate: 'delegate',
  server: '_serve',
} as const;
