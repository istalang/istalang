/** Every std module in one program, for tests that hold a rule over all of them. */

import { stdProgramOf } from '../compiler/binder/bind.test-kit.ts';
import { type Checker, checkProgram } from '../compiler/checker/check.ts';
import type { ModuleId, ProgramModule } from '../compiler/program/program.ts';
import { languageModules } from '../foundation/language/well-known/index.ts';
import { stdModuleSources } from './std-sources.ts';

interface EveryStdModule {
  readonly checker: Checker;
  /** Each std module the program loaded, the prelude included, by id. */
  readonly modules: readonly (readonly [ModuleId, ProgramModule])[];
}

/** A program importing every std module an import can name, checked. */
export function everyStdModule(): EveryStdModule {
  const imports = Object.keys(stdModuleSources)
    .filter((name) => name !== languageModules.prelude)
    .map((name) => `import * as ${name} from '${name}'`);
  const program = stdProgramOf({ main: imports.join('\n') });
  const modules = [...program.modules].filter(([, module]) => module.isStd);
  return { checker: checkProgram(program), modules };
}
