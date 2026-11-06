/**
 * What a name declares or refers to, found where it is declared: the name declaring it.
 *
 * The identifier query (checker denotation.ts) answers what a name denotes; this module adds where
 * that was declared. A declaring name is also how navigation tells declarations apart: every
 * declaration has one, whatever its kind, while the checker's answers for a field are made per
 * type, so two answers for one field may differ where its declaring name doesn't. A primitive
 * type, `Self` and a field of a struct literal's own type have no declaring name, so nothing can
 * go to them, find them or rename them. A declaring name is told apart by where it stands, not by
 * its node: an async function's own call, a variable, is declared by a copy of the function's name.
 *
 * A renaming import's alias (§3.13) binds a name of its own to the export: going to a definition
 * reaches the export, while finding references and renaming act on the alias, declared at the
 * alias, so renaming either leaves the other's names alone (`actedOnBy`).
 */

import { type Checker, checkProgram } from '../../compiler/checker/check.ts';
import type { Denotation } from '../../compiler/checker/surface/denotation.ts';
import { type ModuleId, type Program, programModule } from '../../compiler/program/program.ts';
import type { StringLiteral } from '../../compiler/syntax/expressions/literals/literals.ts';
import { type Identifier, isMissingName } from '../../compiler/syntax/tree/node.ts';
import { spanIn, startTogether } from '../../compiler/syntax/tree/positions.ts';
import { type Handlers, handlerOf } from '../../structures/kind-table.ts';
import type { Span } from '../../text/span.ts';
import { identifierAt, stringLiteralAt } from '../reading/identifier-at.ts';

type Declared = Denotation['declared'];

/**
 * A name as written: an identifier, or a String literal naming a field as its key (§3.1 Key types),
 * which a field's references and renaming reach as any name of it.
 */
export type WrittenName = Identifier | StringLiteral;

/** What `name` spells. */
export function spelledName(name: WrittenName): string {
  return name.kind === 'Identifier' ? name.text : name.value;
}

/** A name, and the module it stands in. */
export interface NamePlace {
  readonly module: ModuleId;
  readonly name: WrittenName;
}

/** A declaration a name denotes, and the name declaring it. */
export interface DeclaredAt {
  readonly declared: Declared;
  readonly at: NamePlace;
}

/**
 * The declarations `name` of `module` denotes, each once: two for a shorthand, the field a key
 * names for a String literal, none for nothing.
 */
function declarationsOf(
  checker: Checker,
  module: ModuleId,
  name: WrittenName,
): readonly DeclaredAt[] {
  const denotations =
    name.kind === 'Identifier'
      ? checker.lookup.denotationsOf(module, name)
      : checker.lookup.keyDenotationsOf(module, name);
  const found = denotations.flatMap(({ declared }) => {
    const at = handlerOf(declaringNames, declared)(checker, declared);
    return at === undefined ? [] : [{ declared, at }];
  });
  return found.filter(
    ({ at }, index) => found.findIndex((other) => isSamePlace(other.at, at)) === index,
  );
}

/**
 * The declarations finding references and renaming act on through `name`: those it denotes, each
 * once, an export reached through a renaming import declared at that import's alias. A field a
 * shorthand names beside it is never imported, so it keeps its own declaring name.
 */
export function actedOnBy(
  checker: Checker,
  module: ModuleId,
  name: WrittenName,
): readonly DeclaredAt[] {
  const declarations = declarationsOf(checker, module, name);
  const alias = name.kind === 'Identifier' ? checker.bindings.aliasOf(module, name) : undefined;
  if (alias === undefined) {
    return declarations;
  }
  const aliased = declarations.map((each) =>
    each.declared.kind === 'field' ? each : { ...each, at: { module, name: alias } },
  );
  return aliased.filter(
    ({ at }, index) => aliased.findIndex((other) => isSamePlace(other.at, at)) === index,
  );
}

/** Whether two names stand in one place: they are one name, though read through two nodes. */
export function isSamePlace(first: NamePlace, second: NamePlace): boolean {
  return first.module === second.module && startTogether(first.name.span, second.name.span);
}

/** Where a name stands in its module's text. */
export function spanOfUse(program: Program, { module, name }: NamePlace): Span {
  return spanIn(programModule(program, module).tree, name.span);
}

/** A name, and what it denotes. */
export interface NameAt {
  readonly name: WrittenName;
  /** Every declaration the name denotes. */
  readonly declarations: readonly DeclaredAt[];
  /**
   * The declarations finding references and renaming act on: those spelled as the name is, so a
   * conversion's callee acts on its type rather than the function converting; and at a shorthand,
   * which names a field and the value it reads or binds, a variable or a function, that value, the
   * name the code around it reads.
   */
  readonly targets: readonly DeclaredAt[];
}

/**
 * The name at `offset` of `module`, and what it denotes; undefined where no name stands. A String
 * literal there is a name only where it is a key naming a field.
 */
export function nameAt(program: Program, module: ModuleId, offset: number): NameAt | undefined {
  const tree = program.modules.get(module)?.tree;
  const name = tree && (identifierAt(tree, offset) ?? stringLiteralAt(tree, offset));
  if (name === undefined) {
    return undefined;
  }
  const checker = checkProgram(program);
  const declarations = declarationsOf(checker, module, name);
  if (name.kind === 'StringLiteral' && declarations.length === 0) {
    return undefined;
  }
  const spelled = actedOnBy(checker, module, name).filter(
    ({ at }) => spelledName(at.name) === spelledName(name),
  );
  const values = spelled.filter(({ declared }) => declared.kind !== 'field');
  return { name, declarations, targets: values.length > 0 ? values : spelled };
}

const declaringNames: Handlers<Checker, Declared, [], NamePlace | undefined> = {
  variable: ({ bindings }, { entity }) => named(bindings.moduleOf(entity), entity.name),
  field: (_, { field }) =>
    field.declared === undefined
      ? undefined
      : named(field.declared.module, field.declared.node.name),
  variant: ({ bindings }, { entity }) => named(bindings.moduleOf(entity), entity.variant.name),
  function: (checker, { declaration }) => named(checker.moduleOf(declaration), declaration.name),
  type: ({ bindings }, { entity }) =>
    entity.kind === 'type' ? named(bindings.moduleOf(entity), entity.declaration.name) : undefined,
  namespace: ({ bindings }, { entity }) =>
    named(bindings.moduleOf(entity), entity.declaration.alias),
};

function named(module: ModuleId | undefined, name: Identifier): NamePlace | undefined {
  return module === undefined || isMissingName(name) ? undefined : { module, name };
}
