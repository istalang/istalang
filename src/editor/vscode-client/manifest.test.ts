/**
 * The extension's manifest (.vscode/extensions/ista/package.json) makes the extension the formatter
 * of Istalang documents: the server formats (lsp/providers/formatting.ts), but VS Code picks a
 * formatter by extension id, so the manifest names its own id as the language's default.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(
  readFileSync(new URL('../../../.vscode/extensions/ista/package.json', import.meta.url), 'utf8'),
);

describe('the extension manifest', () => {
  it('names the extension itself as the default formatter of Istalang documents', () => {
    const id = `${manifest.publisher}.${manifest.name}`;
    expect(manifest.contributes.configurationDefaults['[ista]']['editor.defaultFormatter']).toBe(
      id,
    );
    expect(manifest.categories).toContain('Formatters');
  });
});
