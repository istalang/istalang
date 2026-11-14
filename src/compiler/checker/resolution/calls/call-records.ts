/**
 * The calls a body makes, recorded per pass as every record of a node is (passes.ts): the function
 * each call site calls, and the functions it chose among, in the order considered, which tools
 * read; and apart from them, the function each naming of one as a value names (§3.14), which calls
 * nothing where it stands.
 */

import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { CallRecord } from '../../contexts/body-context.ts';
import type { Pass, Passes, PassRecords, PassTable } from '../../contexts/passes.ts';
import type { FunctionNaming, ResolvedCall, ResolvedSite } from '../../surface/resolved-call.ts';

/** The calls one body makes, by site. */
export class CallRecords implements CallRecord {
  readonly #resolved: PassTable<ResolvedSite, ResolvedCall>;
  readonly #values: PassTable<FunctionNaming, ResolvedCall>;
  readonly #candidates: PassTable<ResolvedSite, readonly FunctionDeclaration[]>;

  constructor(passes: Passes) {
    this.#resolved = passes.table();
    this.#values = passes.table();
    this.#candidates = passes.table();
  }

  record(site: ResolvedSite, call: ResolvedCall): void {
    this.#resolved.set(site, call);
  }

  of(site: ResolvedSite): ResolvedCall | undefined {
    return this.#resolved.get(site);
  }

  /** The calls as `pass` sees them. */
  at(pass: Pass): PassRecords<ResolvedSite, ResolvedCall> {
    return this.#resolved.at(pass);
  }

  /** Every call of every pass, with its site. */
  entries(): readonly (readonly [ResolvedSite, ResolvedCall])[] {
    return this.#resolved.entries();
  }

  recordValue(naming: FunctionNaming, named: ResolvedCall): void {
    this.#values.set(naming, named);
  }

  valueOf(naming: FunctionNaming): ResolvedCall | undefined {
    return this.#values.get(naming);
  }

  /** The functions named as values as `pass` sees them. */
  valuesAt(pass: Pass): PassRecords<FunctionNaming, ResolvedCall> {
    return this.#values.at(pass);
  }

  /** Every function named as a value in every pass, with its naming. */
  valueEntries(): readonly (readonly [FunctionNaming, ResolvedCall])[] {
    return this.#values.entries();
  }

  recordCandidates(site: ResolvedSite, candidates: readonly FunctionDeclaration[]): void {
    this.#candidates.set(site, candidates);
  }

  candidatesAt(site: ResolvedSite, pass?: Pass): readonly FunctionDeclaration[] {
    return this.#candidates.get(site, pass) ?? [];
  }
}
