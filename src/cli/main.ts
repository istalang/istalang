#!/usr/bin/env node
/**
 * The `ista` executable: binds the CLI to this process's working directory, output streams and
 * exit code. Everything else lives in cli.ts, which tests run in-process.
 */

import process from 'node:process';
import { runCli } from './cli.ts';

process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  write: (text) => process.stdout.write(text),
  writeError: (text) => process.stderr.write(text),
});
