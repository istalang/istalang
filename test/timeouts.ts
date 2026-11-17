/**
 * How long a test may take, in two tiers. Suites of several worktrees run side by side: measured at
 * a load of about 20 on 12 cores, a test takes four to five times what it takes alone, and every
 * test took less than a third of its tier's limit. A test passing a third under that load is made
 * faster, split, or moved to the slow tier when its work is of that kind.
 *
 * A hook takes the limit of the tests it sets up: its work is theirs, shared.
 */

/** Every test's limit (vitest.config.ts), and a child process's a test waits on. */
export const testTimeout = 20_000;

/**
 * The limit of a test whose work is a whole toolchain's over many programs: compiling, checking or
 * running program after program, a property over corpus or std modules, an editor server checking
 * the corpus, or bundling the live entry. The longest took 44 s under that load.
 */
export const slowTestTimeout = 120_000;
