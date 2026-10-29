/**
 * What every `ista` subcommand receives.
 *
 * Commands write through the environment rather than to `process`, and report an exit code
 * instead of exiting, so the whole CLI runs in-process under test exactly as it does from a shell.
 */

import type { Readable, Writable } from 'node:stream';
import type { Command } from 'commander';

export interface CliEnvironment {
  /** The directory `ista` runs in, used as the project root. */
  readonly cwd: string;
  readonly write: (text: string) => void;
  readonly writeError: (text: string) => void;
  /**
   * Settles once the process has nothing left to run, so a promise still pending can never settle:
   * `ista run --host` stops waiting on its host then.
   */
  readonly idle: Promise<void>;
  /**
   * Standard input and output as streams, for a command speaking a protocol over them (`lsp`).
   * Every other command writes text through `write`.
   */
  readonly stdio: { readonly input: Readable; readonly output: Writable };
}

/** What a command's exit code says. */
export const exitCodes = {
  /** It ran and found nothing wrong. */
  clean: 0,
  /** It ran and found problems: errors in the program, a panic, a refusal. */
  problems: 1,
  /** It couldn't run as asked: a usage error, or a file that can't be read. */
  couldNotRun: 2,
} as const;

export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes];

interface CommandContext {
  readonly environment: CliEnvironment;
  /** Records the process exit code. */
  readonly exitWith: (code: ExitCode) => void;
}

/** Adds one subcommand to the CLI. */
export type CommandDefinition = (cli: Command, context: CommandContext) => void;
