/**
 * Signature help at every argument of every call over the corpus and std modules, through the
 * protocol: a call resolved to a function shows it, its active parameter the one the call's
 * binding passes the argument to, a method's receiver aside; a call of a function value shows
 * its type, the argument's own parameter active.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { type SignatureHelp, SignatureHelpRequest } from 'vscode-languageserver/node';
import { checkProgram } from '../../compiler/checker/check.ts';
import { parameterOfArgument } from '../../compiler/checker/resolved-call.ts';
import { typeText } from '../../compiler/checker/types/type-text.ts';
import { wellKnownArguments } from '../../compiler/checker/types/well-known.ts';
import type { ModuleId } from '../../compiler/program/program.ts';
import type { Call } from '../../compiler/syntax/expressions/index.ts';
import { nodesUnder } from '../../compiler/syntax/tree.ts';
import { wellKnown } from '../../language/well-known.ts';
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
        ? `${parameter.isRest ? '...' : ''}${parameter.name.text}:`
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

describe('signature help over the corpus', () => {
  it.each(documents)('$uri', async ({ uri, module, tree }) => {
    const asked = nodesUnder(tree.root).flatMap((node) => {
      const expected = node.kind === 'Call' ? expectedAt(module, node) : undefined;
      return node.kind === 'Call' && expected !== undefined
        ? node.arguments.map((argument, index) => ({ at: argument.span.start, index, expected }))
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
});
