/**
 * Signature help at every argument of every call over the corpus and std modules, through the
 * protocol: a call resolved to a function shows it, its active parameter the one the call's
 * binding passes the argument to, a method's receiver aside; a call of a function value shows
 * its type, the argument's own parameter active.
 *
 * A call being typed, the text cut right after one of its arguments, gets the help the same cut
 * gets with the call closed. The cut drops what follows, a function declared further down
 * included, so the two are compared with each other rather than with the whole module's help.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Position,
  type SignatureHelp,
  SignatureHelpRequest,
} from 'vscode-languageserver/node';
import { checkProgram } from '../../compiler/checker/check.ts';
import { parameterOfArgument } from '../../compiler/checker/resolved-call.ts';
import { typeText } from '../../compiler/checker/types/type-text.ts';
import { wellKnownArguments } from '../../compiler/checker/types/well-known.ts';
import type { ModuleId } from '../../compiler/program/program.ts';
import type { Call } from '../../compiler/syntax/expressions/index.ts';
import { spanIn } from '../../compiler/syntax/positions.ts';
import { nodesUnder } from '../../compiler/syntax/tree.ts';
import { wellKnown } from '../../language/well-known.ts';
import type { SourceText } from '../../text/source-text.ts';
import {
  corpusClient,
  programDocuments as documents,
  corpusProgram as program,
} from '../corpus-client.test-kit.ts';
import { rangeOf } from '../locations.ts';
import type { TestClient } from '../server.test-kit.ts';

const checker = checkProgram(program);

let client: TestClient;

beforeAll(async () => {
  client = await corpusClient();
});

/** What the active signature must be, at each written argument: its label's start, and the parameter's. */
interface Expected {
  readonly label: (label: string) => boolean;
  readonly parameter: (argument: number) => string | undefined;
}

function expectedAt(module: ModuleId, call: Call): Expected | undefined {
  const body = checker.lookup.bodyHolding(module, call);
  const resolved = body?.resolved.get(call);
  if (resolved !== undefined) {
    const bound = parameterOfArgument(resolved.binding);
    const receivers = resolved.receiver === undefined ? 0 : 1;
    const names = resolved.function.parameters.map((parameter) =>
      parameter.kind === 'Parameter'
        ? `${parameter.isRest ? '...' : ''}${parameter.name?.text}:`
        : '',
    );
    return {
      label: (label) => label.includes(`${resolved.function.name.text}`),
      parameter: (argument) => {
        const index = bound.get(argument + receivers);
        return index === undefined ? undefined : names[index];
      },
    };
  }
  const callee = body?.valueCalls.has(call) ? body.typeOf(call.callee) : undefined;
  const type =
    call.isOptional && callee
      ? wellKnownArguments(checker, wellKnown.optional, callee)?.[0]
      : callee;
  if (type?.kind !== 'function') {
    return undefined;
  }
  return {
    // Spelled out, never as an alias the type was written through: help marks its parameters.
    label: (label) => label === typeText({ ...type, alias: undefined }),
    parameter: (argument) => {
      const slot = type.parameters[argument];
      return slot === undefined ? undefined : `${slot.reference ? '&' : ''}${typeText(slot.type)}`;
    },
  };
}

function activeOf(help: SignatureHelp | null) {
  const signature = help?.signatures[help.activeSignature ?? 0];
  const parameter = signature?.parameters?.[help?.activeParameter ?? -1]?.label;
  const text = Array.isArray(parameter) ? signature?.label.slice(...parameter) : parameter;
  return { label: signature?.label ?? '', parameter: text ?? '' };
}

/** The active signature at `position` once the text of `uri` is `text`. */
async function helpIn(uri: string, text: string, position: Position) {
  await client.change(uri, text);
  return activeOf(
    await client.connection.sendRequest(SignatureHelpRequest.type, {
      textDocument: { uri },
      position,
    }),
  );
}

/**
 * Where help at the end of `source` cut at `end` differs from the help the cut closed by `)` gets.
 * The document gets its whole text back after.
 */
async function leftOpenMismatch(
  uri: string,
  source: SourceText,
  end: number,
): Promise<readonly string[]> {
  const position = rangeOf(source, { start: end, end }).start;
  const cut = source.text.slice(0, end);
  const open = await helpIn(uri, cut, position);
  const closed = await helpIn(uri, `${cut})`, position);
  await client.change(uri, source.text);
  return open.label === closed.label && open.parameter === closed.parameter
    ? []
    : [`${open.label} [${open.parameter}] ≠ ${closed.label} [${closed.parameter}]`];
}

/** The end of every argument of every call in the corpus's own files, with where it stands. */
const argumentEnds = documents
  .filter(({ uri }) => uri.startsWith('file:'))
  .flatMap(({ uri, tree }) =>
    nodesUnder(tree, tree.root).flatMap((node) =>
      node.kind === 'Call'
        ? node.arguments.map((argument) => {
            const { end } = spanIn(tree, argument.span);
            const { line, character } = rangeOf(tree.source, { start: end, end }).start;
            return { uri, source: tree.source, end, at: `${line}:${character}` };
          })
        : [],
    ),
  );

describe('signature help over the corpus', () => {
  it.each(documents)('$uri', async ({ uri, module, tree }) => {
    const asked = nodesUnder(tree, tree.root).flatMap((node) => {
      const expected = node.kind === 'Call' ? expectedAt(module, node) : undefined;
      return node.kind === 'Call' && expected !== undefined
        ? node.arguments.map((argument, index) => ({
            at: spanIn(tree, argument.span).start,
            index,
            expected,
          }))
        : [];
    });
    const wrong = await Promise.all(
      asked.map(async ({ at, index, expected }) => {
        const position = rangeOf(tree.source, { start: at, end: at }).start;
        const { label, parameter } = activeOf(
          await client.connection.sendRequest(SignatureHelpRequest.type, {
            textDocument: { uri },
            position,
          }),
        );
        const wanted = expected.parameter(index);
        const fits =
          expected.label(label) && (wanted === undefined || parameter.startsWith(wanted));
        return fits
          ? []
          : [`${position.line}:${position.character} ${label} [${parameter}] ≠ ${wanted}`];
      }),
    );
    expect(wrong.flat()).toEqual([]);
  });

  it.each(argumentEnds)('$uri $at, the call left open', async ({ uri, source, end }) => {
    expect(await leftOpenMismatch(uri, source, end)).toEqual([]);
  });
});
