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
import { checkProgram } from '../../../compiler/checker/check.ts';
import { parameterOfArgument } from '../../../compiler/checker/surface/resolved-call.ts';
import { typeText } from '../../../compiler/checker/types/type/type-text.ts';
import { wellKnownArguments } from '../../../compiler/checker/types/type/well-known.ts';
import type { ModuleId } from '../../../compiler/program/program.ts';
import type { Call } from '../../../compiler/syntax/expressions/index.ts';
import { withoutTypeArguments } from '../../../compiler/syntax/expressions/readings.ts';
import { nodesUnder } from '../../../compiler/syntax/tree/index.ts';
import { spanIn } from '../../../compiler/syntax/tree/positions.ts';
import { wellKnown } from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import { createSourceText, type SourceText } from '../../../foundation/text/source-text.ts';
import { signatureOf } from '../../language-service/signatures/signatures.ts';
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

/**
 * What the active signature must be, at each written argument: its label's start, and the
 * parameter's.
 */
interface Active {
  readonly kind: 'active';
  readonly label: (label: string) => boolean;
  readonly parameter: (argument: number) => string | undefined;
}

/** A call a field loop's passes resolve to several functions: each one's signature, none active. */
interface NoneActive {
  readonly kind: 'none';
  readonly labels: readonly string[];
}

type Expected = Active | NoneActive;

function expectedAt(module: ModuleId, call: Call): Expected | undefined {
  const body = checker.lookup.bodyHolding(module, call);
  const calls = body?.callsAt(call) ?? [];
  const [resolved, ...others] = calls;
  if (others.length > 0) {
    return {
      kind: 'none',
      labels: calls.map((each) => signatureOf(checker, each.function).label),
    };
  }
  if (resolved !== undefined) {
    const bound = parameterOfArgument(resolved.binding);
    const receivers = resolved.receiver === undefined ? 0 : 1;
    const names = resolved.function.parameters.map((parameter) =>
      parameter.kind === 'Parameter'
        ? `${parameter.isRest ? '...' : ''}${parameter.name?.text}:`
        : '',
    );
    return {
      kind: 'active',
      label: (label) => label.includes(`${resolved.function.name.text}`),
      parameter: (argument) => {
        const index = bound.get(argument + receivers);
        return index === undefined ? undefined : names[index];
      },
    };
  }
  const callee = body?.valueCalls.has(call)
    ? body.typeOf(withoutTypeArguments(call.callee))
    : undefined;
  const type =
    call.isOptional && callee
      ? wellKnownArguments(checker, wellKnown.optional, callee)?.[0]
      : callee;
  if (type?.kind !== 'function') {
    return undefined;
  }
  return {
    kind: 'active',
    // Spelled out, never as an alias the type was written through: help marks its parameters.
    label: (label) => label === typeText({ ...type, alias: undefined }),
    parameter: (argument) => {
      const slot = type.parameters[argument];
      return slot === undefined ? undefined : `${slot.reference ? '&' : ''}${typeText(slot.type)}`;
    },
  };
}

/**
 * Where `help` at the written argument `argument` isn't what `expected` says; empty where it is.
 */
function mismatchOf(help: SignatureHelp | null, expected: Expected, argument: number): string {
  if (expected.kind === 'none') {
    const shown = help?.signatures.map((signature) => signature.label) ?? [];
    const fits =
      help?.activeSignature === undefined &&
      help?.activeParameter === null &&
      expected.labels.every((each) => shown.includes(each));
    return fits ? '' : `${JSON.stringify(help)} ≠ none active of ${expected.labels.join(', ')}`;
  }
  const { label, parameter } = activeOf(help);
  const wanted = expected.parameter(argument);
  const fits = expected.label(label) && (wanted === undefined || parameter.startsWith(wanted));
  return fits ? '' : `${label} [${parameter}] ≠ ${wanted}`;
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
        const help = await client.connection.sendRequest(SignatureHelpRequest.type, {
          textDocument: { uri },
          position,
        });
        const mismatch = mismatchOf(help, expected, index);
        return mismatch === '' ? [] : [`${position.line}:${position.character} ${mismatch}`];
      }),
    );
    expect(wrong.flat()).toEqual([]);
  });

  it.each(argumentEnds)('$uri $at, the call left open', async ({ uri, source, end }) => {
    expect(await leftOpenMismatch(uri, source, end)).toEqual([]);
  });

  it("marks none active where a field loop's passes call different functions", async () => {
    const [{ uri, tree } = unreachable('No corpus document.')] = documents.filter((each) =>
      each.uri.startsWith('file:'),
    );
    const text = [
      'struct Pair:',
      '  a: Int',
      '  b: String',
      'fn show(x: Int) -> Int: 1',
      'fn show(x: String) -> Int: 2',
      'fn f(p: Pair) -> Int:',
      '  let n = 0',
      '  for k, v in ...p:',
      '    n += show(v)',
      '  n',
      '',
    ].join('\n');
    const at = text.indexOf('show(v)') + 'show('.length;
    await client.change(uri, text);
    const help = await client.connection.sendRequest(SignatureHelpRequest.type, {
      textDocument: { uri },
      position: rangeOf(createSourceText(uri, text), { start: at, end: at }).start,
    });
    await client.change(uri, tree.source.text);
    const none: NoneActive = {
      kind: 'none',
      labels: ['fn show(x: Int) -> Int', 'fn show(x: String) -> Int'],
    };
    expect(mismatchOf(help, none, 0)).toBe('');
  });
});
