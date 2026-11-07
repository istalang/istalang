/**
 * What an editor shows for the spot under a pointer: for a name, what it denotes there, each
 * declaration as a line of code with its type, and the docstring of what it names; for any other
 * expression or written type, its type. A type written through a spelling, an alias, an associated
 * type or a struct's keys, shows what it names beside it (`writtenAndNamedText`); one known only by
 * its bounds, an opaque type, shows them: `T.Data is Encodable` (`shownText`).
 *
 * A name is answered through the identifier query (checker denotation.ts), as going to its
 * definition is, so the two never disagree; a String literal naming a field as its key (§3.1),
 * through the key query, as the field it names. A shorthand, `Pair{first}`, names a field and a
 * variable, and shows both. A function shows its signature, which spells its type with its
 * parameters' names, and so does a variant with fields, its constructor's (§3.11), before its enum.
 * A call pattern's argument written by position shows the field it gives, as checking recorded it
 * and as a named one's name does, before what its own text shows; inside a pattern taking a value
 * apart, itself included, only that pattern's parts show what they give.
 */

import type { Checker } from '../../compiler/checker/check.ts';
import type { Denotation } from '../../compiler/checker/surface/denotation.ts';
import { isOpaque } from '../../compiler/checker/types/type/computed-types.ts';
import type { Type } from '../../compiler/checker/types/type/index.ts';
import {
  constraintText,
  writtenAndNamedText,
} from '../../compiler/checker/types/type/type-text.ts';
import type { ModuleId, Program } from '../../compiler/program/program.ts';
import { fieldsFunctionOf } from '../../compiler/syntax/declarations/field-defaults.ts';
import type { Expression } from '../../compiler/syntax/expressions/index.ts';
import type { StringLiteral } from '../../compiler/syntax/expressions/literals/literals.ts';
import type { PatternArgument, VariantCallPattern } from '../../compiler/syntax/patterns.ts';
import { nodesAt, type SyntaxNode } from '../../compiler/syntax/tree/index.ts';
import type { Identifier } from '../../compiler/syntax/tree/node.ts';
import { spanIn } from '../../compiler/syntax/tree/positions.ts';
import type { TypeNode } from '../../compiler/syntax/types/index.ts';
import type { Span } from '../../foundation/text/span.ts';
import { type CheckedModule, checkedModule } from './reading/checked-module.ts';
import { docstringOf } from './reading/docstrings.ts';
import { identifierAt } from './reading/identifier-at.ts';
import { importedModule } from './reading/namespaces.ts';
import { signatureOf } from './signatures/signatures.ts';

export interface Hover {
  /** The name or expression hovered over. */
  readonly span: Span;
  /** Each declaration the name denotes, or the expression's type, as a line of code. */
  readonly code: readonly string[];
  readonly doc: string | undefined;
}

/**
 * What hovering at `offset` of `module` shows: the innermost node holding it that has a name or a
 * type, so a construct's own keywords and punctuation (`if`, `else`, a block's braces, a
 * template's text) show the construct's type; else the name ending there, as under a cursor right
 * after it. Undefined where nothing there has a type.
 *
 * `x->f` is written as a field of the dereference `x->` (syntax: `Dereference`), but `->` reads a
 * member as `.` does, so it shows the member read, never the value behind the shared struct.
 */
export function hoverAt(program: Program, module: ModuleId, offset: number): Hover | undefined {
  const checked = checkedModule(program, module);
  if (checked === undefined) {
    return undefined;
  }
  const chain = nodesAt(checked.tree, offset);
  const ending = identifierAt(checked.tree, offset);
  // Right after a name, the name is the one under the cursor, as `nameHover` reads it below.
  const around = ending === undefined ? chain : nodesAt(checked.tree, offset - 1);
  const position = positionalArgumentOf(chain) ?? positionalArgumentOf(around);
  if (position !== undefined) {
    return argumentHover(checked, position);
  }
  return innermostHover(checked, chain) ?? (ending && nameHover(checked, ending));
}

/** The hover of the innermost of `nodes`, root to innermost, that has a name or a type. */
function innermostHover(checked: CheckedModule, nodes: readonly SyntaxNode[]): Hover | undefined {
  for (const node of nodes.toReversed()) {
    const found = nodeHover(checked, node);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * A call pattern's argument written by position (§3.11), its call pattern, and the nodes from it
 * to the one under the cursor.
 */
interface PositionalArgument {
  readonly call: VariantCallPattern;
  readonly argument: PatternArgument;
  readonly inside: readonly SyntaxNode[];
}

/**
 * The argument by position of the innermost call pattern in `chain` that the chain ends in, short
 * of a pattern taking a value apart in it, itself included, whose own parts say what they give;
 * undefined elsewhere.
 */
function positionalArgumentOf(chain: readonly SyntaxNode[]): PositionalArgument | undefined {
  const depth = chain.findLastIndex(({ kind }) => kind === 'VariantCallPattern') + 1;
  const call = chain[depth - 1];
  const argument = chain[depth];
  if (call?.kind !== 'VariantCallPattern' || argument === undefined) {
    return undefined;
  }
  const given: readonly SyntaxNode[] = call.arguments;
  const written = given.includes(argument) ? (argument as PatternArgument) : undefined;
  const inside = chain.slice(depth);
  const takesApart = inside.some(({ kind }) => takingApart.has(kind));
  return written === undefined || !byPosition(written) || takesApart
    ? undefined
    : { call, argument: written, inside };
}

/** Patterns taking a value apart, each of whose parts gives what it matches its own way. */
const takingApart: ReadonlySet<SyntaxNode['kind']> = new Set([
  'StructPattern',
  'VariantCallPattern',
  'TuplePattern',
  'ArrayPattern',
]);

function byPosition({ kind }: PatternArgument): boolean {
  return kind !== 'NamedPatternArgument' && kind !== 'OtherFieldsPattern';
}

/**
 * A call pattern's argument by position: the field it gives as checking recorded it (§3.11), as a
 * named one's name shows it, then what the text under the cursor shows, inside the argument.
 */
function argumentHover(
  checked: CheckedModule,
  { call, argument, inside }: PositionalArgument,
): Hover | undefined {
  const { checker, module, tree } = checked;
  const found = innermostHover(checked, inside);
  const field = checker.lookup.bodyHolding(module, call)?.fieldGivenBy(argument);
  if (field === undefined) {
    return found;
  }
  const fieldLines = denotationLines(checker, field.name, {
    declared: { kind: 'field', field },
    type: field.type,
  });
  return {
    span: found?.span ?? spanIn(tree, argument.span),
    code: [...fieldLines, ...(found?.code ?? [])],
    doc: found?.doc,
  };
}

/**
 * `type` as hover shows it: as written and what it names, and, opaque, the bounds it is known by.
 */
function shownText(checker: Checker, type: Type): string {
  const text = writtenAndNamedText(type);
  const bounds = isOpaque(type) ? checker.lookup.constraintsOf(type) : [];
  return bounds.length === 0 ? text : `${text} is ${bounds.map(constraintText).join(' & ')}`;
}

function nodeHover(checked: CheckedModule, node: SyntaxNode): Hover | undefined {
  if (node.kind === 'Dereference' && node.operator === '->') {
    return undefined;
  }
  const named = isName(node) ? nameHover(checked, node) : undefined;
  const type = named === undefined ? typeAt(checked, node) : undefined;
  return (
    named ??
    (type && {
      span: spanIn(checked.tree, node.span),
      code: [shownText(checked.checker, type)],
      doc: undefined,
    })
  );
}

/**
 * Whether `node` may name a declaration: an identifier, or a String literal naming a field as its
 * key.
 */
function isName(node: SyntaxNode): node is Identifier | StringLiteral {
  return node.kind === 'Identifier' || node.kind === 'StringLiteral';
}

/** What `name` denotes, as code: an identifier's denotations, or the field a key names (§3.1). */
function nameHover(
  { checker, module, tree }: CheckedModule,
  name: Identifier | StringLiteral,
): Hover | undefined {
  const denotations =
    name.kind === 'Identifier'
      ? checker.lookup.denotationsOf(module, name)
      : checker.lookup.keyDenotationsOf(module, name);
  if (denotations.length === 0) {
    return undefined;
  }
  const text = name.kind === 'Identifier' ? name.text : name.value;
  return {
    span: spanIn(tree, name.span),
    code: denotations.flatMap((denotation) => denotationLines(checker, text, denotation)),
    doc: denotations
      .map(({ declared }) => docstringOf(checker, declared))
      .find((doc) => doc !== undefined),
  };
}

/**
 * The type checking gave `node`: an expression's in the body holding it, a written type's as it
 * resolved. Both are keyed by their nodes themselves, so a node of any other kind is simply not
 * among them.
 */
function typeAt({ checker, module }: CheckedModule, node: SyntaxNode): Type | undefined {
  const { lookup } = checker;
  return (
    lookup.bodyHolding(module, node)?.typeOf(node as Expression) ??
    lookup.typeOfNode(module, node as TypeNode)
  );
}

/**
 * A denotation as code: a function by its signature, followed, where the name is used as a value,
 * by that value's type, which says what its signature can't (`sendable`, its type arguments).
 */
function denotationLines(
  checker: Checker,
  name: string,
  { declared, type }: Denotation,
): readonly string[] {
  const typed = (kind: string) =>
    `(${kind}) ${name}${type === undefined ? '' : `: ${shownText(checker, type)}`}`;
  switch (declared.kind) {
    case 'function': {
      const signature = signatureOf(checker, declared.declaration).label;
      return type === undefined ? [signature] : [signature, shownText(checker, type)];
    }
    case 'type':
      return [`(type) ${type === undefined ? name : shownText(checker, type)}`];
    case 'namespace':
      return [`(module) ${importedModule(checker, declared.entity)?.name ?? name}`];
    case 'variant': {
      const constructs = fieldsFunctionOf(declared.entity.enum, declared.entity.variant);
      const signature = constructs && signatureOf(checker, constructs).label;
      return signature === undefined ? [typed('variant')] : [signature, typed('variant')];
    }
    default:
      return [typed(declared.kind)];
  }
}
