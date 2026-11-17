/**
 * Completion scenarios RB-10 to RB-13 and VC-01 to VC-03 of docs/work/done/completion/: the ones about
 * the protocol (positions past the end, unknown, burst-edited and untitled documents) and the VS
 * Code extension's settings, which no snippet can state. The extension's word pattern is JSON that
 * can't import the scanner, so VC-03 holds it to the scanner's identifiers. A test named `<ID>
 * <title>` pinned with `fails` is a scenario not met yet.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type CompletionItem,
  type CompletionList,
  CompletionRequest,
  CompletionTriggerKind,
  HoverRequest,
} from 'vscode-languageserver/node';
import { corpusDirectory } from '../../../../test/corpus/programs.ts';
import { identifierRunEnd, isIdentifierStart } from '../../../compiler/scanner/characters.ts';
import { completionClient } from './completion-scenarios.test-kit.ts';

const extension = new URL('../../../../.vscode/extensions/ista/', import.meta.url);
const readJson = (name: string) => JSON.parse(readFileSync(new URL(name, extension), 'utf8'));
const defaults = () => readJson('package.json').contributes.configurationDefaults['[ista]'];

const body = 'struct Pair:\n  first: Int\n\nfn g(p: Pair) -> Int:\n  p.\n  0\n';
const afterDot = body.indexOf('p.\n  0') + 2;
const positionAfterDot = (text: string) => {
  const lines = text.slice(0, afterDot).split('\n');
  return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 };
};
const dotRequest = (uri: string) => ({
  textDocument: { uri },
  position: positionAfterDot(body),
  context: { triggerKind: CompletionTriggerKind.TriggerCharacter, triggerCharacter: '.' },
});
const labelsOf = (reply: CompletionItem[] | CompletionList | null) =>
  (Array.isArray(reply) ? reply : (reply?.items ?? [])).map(({ label }) => label);

const use = completionClient();

describe('completion scenarios over the protocol', () => {
  it('RB-10 a position past the end is answered, not an error', async () => {
    const uri = pathToFileURL(`${corpusDirectory}completion-past-end.ista`).href;
    await use().open(uri, 'fn g():\n  1\n');
    const ask = (position: { line: number; character: number }) =>
      use().connection.sendRequest(CompletionRequest.type, { textDocument: { uri }, position });
    await expect(ask({ line: 9999, character: 0 })).resolves.toBeDefined();
    await expect(ask({ line: 0, character: 9999 })).resolves.toBeDefined();
  });

  it('RB-11 unknown document gives an empty list, not an error', async () => {
    const reply = await use().connection.sendRequest(CompletionRequest.type, {
      textDocument: { uri: pathToFileURL(`${corpusDirectory}never-opened.ista`).href },
      position: { line: 0, character: 0 },
    });
    expect(labelsOf(reply)).toEqual([]);
  });

  it('RB-12 the latest text answers after a burst of edits', async () => {
    const uri = pathToFileURL(`${corpusDirectory}completion-burst.ista`).href;
    await use().open(uri, body.replace('p.\n', 'p\n'));
    await use().change(uri, body.replace('p.\n', 'p.x\n'));
    await use().change(uri, body.replace('p.\n', 'p.first\n'));
    await use().change(uri, body);
    const reply = await use().connection.sendRequest(CompletionRequest.type, dotRequest(uri));
    expect(labelsOf(reply)).toContain('first');
  });

  it('RB-13 an untitled document gets completion', async () => {
    const uri = 'untitled:Untitled-1';
    await use().open(uri, body);
    const reply = await use().connection.sendRequest(CompletionRequest.type, dotRequest(uri));
    expect(labelsOf(reply)).toContain('first');
    const atParameter = { line: body.split('\n').indexOf('  p.'), character: 2 };
    const hover = await use().connection.sendRequest(HoverRequest.type, {
      textDocument: { uri },
      position: atParameter,
    });
    expect(hover).not.toBeNull();
  });

  it('VC-01 [ista] turns word-based suggestions off', () => {
    expect(defaults()['editor.wordBasedSuggestions']).toBe('off');
  });

  it('VC-02 [ista] states quick suggestions', () => {
    expect(defaults()['editor.quickSuggestions']).toBeDefined();
  });

  it('VC-03 the language configuration declares a word pattern', () => {
    const word = new RegExp(`^(?:${readJson('language-configuration.json').wordPattern})$`, 'u');
    const scansAsName = (text: string) =>
      isIdentifierStart(text[0]) && identifierRunEnd(text, 0) === text.length;
    const characters = fc.constantFrom('a', 'z', 'A', 'Z', '_', '0', '9', '-', '$', 'é', ' ');
    fc.assert(
      fc.property(fc.string({ unit: characters }), (text) => {
        expect(word.test(text)).toBe(scansAsName(text));
      }),
    );
  });
});
