/**
 * Diagnostics of binding names, codes 4000–4999 (§2, §3.1, §3.4, §3.11, §3.13, §7, §10).
 *
 * A name that resolves to nothing gets the most specific explanation the binder can give: it was
 * declared later in its block, in a block that has ended, or on one side of an `or`. Only when none
 * applies is it plainly undeclared. Each points at the name as written.
 */

import { defineDiagnostics } from '../../diagnostics/catalog.ts';
import { testModuleSuffix } from '../../language/well-known.ts';

export const binderDiagnostics = defineDiagnostics('binder', {
  undeclared: {
    code: 4000,
    message: (name: string) => `'${name}' is not declared.`,
  },
  assignmentToUndeclared: {
    code: 4001,
    message: (name: string) => `'${name}' is not declared; declare it with 'let' first.`,
  },
  usedBeforeDeclaration: {
    code: 4002,
    message: (name: string) => `'${name}' is used before its declaration.`,
  },
  blockEnded: {
    code: 4003,
    message: (name: string) => `'${name}' was declared in a block that has ended.`,
  },
  boundUnderOr: {
    code: 4004,
    message: (name: string) =>
      `'${name}' is bound on one side of 'or', so it isn't known to have matched here.`,
  },
  duplicateDeclaration: {
    code: 4005,
    message: (name: string) => `'${name}' is already declared here.`,
  },
  duplicateImport: {
    code: 4006,
    message: (name: string) => `'${name}' is imported twice.`,
  },
  importClash: {
    code: 4007,
    message: (name: string) => `'${name}' is both imported and declared in this module.`,
  },
  preludeClash: {
    code: 4008,
    message: (name: string) => `'${name}' is already a prelude name.`,
  },
  missingExport: {
    code: 4009,
    message: (module: string, name: string) => `Module '${module}' exports no '${name}'.`,
  },
  privateExport: {
    code: 4010,
    message: (module: string, name: string) =>
      `'${name}' is private to module '${module}': names starting with '_' aren't exported.`,
  },
  missingVariant: {
    code: 4011,
    message: (enumName: string, name: string) => `Enum '${enumName}' has no variant '${name}'.`,
  },
  typeNameConvention: {
    code: 4012,
    message: (name: string) => `Type names are PascalCase: '${name}'.`,
  },
  valueNameConvention: {
    code: 4013,
    message: (name: string) => `Names of values, functions and fields are camelCase: '${name}'.`,
  },
  unnamedRead: {
    code: 4014,
    message: () => `'_' holds a value without a name, so it can't be read.`,
  },
  testImport: {
    code: 4015,
    message: (module: string) =>
      `Only a test module, a file ending in '${testModuleSuffix}', may import '${module}'.`,
  },
  notOwnCall: {
    code: 4016,
    message: (name: string) =>
      `Before a '.', '${name}' is the call of an enclosing async fn named '${name}', and there is none.`,
  },
  mainNeverDisposed: {
    code: 4017,
    message: () => "Nothing holds the call of 'main', so 'main.disposing()' would never resolve.",
  },
  qualifiesNothing: {
    code: 4018,
    message: (name: string) =>
      `'${name}' is no module's namespace or enum, so no name follows its '.'.`,
  },
});
