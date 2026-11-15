/**
 * The std's extern functions as the runtime binds them: each under the key lowering gives its
 * declaration, so a test reads what the checker knows of one by the key a Definition's entry names,
 * such as what its parameters keep (docs/work/static-lifetimes/design.md §6.6).
 */

import type { Checker } from '../compiler/checker/check.ts';
import { keyOf } from '../compiler/lowering/tables/extern-keys.ts';
import {
  declaredFunctions,
  type FunctionDeclaration,
} from '../compiler/syntax/declarations/index.ts';
import type { NativeKeeps } from '../runtime/lifetimes/native-audit.test-kit.ts';
import { everyStdModule } from './std-modules.test-kit.ts';

/** A std extern function: its key, its module's name, and its declaration. */
interface StdExtern {
  readonly key: string;
  readonly module: string;
  readonly declaration: FunctionDeclaration;
}

interface StdExterns {
  readonly checker: Checker;
  readonly externs: readonly StdExtern[];
}

/** Every extern function the std modules declare, checked in one program. */
export function stdExterns(): StdExterns {
  const { checker, modules } = everyStdModule();
  const externs = modules.flatMap(([, module]) =>
    declaredFunctions(module.tree.root).flatMap((declaration) =>
      declaration.isExtern
        ? [
            {
              key: keyOf(checker, declaration, checker.parametersOf(declaration)),
              module: module.name,
              declaration,
            },
          ]
        : [],
    ),
  );
  return { checker, externs };
}

/** What each std extern's parameters keep, by its key. */
export function stdNativeKeeps({ checker, externs }: StdExterns = stdExterns()): NativeKeeps {
  return new Map(externs.map(({ key, declaration }) => [key, checker.keepsOf(declaration)]));
}
