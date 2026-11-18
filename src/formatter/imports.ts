/**
 * A module's imports (spec §3.13), printed as one block at its top, before every other item, with
 * no blank line inside: declarations may come in any order, and imports read best together.
 *
 * - Imports of one path merge into one statement. The comments of each statement merged print
 *   around the merged one, so none is lost. A line ends in at most one comment, so of the
 *   statements holding a comment that ends one of their lines, after `(` or after the path, one
 *   merges with the others and the rest stand alone.
 * - Statements sort by path: paths from the project root or the std first, then `../` ones, the
 *   farthest first, then `./` ones. Among paths of one kind, a statement with `*` comes first,
 *   then one with `* as m`, then the rest, each alphabetically by path.
 * - In a statement, `*` comes first, then each `* as m` by `m`, then the names alphabetically.
 *   A statement of one item stands on one line. Names alone stand bare on the import's line while
 *   they fit; else in parentheses, broken into as many lines as the width needs. Beside `*` or
 *   `* as m` the items are always in parentheses, each star on a line of its own and the names
 *   filling the lines after them. A `*` first on a line starts an item (§2), so the broken list
 *   reads back as printed.
 * - Alphabetical is by letter regardless of case, then by code unit, so the order never depends on
 *   a locale.
 */

import { builders } from 'prettier/doc';
import type {
  ImportDeclaration,
  ImportedName,
  ImportItem,
} from '../compiler/syntax/declarations/index.ts';
import { extentIn } from '../compiler/syntax/tree/index.ts';
import { compareOrdered } from '../foundation/language/order.ts';
import { annotated } from './layout/bodies.ts';
import { hasComments } from './layout/lists.ts';
import type { Printer, Printers } from './printer.ts';

const { fill, group, hardline, ifBreak, indent, line, softline } = builders;

/** `imports`, the module's, merged by path and sorted, one statement per line. */
export function importBlock(printer: Printer, imports: readonly ImportDeclaration[]): builders.Doc {
  const statements = mergedByPath(printer, imports).toSorted((first, second) =>
    compareStatements(first, second),
  );
  return statements.map((merged, index) => [
    index === 0 ? '' : hardline,
    merged.length === 1 ? printer.print(merged[0]) : mergedStatement(printer, merged),
  ]);
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

/**
 * `imports` grouped by path, in the order each group starts. A statement with comments ending its
 * lines (`endsLineInComment`) joins its path's first group only when no statement there has such;
 * else it stands alone.
 */
function mergedByPath(printer: Printer, imports: readonly ImportDeclaration[]): readonly Merged[] {
  const firstOfPath = new Map<string, ImportDeclaration[]>();
  const groups: Merged[] = [];
  for (const declaration of imports) {
    const path = pathOf(declaration);
    const first = firstOfPath.get(path);
    const fits = !(
      endsLineInComment(printer, declaration) &&
      first?.some((each) => endsLineInComment(printer, each))
    );
    if (first !== undefined && fits) {
      first.push(declaration);
    } else {
      const started: Merged & ImportDeclaration[] = [declaration];
      groups.push(started);
      if (first === undefined) {
        firstOfPath.set(path, started);
      }
    }
  }
  return groups;
}

/** Whether a comment ends a line of `declaration`: after its `(`, its path, or the whole. */
function endsLineInComment(printer: Printer, declaration: ImportDeclaration): boolean {
  const trails = [declaration, declaration.path].some(
    (node) => printer.extentOf(node).end !== extentIn(printer.tree, node).end,
  );
  return trails || printer.hasDangling(declaration);
}

/** Statements of one path as one, each one's comments and annotations around it. */
function mergedStatement(printer: Printer, [first, ...rest]: Merged): builders.Doc {
  return rest.reduce<builders.Doc>(
    (doc, declaration) => printer.withComments(declaration, annotated(printer, declaration, doc)),
    printer.withComments(first, statement(printer, [first, ...rest])),
  );
}

/** `import items from 'path'`: the items of every statement in `merged`, which share the path. */
function statement(printer: Printer, merged: Merged): builders.Doc {
  const [first, ...rest] = merged;
  const items = merged
    .flatMap((declaration) => declaration.items)
    .filter((item) => item.kind !== 'Invalid')
    .toSorted(compareItems);
  // The paths of the statements merged into `first` print nothing but their comments.
  const otherPaths = rest.map((declaration) => printer.withComments(declaration.path, ''));
  return annotated(printer, first, [
    'import ',
    itemsDoc(printer, merged, items),
    ' from ',
    printer.print(first.path),
    otherPaths,
  ]);
}

/**
 * The items of `merged`: names alone bare while they fit, a star alone on the import's line, else
 * in parentheses, each star on a line of its own above the names. Comments inside always take
 * the parentheses, whose line breaks are sure, so a comment after the path still ends its line.
 */
function itemsDoc(printer: Printer, merged: Merged, items: readonly ImportItem[]): builders.Doc {
  const inside = merged.map((declaration) => printer.dangling(declaration));
  const stars = items.filter((item) => item.kind !== 'ImportedName');
  const names = items.filter((item) => item.kind === 'ImportedName');
  const commented =
    merged.some((declaration) => printer.hasDangling(declaration)) ||
    items.some((item) => hasComments(printer, item));
  const [only] = items;
  if (!commented && stars.length === 0) {
    const filled = filledNames(printer, names);
    return group([ifBreak('('), indent([softline, filled]), softline, ifBreak(')')]);
  }
  if (!commented && items.length === 1 && only !== undefined) {
    return printer.print(only);
  }
  const starLines = stars.map((star) => [hardline, printer.print(star)]);
  const nameLines = names.length === 0 ? '' : [hardline, filledNames(printer, names)];
  return ['(', indent([inside, starLines, nameLines]), hardline, ')'];
}

/**
 * `names` filling lines up to the width, `, ` between two on a line. A name with comments stands
 * on a line of its own, so each comment stays beside its name.
 */
function filledNames(printer: Printer, names: readonly ImportedName[]): builders.Doc {
  return fill(
    names.flatMap((name, index) => {
      const previous = names[index - 1];
      if (previous === undefined) {
        return [printer.print(name)];
      }
      const apart = hasComments(printer, previous) || hasComments(printer, name);
      return [apart ? hardline : [ifBreak('', ','), line], printer.print(name)];
    }),
  );
}

function pathOf(declaration: ImportDeclaration): string {
  return declaration.path.kind === 'StringLiteral' ? declaration.path.value : '';
}

/**
 * Root and std paths, then `../` ones from the farthest, then `./` ones; among paths of one kind,
 * statements by their first item's rank (`*`, `* as m`, a name), then alphabetically by path.
 */
function compareStatements(first: Merged, second: Merged): number {
  const [firstPath, secondPath] = [pathOf(first[0]), pathOf(second[0])];
  const [firstKind, firstDepth] = pathRank(firstPath);
  const [secondKind, secondDepth] = pathRank(secondPath);
  return (
    firstKind - secondKind ||
    firstDepth - secondDepth ||
    statementRank(first) - statementRank(second) ||
    alphabetically(firstPath, secondPath)
  );
}

/** The rank of the item `merged` prints first: 0 with a `*`, 1 with a `* as m`, else 2. */
function statementRank(merged: Merged): number {
  const items = merged.flatMap((declaration) => declaration.items);
  return Math.min(
    ...items.map((item) =>
      item.kind === 'Invalid' ? itemRanks.ImportedName : itemRanks[item.kind],
    ),
  );
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
