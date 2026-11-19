/**
 * Programs bound with the real prelude, and what tests observe of them: the binder's diagnostics
 * per module, which declaration a name resolves to, and every name resolved over the corpus.
 *
 * A resolution is asserted as "the n-th `x` in this module resolves to the m-th `x`", identifiers
 * found by their text in source order, so a test reads as its source and needs no offsets.
 */

import namesLib from '../../../test/corpus/names/lib.ista';
import namesMain from '../../../test/corpus/names/main.ista';
import { invalidPrograms, runPrograms } from '../../../test/corpus/programs.ts';
import { type Reported, reportedIn } from '../../foundation/diagnostics/diagnostic.test-kit.ts';
import { memo } from '../../foundation/structures/memo.ts';
import { preludeModule, stdlibLoader, stdRoles } from '../../stdlib/stdlib-loader.ts';
import type { Files, ProgramOfOptions } from '../program/program.test-kit.ts';
import { idOf, moduleAt, programOf } from '../program/program.test-kit.ts';
import { type ModuleId, type Program, programModule } from '../program/program.ts';
import { nodesUnder, parentOf } from '../syntax/tree/index.ts';
import type { Identifier } from '../syntax/tree/node.ts';
import { bindProgram } from './bind.ts';
import type { Entity } from './entities.ts';

/**
 * The program rooted at the first of `files`, with the prelude. Without a `previous`, the prelude
 * is parsed once per test file, not per program.
 */
export function preludeProgramOf(files: Files, previous?: Program): Program {
  const options = { roles: { prelude: preludeModule() } };
  return programOf(files, {
    ...options,
    previous: previous ?? reusedBase('prelude-only', options),
  });
}

/**
 * The program rooted at the first of `files` as an app loads it: with every std module. Without a
 * `previous`, the std modules every program loads are parsed once per test file, not per program.
 */
export function stdProgramOf(files: Files, previous?: Program): Program {
  const options = { roles: stdRoles(), loaders: [stdlibLoader()] };
  return programOf(files, { ...options, previous: previous ?? reusedBase('std-only', options) });
}

const bases = new Map<string, Program>();

/**
 * A program of nothing but what `options` loads beside an empty module named `name`, made once per
 * test file: a `previous` whose trees every program loaded alike reuses.
 */
function reusedBase(name: string, options: ProgramOfOptions): Program {
  return memo(bases, name, () => programOf({ [`${name}.ista`]: '' }, options));
}

/** What the binder reported in module `key` (default: the first file). */
export function boundReport(files: Files, key = Object.keys(files)[0] ?? ''): Reported {
  const program = preludeProgramOf(files);
  return reportedIn(
    moduleAt(program, key).tree.source,
    bindProgram(program).diagnosticsOf(idOf(key)),
  );
}

/** The identifiers spelled `text` in module `key`, in source order. */
export function namesIn(program: Program, key: string, text: string): readonly Identifier[] {
  const { tree } = moduleAt(program, key);
  return nodesUnder(tree, tree.root).filter(
    (node): node is Identifier => node.kind === 'Identifier' && node.text === text,
  );
}

/** What the `index`-th `text` of module `key` denotes. */
export function entityOfName(
  program: Program,
  key: string,
  text: string,
  index: number,
): Entity | undefined {
  const name = namesIn(program, key, text)[index];
  return name === undefined ? undefined : bindProgram(program).entityOf(idOf(key), name);
}

/** The name an entity was declared with; undefined for a primitive or a set of candidates. */
export function declaringName(entity: Entity | undefined): Identifier | undefined {
  switch (entity?.kind) {
    case 'variable':
      return entity.name;
    case 'functions':
      return entity.overloads[0]?.name;
    case 'type':
      return entity.declaration.name;
    case 'variant':
      return entity.variant.name;
    case 'self':
      return entity.trait.name;
    case 'namespace':
      return entity.imported.alias;
    default:
      return;
  }
}

/** A name the binder resolved, and what it denotes. */
interface ResolvedName {
  readonly module: ModuleId;
  readonly name: Identifier;
  readonly entity: Entity;
}

/** Every name of `module` the binder resolved, in source order. */
export function resolvedNames(program: Program, module: ModuleId): readonly ResolvedName[] {
  const bindings = bindProgram(program);
  const { tree } = programModule(program, module);
  return nodesUnder(tree, tree.root).flatMap((name) => {
    const entity = name.kind === 'Identifier' ? bindings.entityOf(module, name) : undefined;
    return name.kind === 'Identifier' && entity !== undefined ? [{ module, name, entity }] : [];
  });
}

/** A program of the corpus, and the modules of it to observe. */
export interface CorpusProgram {
  readonly program: Program;
  readonly modules: readonly ModuleId[];
}

/**
 * The corpus, bound: each corpus program, the modules of `names/` importing each other, and every
 * std module once.
 */
export function boundCorpus(): readonly CorpusProgram[] {
  const programs = [...runPrograms, ...invalidPrograms].map(({ text }) => ({
    program: stdProgramOf({ main: text }),
    modules: [idOf('main')],
  }));
  const names = stdProgramOf({ 'names/main': namesMain, 'names/lib': namesLib });
  const std = stdProgramOf({ main: '' });
  const stdModules = [...std.modules.values()].filter(({ isStd }) => isStd).map(({ id }) => id);
  return [
    ...programs,
    { program: names, modules: [idOf('names/main'), idOf('names/lib')] },
    { program: std, modules: stdModules },
  ];
}

const bindingPatterns = new Set(['NamePattern', 'BindFieldPattern', 'AsPattern', 'RestPattern']);

/**
 * Whether `resolved` names its entity by looking it up: not a part after the head of a qualified
 * name, which linking walks to; not a call only argument-dependent lookup can resolve; not an
 * async function's name denoting its own call (§16); and not a name that declares, every overload's
 * own included.
 */
export function isLookedUp(program: Program, { module, name, entity }: ResolvedName): boolean {
  const parent = parentOf(programModule(program, module).tree, name);
  const isTail =
    (parent?.kind === 'MemberAccess' && parent.member === name) ||
    ((parent?.kind === 'NamedType' || parent?.kind === 'NamePattern') &&
      parent.path.indexOf(name) > 0);
  const isDeclaring =
    declaringName(entity) === name ||
    (entity.kind === 'functions' && entity.overloads.some((overload) => overload.name === name)) ||
    (entity.kind === 'variable' && bindingPatterns.has(parent?.kind ?? ''));
  const isOwnCall = entity.kind === 'variable' && entity.owner.kind === 'OwnCall';
  const findsNoOverload = entity.kind === 'functions' && entity.overloads.length === 0;
  return !(isTail || isDeclaring || isOwnCall || findsNoOverload);
}
