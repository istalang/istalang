/**
 * What every `ista` subcommand receives.
 *
 * Commands write through the environment rather than to `process`, and report an exit code
 * instead of exiting, so the whole CLI runs in-process under test exactly as it does from a shell.
 */

import type { Command } from 'commander';

export interface CliEnvironment {
  /** The directory `ista` runs in, used as the project root. */
  readonly cwd: string;
  readonly write: (text: string) => void;
  readonly writeError: (text: string) => void;
}

export interface CommandContext {
  readonly environment: CliEnvironment;
  /** Records the process exit code: 0 clean, 1 problems found, 2 the command couldn't run as asked. */
  readonly exitWith: (code: number) => void;
}

/** Adds one subcommand to the CLI. */
export type CommandDefinition = (cli: Command, context: CommandContext) => void;
