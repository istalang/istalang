/**
 * Renaming a declaration: every name denoting it, in every module, spelled anew.
 *
 * A shorthand names a field and a variable at once (`Pair{first}`, `case Pair{first}:`), so
 * renaming either spells the shorthand out (`first: renamed`, `first as renamed`). What renaming at
 * a name renames is what finding its references finds (declarations.ts `NameAt.targets`).
 *
 * A rename that could change what a program means, rather than how it is spelled, is refused
 * (human decision, 2026-10-29), with the reason:
 * - a declaration of a std module, which the toolchain ships;
 * - a declaration some name denotes together with another of that name, as an import names every
 *   overload of a function: renaming one alone would part them;
 * - a function or field named like a member of a trait, or like a function the language calls by
 *   name (`main`, the JSON codecs): a type meets a trait through such names (§3.10), so renaming
 *   one could change which traits a type meets; and a parameter named `self`, which makes its
 *   function a method (§3.7). A new name of that kind is refused for the same reason;
 * - a new name that isn't one, is the unnamed `_` or a built-in type's (§2), or changes the old
 *   name's privacy (§3.13) or case (§2), which also decides what a bare name in a pattern does
 *   (§3.11).
 */

import {
  isStdModule,
  type ModuleId,
  type Program,
  programModule,
} from '../../compiler/program/program.ts';
import { identifierRunEnd, isIdentifierStart } from '../../compiler/scanner/characters.ts';
import type { Identifier } from '../../compiler/syntax/node.ts';
import { isKeyword } from '../../compiler/syntax/tokens.ts';
import { parentOf } from '../../compiler/syntax/tree.ts';
import {
  bindsInPattern,
  type Convention,
  followsConvention,
  isBuiltInTypeName,
  isPrivate,
  isUnnamed,
} from '../../language/naming.ts';
import { codecFunctions, entryFunction, receiverParameter } from '../../language/well-known.ts';
import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import { memo } from '../../structures/memo.ts';
import type { Span } from '../../text/span.ts';
import { type DeclaredAt, isSamePlace, type NamePlace, nameAt, spanOfUse } from './declarations.ts';
import { namesDenoting } from './references.ts';

/** What renaming a name renames, or why it can't be renamed. */
export type Renaming =
  | { readonly kind: 'renamable'; readonly name: Identifier; readonly target: DeclaredAt }
  | Refusal;

/** Why a rename can't be made, as the editor's user reads it. */
export interface Refusal {
  readonly kind: 'refused';
  readonly reason: string;
}

/** What a rename changes: names of modules, each spelled anew. */
export interface Renamed {
  readonly kind: 'renamed';
  readonly edits: readonly NameEdit[];
}

/** One name of a module, spelled anew. */
export interface NameEdit {
  readonly module: ModuleId;
  readonly span: Span;
  readonly text: string;
}

/** What renaming the name at `offset` of `module` renames; undefined where no name stands. */
export function renamingAt(
  program: Program,
  module: ModuleId,
  offset: number,
): Renaming | undefined {
  const named = nameAt(program, module, offset);
  if (named === undefined) {
    return undefined;
  }
  const {
    name,
    targets: [target, ...others],
  } = named;
  if (target === undefined || others.length > 0) {
    return refused(
      target === undefined
        ? `\`${name.text}\` names no declaration that can be renamed.`
        : `\`${name.text}\` names several declarations here; rename one where it is declared.`,
    );
  }
  const declared = asDeclared(program, target);
  const reason = targetRefusal(program, declared);
  return reason === undefined ? { kind: 'renamable', name, target: declared } : refused(reason);
}

/**
 * `target` as its declaring name declares it: a declaration read through a copy of its name, as an
 * async function's own call reads the function's, is judged by what it is where it is declared.
 */
function asDeclared(program: Program, target: DeclaredAt): DeclaredAt {
  const { at } = target;
  const there = nameAt(program, at.module, spanOfUse(program, at).start)?.targets;
  return there?.find((each) => isSamePlace(each.at, at)) ?? target;
}

/** The edits renaming the name at `offset` of `module` to `newName`, or why they can't be made. */
export function renameEdits(
  program: Program,
  module: ModuleId,
  offset: number,
  newName: string,
): Renamed | Refusal | undefined {
  const renaming = renamingAt(program, module, offset);
  if (renaming?.kind !== 'renamable') {
    return renaming;
  }
  const { target } = renaming;
  const reason = newNameRefusal(program, target, newName);
  if (reason !== undefined) {
    return refused(reason);
  }
  const edits = namesDenoting(program, target.at).map((use) => ({
    module: use.module,
    span: spanOfUse(program, use),
    text: spelledAnew(program, use, target, newName),
  }));
  return { kind: 'renamed', edits };
}

function refused(reason: string): Refusal {
  return { kind: 'refused', reason };
}

function targetRefusal(program: Program, { declared, at }: DeclaredAt): string | undefined {
  const { text } = at.name;
  if (isStdModule(program, at.module)) {
    return `\`${text}\` is declared in \`${at.module}\`, which the toolchain ships.`;
  }
  if (meansMore(program, declared, text)) {
    return meaningRefusal(text);
  }
  const isNamedWithOthers = namesDenoting(program, at).some(
    (use) => (nameAt(program, use.module, spanOfUse(program, use).start)?.targets.length ?? 0) > 1,
  );
  return isNamedWithOthers
    ? `\`${text}\` is named together with another declaration of that name, as an import names every overload; renaming one alone would part them.`
    : undefined;
}

const conventions: readonly Convention[] = ['type', 'value'];

function newNameRefusal(
  program: Program,
  { declared, at }: DeclaredAt,
  newName: string,
): string | undefined {
  const old = at.name.text;
  if (!isName(newName) || isUnnamed(newName)) {
    return `\`${newName}\` is not a name a declaration can have.`;
  }
  if (isBuiltInTypeName(newName)) {
    return `\`${newName}\` names a built-in type, which no declaration can take (§2).`;
  }
  if (meansMore(program, declared, newName)) {
    return meaningRefusal(newName);
  }
  if (isPrivate(old) !== isPrivate(newName)) {
    return `A leading \`_\` makes a name private (§3.13); \`${newName}\` would change whether \`${old}\` is.`;
  }
  const keepsCase =
    bindsInPattern(old) === bindsInPattern(newName) &&
    conventions.every((each) => !followsConvention(old, each) || followsConvention(newName, each));
  return keepsCase
    ? undefined
    : `\`${newName}\` is cased unlike \`${old}\`, and case decides what a name is (§2, §3.11).`;
}

/** Whether `text` scans as one identifier and nothing else. */
function isName(text: string): boolean {
  return (
    isIdentifierStart(text[0]) && identifierRunEnd(text, 0) === text.length && !isKeyword(text)
  );
}

function meaningRefusal(name: string): string {
  return `The language reads \`${name}\` by name: a type may meet a trait through it (§3.10), a function be a method by it (§3.7), or the language call it; renaming could change what the program does.`;
}

/** A name a declaration may have, in the program that has it. */
interface Naming {
  readonly program: Program;
  readonly name: string;
}

/**
 * Per kind of declaration, whether it means more than what names it, so named: a function or field
 * through which a type may meet a trait or the language calls, or a parameter making its function a
 * method.
 */
const meansMoreAs: Handlers<Naming, DeclaredAt['declared'], [], boolean> = {
  variable: ({ name }) => name === receiverParameter,
  function: ({ program, name }) => namesCalledByName(program).has(name),
  field: ({ program, name }) => namesCalledByName(program).has(name),
  variant: () => false,
  type: () => false,
  namespace: () => false,
};

function meansMore(program: Program, declared: DeclaredAt['declared'], name: string): boolean {
  return handlerOf(meansMoreAs, declared)({ program, name }, declared);
}

const calledByName = new WeakMap<Program, ReadonlySet<string>>();

/** What any trait of `program` requires, and the functions the language calls by name. */
function namesCalledByName(program: Program): ReadonlySet<string> {
  return memo(
    calledByName,
    program,
    () =>
      new Set([
        entryFunction,
        ...Object.values(codecFunctions),
        ...[...program.modules.values()].flatMap(({ tree }) =>
          tree.root.items.flatMap((item) =>
            item.kind === 'TraitDeclaration'
              ? item.members.flatMap((member) =>
                  member.kind === 'Invalid' ? [] : [member.name.text],
                )
              : [],
          ),
        ),
      ]),
  );
}

/** How `use` is spelled once its target is renamed to `newName`: a shorthand spelled out. */
function spelledAnew(
  program: Program,
  use: NamePlace,
  { declared }: DeclaredAt,
  newName: string,
): string {
  const old = use.name.text;
  const holder = parentOf(programModule(program, use.module).tree, use.name);
  const isField = declared.kind === 'field';
  if (holder?.kind === 'FieldInitializer' && holder.value === undefined) {
    return isField ? `${newName}: ${old}` : `${old}: ${newName}`;
  }
  if (holder?.kind === 'BindFieldPattern' && holder.alias === undefined) {
    return isField ? `${newName} as ${old}` : `${old} as ${newName}`;
  }
  return newName;
}
