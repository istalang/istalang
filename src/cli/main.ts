#!/usr/bin/env node
/**
 * The `ista` executable: binds the CLI to this process's working directory, output streams, exit
 * code and running out of work (`beforeExit`, which Node emits when nothing is left that could
 * settle a promise). Everything else lives in cli.ts, which tests run in-process.
 */

import process from 'node:process';
import { runCli } from './cli.ts';

process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  write: (text) => process.stdout.write(text),
  writeError: (text) => process.stderr.write(text),
  idle: new Promise((resolve) => {
    process.once('beforeExit', () => {
      resolve();
    });
  }),
});
