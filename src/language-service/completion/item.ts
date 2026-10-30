/**
 * What completion hands an editor for each item: the name it filters by, and what accepting it
 * does. The model holds what the scenario catalogue asks of an item (docs/work/completion/
 * mechanics.md) in the service's own terms, so the protocol's encoding (`sortText`, snippet
 * syntax, commands) has one home, the LSP provider.
 *
 * Every field beyond `name` and `kind` is optional and absent means the editor's default: the name
 * is inserted, nothing follows, items sort by name, none is preselected.
 */

/** `type` is a type of no kind of its own here: an alias, or one the binder doesn't tell apart. */
export type CompletionKind =
  | 'variable'
  | 'constant'
  | 'function'
  | 'method'
  | 'field'
  | 'struct'
  | 'enum'
  | 'trait'
  | 'type'
  | 'typeParameter'
  | 'variant'
  | 'module'
  | 'folder'
  | 'keyword';

export interface Completion {
  readonly name: string;
  readonly kind: CompletionKind;
  /** A function's signature, or a field's type. */
  readonly detail?: string;
  /** Markdown, as a docstring reads. */
  readonly documentation?: string;
  /** What accepting the item writes in place of the name being typed. */
  readonly insert?: Insertion;
  /** What the editor asks for once the item is accepted. */
  readonly next?: FollowUp;
  readonly rank?: Rank;
  /** The item the list opens on, at most one per list. */
  readonly preselect?: true;
  /** Characters whose typing accepts the item before being written themselves. */
  readonly commit?: readonly string[];
}

/**
 * Text written as it is, or a snippet: text with tab stops (`$1`, `${1:name}`) and the final
 * cursor (`$0`), whose literal `$`, `}` and `\` are escaped with `\`.
 */
export type Insertion =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'snippet'; readonly snippet: string };

/** A list of completions, as after a field's `name: `, or the signature of the call just opened. */
export type FollowUp = 'completion' | 'signatureHelp';

/**
 * Where an item stands in its list: items fitting the type expected where they are written come
 * first, then by group, nearest first, then by priority, lowest first; within a rank, by name.
 */
export interface Rank {
  readonly fitsExpected: boolean;
  /** Where a name a scope offers comes from; absent where a place's own order is all (members). */
  readonly group?: RankGroup;
  /**
   * An order within a group, from 0 to 999: a required field before a defaulted one, a field
   * before a method, a variant no case covers yet before a covered one. Absent counts as 0.
   */
  readonly priority?: number;
}

/** The groups, in the order they are offered. */
export const rankGroups = ['local', 'module', 'imported', 'prelude', 'keyword'] as const;

export type RankGroup = (typeof rankGroups)[number];

/** Highest priority a rank may hold. */
export const lowestPriority = 999;

/**
 * What a rank orders by, most significant first: fitting, then group (absent counts as the
 * first), then priority. Items whose keys tie order by name.
 */
export function rankKeys({ fitsExpected, group, priority = 0 }: Rank): readonly number[] {
  return [fitsExpected ? 0 : 1, group === undefined ? 0 : rankGroups.indexOf(group), priority];
}

/** Whether `a` comes before `b` in a list: by their ranks' keys, then by name. */
export function ranksBefore(a: Completion, b: Completion): boolean {
  const keysOf = ({ rank }: Completion) => (rank === undefined ? [] : rankKeys(rank));
  const [keysA, keysB] = [keysOf(a), keysOf(b)];
  const differing = keysA.findIndex((key, index) => key !== keysB[index]);
  return differing === -1 ? a.name < b.name : (keysA[differing] ?? 0) < (keysB[differing] ?? 0);
}
