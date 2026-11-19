/**
 * What the package exports to hosts (spec §17.3): every subpath in package.json's `exports` ships both
 * its JavaScript and its declarations, and the JavaScript has every value its declarations name,
 * so a host compiling against the declarations finds them at run time.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Manifest {
  readonly exports: Readonly<Record<string, { readonly types: string; readonly default: string }>>;
}

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as Manifest;
const declaredValue = /^export declare (?:function|class|const) (?<name>\w+)/gmu;

describe('the package exports', () => {
  it.each(Object.entries(manifest.exports))(
    '%s ships its JavaScript and declarations, with every value declared',
    async (_subpath, { types, default: javascript }) => {
      const declarations = new URL(types, root);
      const code = new URL(javascript, root);
      expect(existsSync(declarations)).toBe(true);
      expect(existsSync(code)).toBe(true);
      const names = [...readFileSync(declarations, 'utf8').matchAll(declaredValue)].map(
        (match) => match.groups?.name,
      );
      expect(names.length).toBeGreaterThan(0);
      const loaded = (await import(code.href)) as Record<string, unknown>;
      for (const name of names) {
        expect(loaded[name ?? ''], name).toBeDefined();
      }
    },
  );
});
