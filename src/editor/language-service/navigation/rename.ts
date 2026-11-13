/**
 * Renaming a declaration: every name denoting it, in every module, spelled anew, a key naming a
 * field among them (§3.1 Key types).
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
 * - a function, field or associated type named like a member of a trait, a field named like an
 *   entry of a struct constraint, or like a function the language calls by name (`main`, the JSON
 *   codecs): a type meets a trait or a struct constraint through such names (§3.5, §3.10), so
 *   renaming one could change which it meets; and a parameter named
 *   `self`, which makes its function a method (§3.7). A new name of that kind is refused for the
 *   same reason;
 * - a field of a shape, which is one type with every shape of its fields wherever written (§3.1),
 *   and a field of a struct or shared struct whose field names another writer of that shape has,
 *   which its value or `*x` may fit (§3.18): renaming one place would part it from the others;
 * - a new name that isn't one, is the unnamed `_` or a built-in type's (§2), or changes the old
 *   name's privacy (§3.13) or case (§2), which also decides what a bare name in a pattern does
 *   (§3.11).
 */

import {
  isStdModule,
  type ModuleId,
  type Program,
  programModule,
} from '../../../compiler/program/program.ts';
import { spellsName } from '../../../compiler/scanner/characters.ts';
import type { Field } from '../../../compiler/syntax/declarations/index.ts';
import type { FieldsLiteral, IndentedEntry } from '../../../compiler/syntax/expressions/index.ts';
import { formOf } from '../../../compiler/syntax/expressions/literals/indented-values.ts';
import {
  childrenOf,
  nodesUnder,
  parentOf,
  type SyntaxNode,
} from '../../../compiler/syntax/tree/index.ts';
import type { Invalid } from '../../../compiler/syntax/tree/node.ts';
import {
  bindsInPattern,
  type Convention,
  followsConvention,
  isBuiltInTypeName,
  isPrivate,
  isUnnamed,
} from '../../../foundation/language/naming.ts';
import { compareOrdered } from '../../../foundation/language/order.ts';
import { codecFunctions } from '../../../foundation/language/well-known/codecs.ts';
import { entryFunction, receiverParameter } from '../../../foundation/language/well-known/index.ts';
import { type Handlers, handlerOf } from '../../../foundation/structures/kind-table.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import type { Span } from '../../../foundation/text/span.ts';
import {
  type DeclaredAt,
  isSamePlace,
  type NamePlace,
  nameAt,
  spanOfUse,
  spelledName,
  type WrittenName,
} from './declarations.ts';
import { namesDenoting } from './references.ts';

/** What renaming a name renames, or why it can't be renamed. */
type Renaming =
  | { readonly kind: 'renamable'; readonly name: WrittenName; readonly target: DeclaredAt }
  | Refusal;

/** Why a rename can't be made, as the editor's user reads it. */
export interface Refusal {
  readonly kind: 'refused';
  readonly reason: string;
}

/** What a rename changes: names of modules, each spelled anew. */
interface Renamed {
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
        ? `\`${spelledName(name)}\` names no declaration that can be renamed.`
        : `\`${spelledName(name)}\` names several declarations here; rename one where it is declared.`,
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
  const text = spelledName(at.name);
  if (isStdModule(program, at.module)) {
    return `\`${text}\` is declared in \`${at.module}\`, which the toolchain ships.`;
  }
  if (meansMore(program, declared, text)) {
    return meaningRefusal(text);
  }
  if (declared.kind === 'field' && sharesShape(program, at)) {
    return `\`${text}\` names a field of a shape, which is one type wherever its fields are written (§3.1); renaming it here would part this place from the others.`;
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
  const old = spelledName(at.name);
  if (!spellsName(newName) || isUnnamed(newName)) {
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

function meaningRefusal(name: string): string {
  return `The language reads \`${name}\` by name: a type may meet a trait or a struct constraint through it (§3.5, §3.10), a function be a method by it (§3.7), or the language call it; renaming could change what the program does.`;
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
  type: ({ program, name }, { entity }) =>
    isAssociated(entity) && namesCalledByName(program).has(name),
  namespace: () => false,
};

/**
 * Whether `entity` is an associated type (§3.1), by whose name a type meets a trait's requirement.
 */
function isAssociated(
  entity: Extract<DeclaredAt['declared'], { kind: 'type' }>['entity'],
): boolean {
  return (
    entity.kind === 'type' &&
    (entity.declaration.kind === 'AssociatedType' ||
      entity.declaration.kind === 'RequiredAssociatedType')
  );
}

function meansMore(program: Program, declared: DeclaredAt['declared'], name: string): boolean {
  return handlerOf(meansMoreAs, declared)({ program, name }, declared);
}

const calledByName = new WeakMap<Program, ReadonlySet<string>>();

/**
 * What any trait of `program` requires, the fields any struct constraint names (§3.5: a struct
 * meets one by its fields' names, in a type `match` case too), and the functions the language
 * calls by name.
 */
function namesCalledByName(program: Program): ReadonlySet<string> {
  return memo(
    calledByName,
    program,
    () =>
      new Set([
        entryFunction,
        ...Object.values(codecFunctions),
        ...[...program.modules.values()].flatMap(({ tree }) => [
          ...tree.root.items.flatMap((item) =>
            item.kind === 'TraitDeclaration'
              ? item.members.flatMap((member) =>
                  member.kind === 'Invalid' ? [] : [member.name.text],
                )
              : [],
          ),
          ...nodesUnder(tree, tree.root).flatMap((node) =>
            node.kind === 'StructConstraint'
              ? node.entries.flatMap((entry) =>
                  entry.kind !== 'Invalid' && entry.field.kind === 'Identifier'
                    ? [entry.field.text]
                    : [],
                )
              : [],
          ),
        ]),
      ]),
  );
}

/**
 * Whether the field declared at `at` belongs to a shape, or to a declaration whose fields' names
 * another writer of a shape also has (§3.1, §3.18): a struct, whose value converts into its shape,
 * against a `{…}` type, a `struct{…}` literal or a shared struct, whose `*x` is one; a shared
 * struct against any of those, or against a struct, whose value may write its `*x`.
 */
function sharesShape(program: Program, at: NamePlace): boolean {
  const { tree } = programModule(program, at.module);
  const field = parentOf(tree, at.name);
  const holder = field === undefined ? undefined : parentOf(tree, field);
  if (holder?.kind === 'StructType') {
    return true;
  }
  if (holder?.kind !== 'StructDeclaration' && holder?.kind !== 'SharedStructDeclaration') {
    return false;
  }
  const writers = shapeWriters(program).get(fieldsKey(holder.fields));
  return holder.kind === 'StructDeclaration'
    ? (writers?.shapes ?? 0) > 0
    : (writers?.shapes ?? 0) > 1 || (writers?.structs ?? 0) > 0;
}

/** How many of a program's writers have one set of field names: shapes, and struct declarations. */
interface Writers {
  shapes: number;
  structs: number;
}

const writersByProgram = new WeakMap<Program, ReadonlyMap<string, Writers>>();

/**
 * The writers of each set of field names in a program, by its key: `{…}` types, `struct{…}`
 * literals and indented values of names naming no type (§2), and shared structs as shapes, struct
 * declarations apart.
 */
function shapeWriters(program: Program): ReadonlyMap<string, Writers> {
  return memo(writersByProgram, program, () => {
    const writers = new Map<string, Writers>();
    for (const { tree } of program.modules.values()) {
      const pending: SyntaxNode[] = [tree.root];
      for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
        const writer = writerOf(node);
        if (writer !== undefined) {
          memo(writers, writer.key, () => ({ shapes: 0, structs: 0 }))[writer.kind] += 1;
        }
        pending.push(...childrenOf(tree, node));
      }
    }
    return writers;
  });
}

/** The field names `node` writes a shape or a struct declaration with, as a key; else undefined. */
function writerOf(node: SyntaxNode): { key: string; kind: keyof Writers } | undefined {
  switch (node.kind) {
    case 'StructType': {
      const named = node.fields.filter((field) => field.kind !== 'MappedField');
      return named.length === node.fields.length
        ? { key: fieldsKey(named), kind: 'shapes' }
        : undefined;
    }
    case 'SharedStructDeclaration':
      return { key: fieldsKey(node.fields), kind: 'shapes' };
    case 'StructDeclaration':
      return { key: fieldsKey(node.fields), kind: 'structs' };
    case 'StructLiteral':
      return node.type === undefined ? shapeLiteralWriter(node.items) : undefined;
    case 'IndentedValue':
      return node.type === undefined && formOf(node) === 'struct'
        ? shapeLiteralWriter(node.entries)
        : undefined;
    default:
      return undefined;
  }
}

/** The shape the items of a `struct{…}` literal, or of an indented value of names, write. */
function shapeLiteralWriter(items: readonly (FieldsLiteral['items'][number] | IndentedEntry)[]): {
  key: string;
  kind: keyof Writers;
} {
  const named = items.flatMap((item) => (item.kind === 'FieldInitializer' ? [item.name.text] : []));
  return { key: namesKey(named), kind: 'shapes' };
}

/** The names of written fields as one key, as `namesKey` makes it. */
function fieldsKey(fields: readonly (Field | Invalid)[]): string {
  return namesKey(fields.flatMap((each) => (each.kind === 'Invalid' ? [] : [each.name.text])));
}

/** A set of field names as one key, in the name order a shape keeps them. */
function namesKey(names: readonly string[]): string {
  return names.toSorted(compareOrdered).join(',');
}

/**
 * How `use` is spelled once its target is renamed to `newName`: a shorthand spelled out, a key
 * naming a field as the String literal of the new name (§3.1 Key types).
 */
function spelledAnew(
  program: Program,
  use: NamePlace,
  { declared }: DeclaredAt,
  newName: string,
): string {
  if (use.name.kind === 'StringLiteral') {
    return JSON.stringify(newName);
  }
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
