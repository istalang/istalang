/**
 * Generic functions that would need endlessly many instantiations (§3.5): `f<T>` calling
 * `f<Array<T>>` never stops making new ones.
 *
 * The expansion graph (edges.ts) takes its edges from calls here: a call inside generic `F` to
 * generic `G` gives `G`'s type parameters arguments built from `F`'s, and an expanding edge on a
 * cycle is reported at the call that makes it. Every call a function's code reaches counts
 * (surface/reach.ts): its body's and its parameters' defaults', the calls the language makes for a
 * construct, the defaults a struct literal leaves fields to, the calls a witness makes, and the
 * `dispose` of a type it makes. The functions a struct's fields read as (§3.1) are nodes too, so a
 * cycle through a field's default is one like any; so are the generic functions a trait requires:
 * a requirement call leads to the requirement, and where a call chooses a witness, conformance
 * leads from the requirement to it, its type parameters taking the requirement's own.
 *
 * Checking stays lazy. A module's diagnostics follow edges only from its own generic functions,
 * so only the bodies those edges reach are checked. Every cycle through one of the module's calls
 * is among them, since a cycle comes back to where it starts.
 *
 * Three entries keep it incremental (docs/work/m6-m7/incremental-checking.md §1): a function's
 * edges apart from where their calls stand, which an edit of its body leaves equal unless it
 * changes what it calls with what; the module's expanding edges, the graph's verdict; and each
 * function's reports, which alone read where its calls stand.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import { sameItems, sameProperties } from '../../../../foundation/structures/equality.ts';
import type { ModuleId } from '../../../program/program.ts';
import { functionsOf } from '../../../syntax/declarations/field-defaults.ts';
import { type FunctionDeclaration, typeParametersOf } from '../../../syntax/declarations/index.ts';
import type { NodeOf } from '../../../syntax/tree/node.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { reachedCalls } from '../../surface/reach.ts';
import type { ResolvedCall } from '../../surface/resolved-call.ts';
import { requiredFunctions } from '../../types/traits/constraints.ts';
import type { ParameterKey, Type } from '../../types/type/index.ts';
import { type ArgumentEdge, argumentEdges, endlessEdgesFrom } from './edges.ts';

/** An edge of the graph, made by a call in `caller`'s code to `callee`, wherever it stands. */
interface Edge extends ArgumentEdge {
  readonly caller: FunctionDeclaration;
  readonly callee: FunctionDeclaration;
}

/** An edge, at the call that makes it. */
interface SitedEdge extends Edge {
  readonly site: NodeOf<string>;
}

const sameEdges = sameItems<Edge>(sameProperties);

/** The expansion rule over one checker's program. */
export class Expansion {
  readonly #checker: CheckerContext;
  /** Each function's edges, apart from their call sites, so an edit moving a call cuts off. */
  readonly #edges: EntryTable<CheckerNote, FunctionDeclaration, readonly Edge[]>;
  /** The expanding edges on cycles through a module's generic functions: the graph's verdict. */
  readonly #endless: EntryTable<CheckerNote, ModuleId, readonly Edge[]>;
  /** Each generic function's reports, at the calls making its expanding edges. */
  readonly #reports: EntryTable<CheckerNote, FunctionDeclaration, void, ModuleId>;

  constructor(checker: CheckerContext) {
    this.#checker = checker;
    this.#edges = checker.entries.table({
      name: 'expansion edges',
      compute: (caller) => sitedEdges(checker, caller).map(({ site: _site, ...edge }) => edge),
      equal: sameEdges,
    });
    this.#endless = checker.entries.table({
      name: 'endless expansions',
      compute: (module) => {
        const own = this.#ownGeneric(module);
        return endlessEdgesFrom(
          own,
          (caller) => this.#edges.get(caller),
          ({ callee }) => (this.#isNode(callee) ? callee : undefined),
        ).filter((edge) => own.has(edge.caller));
      },
      equal: sameEdges,
    });
    this.#reports = checker.entries.table({
      name: 'expansion reports',
      compute: (caller, module) => this.#report(caller, module),
    });
  }

  /** Reports every call in a generic function of `module` that makes an expanding cycle. */
  check(module: ModuleId): void {
    for (const caller of this.#ownGeneric(module)) {
      this.#reports.get(caller, module);
    }
  }

  #ownGeneric(module: ModuleId): ReadonlySet<FunctionDeclaration> {
    const items = this.#checker.inputs.itemsOf(module);
    return new Set(functionsOf({ items }).filter(isGeneric));
  }

  /**
   * Whether `callee` is a node of the graph: a generic function its module declares at the top
   * level or reads its fields as, or a generic function a trait requires, which conformance leads
   * on to its witnesses; not a local function.
   */
  #isNode(callee: FunctionDeclaration): boolean {
    if (!isGeneric(callee)) {
      return false;
    }
    const module = this.#checker.moduleOf(callee);
    return this.#ownGeneric(module).has(callee) || this.#required(module).has(callee);
  }

  /** The functions the traits `module` declares require. */
  #required(module: ModuleId): ReadonlySet<FunctionDeclaration> {
    const items = this.#checker.inputs.itemsOf(module);
    return new Set(
      items.flatMap((item) => (item.kind === 'TraitDeclaration' ? requiredFunctions(item) : [])),
    );
  }

  /** Reports `caller`'s calls that make one of its module's expanding edges, each call once. */
  #report(caller: FunctionDeclaration, module: ModuleId): void {
    const endless = this.#endless.get(module).filter((edge) => edge.caller === caller);
    if (endless.length === 0) {
      return;
    }
    const sites = sitedEdges(this.#checker, caller)
      .filter(({ site: _site, ...edge }) => endless.some((each) => sameProperties(each, edge)))
      .map((edge) => edge.site);
    for (const site of new Set(sites)) {
      this.#checker.report(
        module,
        checkerDiagnostics.expandingInstantiation(site.span, caller.name.text),
      );
    }
  }
}

function isGeneric(declaration: FunctionDeclaration): boolean {
  return declaration.typeParameters.length > 0;
}

/**
 * Every edge `caller`'s code makes, at its call: to each function it reaches, a requirement among
 * them, and from each requirement whose witness a call chooses to the witness (`metEdges`).
 */
function sitedEdges(checker: CheckerContext, caller: FunctionDeclaration): readonly SitedEdge[] {
  return reachedCalls(checker, caller).flatMap(({ site, call }) =>
    [...usedBy(caller, call.function, call.typeArguments), ...metEdges(checker, call)].map(
      (edge) => ({ ...edge, site }),
    ),
  );
}

/** The edges `caller` makes using `callee` with `typeArguments`, from its own type parameters. */
function usedBy(
  caller: FunctionDeclaration,
  callee: FunctionDeclaration,
  typeArguments: readonly Type[],
): readonly Edge[] {
  const own = new Set<ParameterKey>(typeParametersOf(caller.typeParameters));
  return argumentEdges(own, callee.typeParameters, typeArguments).map((edge) => ({
    ...edge,
    caller,
    callee,
  }));
}

/**
 * The edges conformance adds where `call` chooses the witnesses of its callee's constraints: from
 * each generic function a constraint's trait requires to the witness meeting it, whose type
 * arguments are built from the requirement's own (§3.10). A requirement call names the
 * requirement, so a cycle through a witness runs through the requirement it meets.
 */
function metEdges(checker: CheckerContext, call: ResolvedCall): readonly Edge[] {
  return [...call.witnesses].flatMap(([parameter, met]) =>
    checker.constraintsOf(parameter).flatMap(({ trait }, index) =>
      requiredFunctions(trait).flatMap((required, member) => {
        const witness = met[index]?.[member];
        return witness === undefined
          ? []
          : usedBy(required, witness.function, witness.typeArguments);
      }),
    ),
  );
}
