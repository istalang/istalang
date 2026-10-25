/**
 * Dropped variables (§7): `drop x` releases `x`, which can't be used afterwards. A use that some
 * path reaches from a drop, with no assignment to `x` between, is an error; assigning a `let`
 * again makes it usable, and a declaration run again, as in a loop's next iteration, is a fresh
 * variable.
 *
 * - A body is walked once its checking is done, as the code runs: what was dropped on any path
 *   flows on, joining where paths meet. A loop runs its body until what reaches its top no longer
 *   grows, so a drop late in the body is seen by a use early in it.
 * - Only statements drop and assign, but statements sit inside expressions (an `if`'s branches, a
 *   block expression), so control flow is followed through both.
 * - A name is a use unless it is the one that declares its variable. Patterns, loop targets and
 *   declarations therefore need no rule of their own: their names declare, and a fresh variable
 *   is not dropped.
 * - A lambda or local function captures what it uses when it is made, so its uses count there. Its
 *   own variables flow within its own body, which starts with what was dropped where it is made.
 */

import type { VariableEntity } from '../../binder/entities.ts';
import { type Expression, unparenthesized } from '../../syntax/expressions.ts';
import type { Identifier } from '../../syntax/node.ts';
import { type Drop, droppedName, targetParts } from '../../syntax/statements.ts';
import { childrenOf, type SyntaxNode } from '../../syntax/tree.ts';
import type { BodyContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';

/** The variables dropped on some path to a point; undefined where no path reaches. */
type Dropped = ReadonlySet<VariableEntity>;
type Flow = Dropped | undefined;

/** What reaches a loop's exits: after its body's `break`s, and its top again after `continue`s. */
interface LoopExits {
  readonly breaks: Dropped[];
  readonly continues: Dropped[];
}

/** Reports every use of a variable after a `drop` reaches it, in `body` and what it nests. */
export function checkDropped(context: BodyContext, body: SyntaxNode): void {
  new DropFlow(context).function(body, new Set());
}

class DropFlow {
  readonly #context: BodyContext;
  readonly #reported = new Set<Identifier>();
  #loops: LoopExits[] = [];

  constructor(context: BodyContext) {
    this.#context = context;
  }

  /** Walks the body of a function, its loops its own, starting with what `dropped` holds. */
  function(body: SyntaxNode, dropped: Dropped): void {
    const outer = this.#loops;
    this.#loops = [];
    this.#node(body, dropped);
    this.#loops = outer;
  }

  /** What is dropped after `node` runs, given `dropped` before it. */
  #node(node: SyntaxNode, dropped: Dropped): Flow {
    switch (node.kind) {
      case 'Identifier':
        return this.#name(node, dropped);
      case 'Lambda':
        this.function(node.body, dropped);
        return dropped;
      case 'FunctionDeclaration':
        if (node.body !== undefined) {
          this.function(node.body, dropped);
        }
        return dropped;
      case 'Return':
        this.#sequence(childrenOf(node), dropped);
        return undefined;
      case 'Break':
      case 'Continue':
        this.#loops.at(-1)?.[node.kind === 'Break' ? 'breaks' : 'continues'].push(dropped);
        return undefined;
      case 'Drop':
        return this.#drop(node, dropped);
      case 'Assignment':
        return this.#assignment(node.targets, node.operator, node.value, dropped);
      case 'If':
        return this.#if(node.branches, node.elseClause?.body, dropped);
      case 'Match':
        return this.#match(node.subject, node.cases, dropped);
      case 'Select':
        return this.#select(node.cases, node.elseClause?.body, dropped);
      case 'While':
        return this.#loop(dropped, (top) => {
          const tested = this.#node(node.condition, top);
          return { exit: tested, end: tested && this.#node(node.body, tested) };
        });
      case 'For': {
        const iterated = this.#node(node.iterable, dropped);
        return (
          iterated &&
          this.#loop(iterated, (top) => ({
            exit: top,
            end: this.#sequence([...node.targets, node.body], top),
          }))
        );
      }
      case 'Binary': {
        const left = this.#node(node.left, dropped);
        const shortCircuits = node.operator === 'and' || node.operator === 'or';
        if (left === undefined || !(shortCircuits || node.operator === '??')) {
          return left && this.#node(node.right, left);
        }
        return join([left, this.#node(node.right, left)]);
      }
      default:
        return this.#sequence(childrenOf(node), dropped);
    }
  }

  /** Runs `nodes` one after another. */
  #sequence(nodes: readonly SyntaxNode[], dropped: Dropped): Flow {
    let flow: Flow = dropped;
    for (const node of nodes) {
      if (flow === undefined) {
        return undefined;
      }
      flow = this.#node(node, flow);
    }
    return flow;
  }

  /** A name: a fresh variable where it declares one, else a use, refused once dropped. */
  #name(name: Identifier, dropped: Dropped): Dropped {
    const entity = this.#context.entityOf(name);
    if (entity?.kind !== 'variable') {
      return dropped;
    }
    if (entity.name === name) {
      return without(dropped, entity);
    }
    if (dropped.has(entity) && !this.#reported.has(name)) {
      this.#reported.add(name);
      this.#context.report(checkerDiagnostics.droppedVariableUsed(name.span, name.text));
    }
    return dropped;
  }

  #drop(node: Drop, dropped: Dropped): Flow {
    const after = this.#node(node.value, dropped);
    const name = droppedName(node);
    const entity = name === undefined ? undefined : this.#context.entityOf(name);
    return after && entity?.kind === 'variable' ? new Set([...after, entity]) : after;
  }

  /**
   * An assignment: its value, then each target. A name assigned whole is written, not used, and
   * usable again; any other place is used. A compound assignment reads its place first.
   */
  #assignment(
    targets: readonly Expression[],
    operator: string,
    value: Expression,
    dropped: Dropped,
  ): Flow {
    const read = operator === '=' ? dropped : this.#sequence(targets, dropped);
    const valued = read && this.#node(value, read);
    const assign = (flow: Flow, target: Expression): Flow => {
      if (flow === undefined) {
        return flow;
      }
      const bare = unparenthesized(target);
      const parts = targetParts(bare);
      if (parts.length > 0) {
        return parts.reduce(assign, flow);
      }
      const entity = bare.kind === 'Identifier' ? this.#context.entityOf(bare) : undefined;
      return entity?.kind === 'variable' ? without(flow, entity) : this.#node(bare, flow);
    };
    return targets.reduce(assign, valued);
  }

  #if(
    branches: readonly { readonly condition: SyntaxNode; readonly body: SyntaxNode }[],
    elseBody: SyntaxNode | undefined,
    dropped: Dropped,
  ): Flow {
    const ends: Flow[] = [];
    let failed: Flow = dropped;
    for (const { condition, body } of branches) {
      const tested: Flow = failed && this.#node(condition, failed);
      ends.push(tested && this.#node(body, tested));
      failed = tested;
    }
    ends.push(elseBody === undefined ? failed : failed && this.#node(elseBody, failed));
    return join(ends);
  }

  #match(subject: SyntaxNode, cases: readonly SyntaxNode[], dropped: Dropped): Flow {
    const ends: Flow[] = [];
    let failed = this.#node(subject, dropped);
    for (const matchCase of cases.flatMap((each) => (each.kind === 'MatchCase' ? [each] : []))) {
      const { pattern, guard, body } = matchCase;
      const tested: Flow =
        failed && this.#sequence(guard === undefined ? [pattern] : [pattern, guard], failed);
      ends.push(tested && this.#node(body, tested));
      failed = join([failed, tested]);
    }
    return join(ends);
  }

  #select(cases: readonly SyntaxNode[], elseBody: SyntaxNode | undefined, dropped: Dropped): Flow {
    const selectCases = cases.flatMap((each) => (each.kind === 'SelectCase' ? [each] : []));
    const evaluated = this.#sequence(
      selectCases.map((each) => each.future),
      dropped,
    );
    if (evaluated === undefined) {
      return undefined;
    }
    const ends = selectCases.map((each) =>
      this.#sequence(
        each.binding === undefined ? [each.body] : [each.binding, each.body],
        evaluated,
      ),
    );
    return join(elseBody === undefined ? ends : [...ends, this.#node(elseBody, evaluated)]);
  }

  /**
   * A loop: `iteration` runs one pass from what reaches the top, giving what leaves it normally and
   * what reaches the end of its body. Passes repeat until what reaches the top stops growing.
   */
  #loop(dropped: Dropped, iteration: (top: Dropped) => { exit: Flow; end: Flow }): Flow {
    let top = dropped;
    for (;;) {
      const exits: LoopExits = { breaks: [], continues: [] };
      this.#loops.push(exits);
      const { exit, end } = iteration(top);
      this.#loops.pop();
      const next = join([top, end, ...exits.continues]) ?? top;
      if (next.size === top.size) {
        return join([exit, ...exits.breaks]);
      }
      top = next;
    }
  }
}

/** What reaches a point where paths meet: dropped on any of them; undefined when none reaches. */
function join(flows: readonly Flow[]): Flow {
  const reaching = flows.filter((flow) => flow !== undefined);
  return reaching.length === 0 ? undefined : new Set(reaching.flatMap((flow) => [...flow]));
}

function without(dropped: Dropped, entity: VariableEntity): Dropped {
  if (!dropped.has(entity)) {
    return dropped;
  }
  const remaining = new Set(dropped);
  remaining.delete(entity);
  return remaining;
}
