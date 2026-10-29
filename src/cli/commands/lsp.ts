/**
 * `ista lsp`: the language server (lsp/server.ts), speaking LSP over standard input and output for
 * the project of the editor that starts it.
 *
 * Standard input and output are its one transport; editors pass `--stdio` to say so, which it
 * accepts. It runs until the client closes its input. The client's `exit` ends the process at once,
 * as the protocol has it.
 */

import { finished } from 'node:stream/promises';
import {
  createConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { serveLanguage } from '../../lsp/server.ts';
import { type CommandDefinition, exitCodes } from '../command.ts';

export const defineLspCommand: CommandDefinition = (cli, { environment, exitWith }) => {
  cli
    .command('lsp')
    .description('run the language server over standard input and output')
    .option('--stdio', 'use standard input and output, the only transport')
    .action(async () => {
      const { input, output } = environment.stdio;
      serveLanguage(
        createConnection(new StreamMessageReader(input), new StreamMessageWriter(output)),
        environment.cwd,
      );
      await finished(input);
      exitWith(exitCodes.clean);
    });
};
