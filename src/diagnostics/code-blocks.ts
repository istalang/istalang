/**
 * Which phase owns which block of diagnostic codes.
 *
 * Codes are public and stable, so each block is written out rather than derived from table order.
 * This table is the one place that assigns blocks. `defineDiagnostics` checks every code against
 * its phase's block, so two catalogs can never hand out the same code.
 */

export const codeBlocks = {
  scanner: 1000,
  parser: 2000,
  program: 3000,
  binder: 4000,
} as const;

export type DiagnosticPhase = keyof typeof codeBlocks;

/** How many codes a block holds: a phase owns [block, block + codeBlockSize). */
export const codeBlockSize = 1000;
