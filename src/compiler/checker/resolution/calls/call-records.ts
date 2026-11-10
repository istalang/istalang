/**
 * The calls a body makes, recorded per pass as every record of a node is (passes.ts): the function
 * each call site calls, or each function value names, and the functions it chose among, in the
 * order considered, which tools read.
 */

import type { FunctionDeclaration } from '../../../syntax/declarations/index.ts';
import type { CallRecord } from '../../contexts/body-context.ts';
import type { Pass, Passes, PassRecords, PassTable } from '../../contexts/passes.ts';
import type { ResolvedCall, ResolvedSite } from '../../surface/resolved-call.ts';

/** The calls one body makes, by site. */
export class CallRecords implements CallRecord {
  readonly #resolved: PassTable<ResolvedSite, ResolvedCall>;
  readonly #candidates: PassTable<ResolvedSite, readonly FunctionDeclaration[]>;

  constructor(passes: Passes) {
    this.#resolved = passes.table();
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

  recordCandidates(site: ResolvedSite, candidates: readonly FunctionDeclaration[]): void {
    this.#candidates.set(site, candidates);
  }

  candidatesAt(site: ResolvedSite, pass?: Pass): readonly FunctionDeclaration[] {
    return this.#candidates.get(site, pass) ?? [];
  }
}
