/**
 * A hover's Markdown: the code fenced, a line linking each declared type it names to where that
 * is declared, then what documents it. What every hover shows is hover.sweep.test.ts's.
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HoverRequest, MarkupContent } from 'vscode-languageserver/node';
import { tempProject } from '../../../project/project.test-kit.ts';
import { openLocationTarget } from '../client-protocol.ts';
import { fileUriOf } from '../diagnostics.test-kit.ts';
import { connectedClient, sharedClient } from '../server.test-kit.ts';

const text = [
  'struct Point:',
  '  x: Int',
  '',
  '# Where it ends up.',
  'fn moved(p: Point) -> Point: p',
  '',
  'fn main() -> Int: moved(Point{x: 1}).x',
  '',
].join('\n');

const root = tempProject({ 'main.ista': text });
const uri = fileUriOf(join(root, 'main.ista'));
const client = sharedClient(() => connectedClient(root));

describe('a hover', () => {
  it('fences its code, links the declared types it names, then documents it', async () => {
    await client().open(uri, text);
    const hover = await client().connection.sendRequest(HoverRequest.type, {
      textDocument: { uri },
      position: { line: 6, character: 19 },
    });
    const value = hover !== null && MarkupContent.is(hover.contents) ? hover.contents.value : '';
    expect(value).toBe(
      [
        '```ista',
        'fn moved(p: Point) -> Point',
        '```',
        '',
        `Go to: [Point](${openLocationTarget([uri, 0, 7])})`,
        '',
        'Where it ends up.',
      ].join('\n'),
    );
  });
});
