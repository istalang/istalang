/**
 * The modules the toolchain ships check clean: a compile doesn't check them again
 * (compiler/compile.ts `diagnose`), so this is where a mistake in one would show.
 */

import { describe, expect, it } from 'vitest';
import { wholeProgramTimeout } from '../compiler/compile.test-kit.ts';
import { everyStdModule } from './std-modules.test-kit.ts';
import { stdModules } from './std-modules.ts';

describe('std modules', () => {
  it('all load into a program importing each', () => {
    const loaded = everyStdModule().modules.map(([, module]) => module.name);
    expect(new Set(loaded)).toEqual(new Set(stdModules.map((module) => module.name)));
  });

  it('check without a diagnostic', { timeout: wholeProgramTimeout }, () => {
    const { checker, modules } = everyStdModule();
    for (const [id, module] of modules) {
      const diagnostics = [...module.tree.diagnostics, ...checker.diagnosticsOf(id)];
      expect(
        diagnostics.map(({ code, message }) => `${code} ${message}`),
        module.name,
      ).toEqual([]);
    }
  });
});
