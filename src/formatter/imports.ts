/**
 * A module's imports (spec §3.13), printed as one block at its top, before every other item, with
 * no blank line inside: declarations may come in any order, and imports read best together.
 *
 * - Imports of one path merge into one statement, their items sorted together. A statement's own
 *   comments, which no single statement holds any more, stand above its first item and after its
 *   last, so every comment stays beside the items it was written by. An annotated import, which
 *   only an erroneous program holds (§3.16), stands alone.
 * - A statement holding a bare `*` drops the names the `*` binds too (`isBoundByAll`): `a` of
 *   `import (*, a) from 'lib'` adds nothing. A renamed or private name stays, and so does one a
 *   comment stands by, which may be about it. A statement's own comments, which stand by its
 *   first and last items once merged, keep its first item when the `*` binds all the others: what
 *   they stand by, printed, is the item's own, so formatting again keeps it.
 * - Statements sort by path: paths from the project root or the std first, then `../` ones, the
 *   farthest first, then `./` ones. Among paths of one kind, those printed on one line come
 *   before those taking several, a comment above one among its lines; then a statement with `*`,
 *   then one with `* as m`, then the rest, each alphabetically by path.
 * - In a statement, `*` comes first, then each `* as m` by `m`, then the names alphabetically.
 *   The items stand bare on the import's line while they fit; else in parentheses, each star on a
 *   line of its own and the names filling the lines after them, each within a compressed form's
 *   width (layout/compact.ts `compactFill`), since several names share one. A `*` first on a line starts
 *   an item (§2), so the broken list reads back as printed. An import holding a comment takes the
 *   parentheses and puts each item on a line of its own, so each comment stays beside its item.
 * - Alphabetical is by letter regardless of case, then by code unit, so the order never depends on
 *   a locale.
 */

import { builders } from 'prettier/doc';
import {
  type ImportDeclaration,
  type ImportItem,
  isBoundByAll,
} from '../compiler/syntax/declarations/index.ts';
import { compareOrdered } from '../foundation/language/order.ts';
import { unreachable } from '../foundation/structures/unreachable.ts';
import { annotated } from './layout/bodies.ts';
import { compactFill } from './layout/compact.ts';
import { hasComments } from './layout/lists.ts';
import { printsOnOneLine } from './layout/widths.ts';
import type { Printer, Printers } from './printer.ts';

const { group, hardline, hardlineWithoutBreakParent, ifBreak, indent, join, line, softline } =
  builders;

/** `imports`, the module's, merged by path and sorted, one statement per line. */
export function importBlock(printer: Printer, imports: readonly ImportDeclaration[]): builders.Doc {
  const statements = mergedByPath(imports).map((merged): Statement => {
    const doc = merged.length === 1 ? printer.print(merged[0]) : mergedStatement(printer, merged);
    return { merged, doc, isOneLine: printsOnOneLine(doc, printer.width) };
  });
  return statements
    .toSorted(compareStatements)
    .map(({ doc }, index) => [index === 0 ? '' : hardline, doc]);
}

/** A statement of the block, printed, and whether it takes one line, as sorting reads it. */
interface Statement {
  readonly merged: Merged;
  readonly doc: builders.Doc;
  readonly isOneLine: boolean;
}

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const importPrinters: Printers<ImportDeclaration | ImportItem> = {
  ImportDeclaration: (printer, node) => statement(printer, [node]),
  ImportedName: (printer, node) =>
    node.alias === undefined
      ? printer.print(node.name)
      : [printer.print(node.name), ' as ', printer.print(node.alias)],
  ImportedNamespace: (printer, node) => ['* as ', printer.print(node.alias)],
  ImportedAll: () => '*',
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** A non-empty run of import statements printed as one. */
type Merged = readonly [ImportDeclaration, ...ImportDeclaration[]];

/** `imports` grouped by path, in the order each path first appears (banner). */
function mergedByPath(imports: readonly ImportDeclaration[]): readonly Merged[] {
  const byPath = new Map<string, ImportDeclaration[]>();
  const groups: Merged[] = [];
  for (const declaration of imports) {
    const alone = isAnnotated(declaration);
    const joined = alone ? undefined : byPath.get(pathOf(declaration));
    if (joined === undefined) {
      const started: Merged & ImportDeclaration[] = [declaration];
      groups.push(started);
      // An annotated import is a group of one, which nothing joins.
      if (!alone) {
        byPath.set(pathOf(declaration), started);
      }
    } else {
      joined.push(declaration);
    }
  }
  return groups;
}

function isAnnotated(declaration: ImportDeclaration): boolean {
  return (declaration.annotations ?? []).length > 0;
}

/**
 * Statements of one path as one, their items sorted together. A statement's own comments, which
 * no single statement holds any more, stand with its items: those before it and after its `(`
 * above its first item, those after it and around its path after its last (banner).
 */
function mergedStatement(printer: Printer, merged: Merged): builders.Doc {
  const [first] = merged;
  if (merged.some(isAnnotated)) {
    unreachable('An annotated import stands alone (mergedByPath), so no merge holds one.');
  }
  if (!merged.some((declaration) => hasOwnComments(printer, declaration))) {
    return statement(printer, merged);
  }
  const owned = printedItems(printer, merged).toSorted((one, other) =>
    compareItems(one.item, other.item),
  );
  const placed = owned.map(({ item, owner }, index): Placed => {
    const doc = printer.print(item);
    const opens = owned.findIndex((each) => each.owner === owner) === index;
    const closes = owned.findLastIndex((each) => each.owner === owner) === index;
    const before = opens ? [printer.danglingAbove(owner), printer.leadingOf(owner)] : '';
    // `first`'s path prints with the statement, the others' only through their comments.
    const ownPath = owner !== first;
    const path = closes && ownPath ? printer.withComments(owner.path, '') : '';
    const after = closes ? [printer.trailingOf(owner, doc), path] : '';
    return { item, doc: [before, doc, after] };
  });
  const commenting = { commented: true, inside: '' };
  return ['import ', listed(placed, commenting), ' from ', printer.print(first.path)];
}

/** Whether comments stand around `declaration`, after its `(` or around its path. */
function hasOwnComments(printer: Printer, declaration: ImportDeclaration): boolean {
  return (
    hasComments(printer, declaration) ||
    hasComments(printer, declaration.path) ||
    printer.hasDangling(declaration)
  );
}

/** `import items from 'path'`: the items of every statement in `merged`, which share the path. */
function statement(printer: Printer, merged: Merged): builders.Doc {
  const [first] = merged;
  const items = printedItems(printer, merged)
    .map(({ item }) => item)
    .toSorted(compareItems);
  const placed = items.map((item): Placed => ({ item, doc: printer.print(item) }));
  const commented =
    merged.some((each) => printer.hasDangling(each)) ||
    items.some((item) => hasComments(printer, item));
  const inside = merged.map((declaration) => printer.dangling(declaration));
  return annotated(printer, first, [
    'import ',
    listed(placed, { commented, inside }),
    ' from ',
    printer.print(first.path),
  ]);
}

/** `declaration`'s items: the formatter refuses trees with syntax diagnostics, so none is Invalid. */
function itemsOf(declaration: ImportDeclaration): readonly ImportItem[] {
  return declaration.items.map((item) =>
    item.kind === 'Invalid' ? unreachable('A tree the formatter prints holds no Invalid.') : item,
  );
}

/** An item and the statement it was written in. */
interface Owned {
  readonly item: ImportItem;
  readonly owner: ImportDeclaration;
}

/**
 * The items `merged` prints: all but the names its `*` binds too with no comment by them, a
 * statement holding comments keeping its first item (banner).
 */
function printedItems(printer: Printer, merged: Merged): readonly Owned[] {
  const owned = merged.flatMap((owner) => itemsOf(owner).map((item) => ({ item, owner })));
  if (!owned.some(({ item }) => item.kind === 'ImportedAll')) {
    return owned;
  }
  const kept = owned.filter(
    ({ item }) =>
      !(
        item.kind === 'ImportedName' &&
        isBoundByAll(item) &&
        printer.commentsIn(printer.extentOf(item)).length === 0
      ),
  );
  const stranded = merged.flatMap((owner) =>
    hasOwnComments(printer, owner) && !kept.some((each) => each.owner === owner)
      ? [itemsOf(owner).toSorted(compareItems)[0]]
      : [],
  );
  return owned.filter((each) => kept.includes(each) || stranded.includes(each.item));
}

/** An item as a statement prints it, with the comments it stands by. */
interface Placed {
  readonly item: ImportItem;
  readonly doc: builders.Doc;
}

/** Whether a statement holds comments, and those after its `(`, which follow it there. */
interface Commenting {
  readonly commented: boolean;
  readonly inside: builders.Doc;
}

/**
 * The items, sorted: bare on the import's line while they fit, else in parentheses, each star on a
 * line of its own above the names packed. An import holding a comment takes the parentheses, an
 * item a line, so where a comment attaches when read back never moves an item; and its line breaks
 * are sure, so a comment after the path still ends its line.
 */
function listed(placed: readonly Placed[], { commented, inside }: Commenting): builders.Doc {
  if (!commented) {
    const flat = join(
      ', ',
      placed.map((each) => each.doc),
    );
    // Line breaks only the broken form prints, which mustn't break the group as a hard line would.
    const broken = join(hardlineWithoutBreakParent, brokenLines(placed));
    return group([ifBreak('('), indent([softline, ifBreak(broken, flat)]), softline, ifBreak(')')]);
  }
  const lines = placed.map((each) => [hardline, each.doc]);
  return ['(', indent([inside, lines]), hardline, ')'];
}

/** The lines of a broken import: each star on its own, then the names filling lines (`filledNames`). */
function brokenLines(placed: readonly Placed[]): builders.Doc[] {
  const stars = placed.filter((each) => each.item.kind !== 'ImportedName');
  const names = placed.filter((each) => each.item.kind === 'ImportedName');
  return [...stars.map((each) => each.doc), ...(names.length === 0 ? [] : [filledNames(names)])];
}

/** `names` filling the lines of a broken import, `, ` between two on a line: a compressed form. */
function filledNames(names: readonly Placed[]): builders.Doc {
  return compactFill(
    names.flatMap(({ doc }, index) => (index === 0 ? [doc] : [[ifBreak('', ','), line], doc])),
  );
}

function pathOf(declaration: ImportDeclaration): string {
  return declaration.path.kind === 'StringLiteral' ? declaration.path.value : '';
}

/**
 * Root and std paths, then `../` ones from the farthest, then `./` ones; among paths of one kind,
 * statements on one line first, then by their first item's rank (`*`, `* as m`, a name), then
 * alphabetically by path.
 */
function compareStatements(first: Statement, second: Statement): number {
  const [firstPath, secondPath] = [pathOf(first.merged[0]), pathOf(second.merged[0])];
  const [firstKind, firstDepth] = pathRank(firstPath);
  const [secondKind, secondDepth] = pathRank(secondPath);
  return (
    firstKind - secondKind ||
    firstDepth - secondDepth ||
    Number(second.isOneLine) - Number(first.isOneLine) ||
    statementRank(first.merged) - statementRank(second.merged) ||
    alphabetically(firstPath, secondPath)
  );
}

/** The rank of the item `merged` prints first: 0 with a `*`, 1 with a `* as m`, else 2. */
function statementRank(merged: Merged): number {
  return Math.min(...merged.flatMap(itemsOf).map((item) => itemRanks[item.kind]));
}

const leadingParents = /^(?:\.\.\/)*/u;

/** A path's kind (root, parent, sibling), then its place among its kind: farther first. */
function pathRank(path: string): readonly [number, number] {
  if (path.startsWith('./')) {
    return [2, 0];
  }
  const parents = (leadingParents.exec(path)?.[0].length ?? 0) / '../'.length;
  return parents === 0 ? [0, 0] : [1, -parents];
}

// biome-ignore lint/style/useNamingConvention: the keys are the tree's node kinds.
const itemRanks = { ImportedAll: 0, ImportedNamespace: 1, ImportedName: 2 } as const;

function compareItems(first: ImportItem, second: ImportItem): number {
  return (
    itemRanks[first.kind] - itemRanks[second.kind] ||
    alphabetically(itemKey(first), itemKey(second))
  );
}

/** What an item sorts by: a namespace's name, an export's name and then its alias. */
function itemKey(item: ImportItem): string {
  if (item.kind === 'ImportedName') {
    return `${item.name.text} ${item.alias?.text ?? ''}`;
  }
  return item.kind === 'ImportedNamespace' ? item.alias.text : '';
}

function alphabetically(first: string, second: string): number {
  return compareOrdered(first.toLowerCase(), second.toLowerCase()) || compareOrdered(first, second);
}
