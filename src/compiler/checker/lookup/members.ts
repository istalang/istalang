/**
 * What a value of a type has, by name, as a module sees it: its fields and variants as its layout
 * has them, or the fields its constraints require; the static functions a call through it may
 * choose, and its methods.
 *
 * A method is found as a method call finds it (resolution/candidates.ts): by each name the module
 * sees at its top level, the type's own module exports, or its constraints require, with that
 * call's candidates kept where `self` takes the type. Taking it is judged by the type's
 * declaration, its arguments aside, since completing a call needn't know them yet.
 */

import { type ModuleId, programModule } from '../../program/program.ts';
import {
  declaredFunctions,
  type FunctionDeclaration,
  isMethod,
} from '../../syntax/declarations.ts';
import type { CheckerContext } from '../context.ts';
import type { TypeMembers } from '../denotation.ts';
import {
  modulesSeenFrom,
  staticCandidates,
  staticFunctionsAmong,
  staticTargetOf,
  topLevelCandidates,
} from '../resolution/candidates.ts';
import {
  fieldOf,
  knownConstraints,
  requiredFields,
  requiredFunctions,
} from '../traits/constraints.ts';
import type { FieldMember, Type } from '../types/type.ts';

export function membersOf(checker: CheckerContext, module: ModuleId, type: Type): TypeMembers {
  return {
    fields: fieldsOf(checker, type),
    variants: (type.kind === 'nominal' ? checker.variantsOf(type) : undefined) ?? [],
    methods: methodsOf(checker, module, type),
    statics: staticsOf(checker, module, type),
  };
}

/** A struct's fields, or those the constraints on `type` require, as a read finds each. */
function fieldsOf(checker: CheckerContext, type: Type): readonly FieldMember[] {
  const required = knownConstraints(checker, type)
    .flatMap(({ trait }) => requiredFields(trait))
    .flatMap(({ name }) => fieldOf(checker, type, name.text)?.member ?? []);
  return checker.fieldsOf(type) ?? [...new Map(required.map((each) => [each.name, each])).values()];
}

/** The static functions a call through `type` may choose, seen from `module`. */
function staticsOf(
  checker: CheckerContext,
  module: ModuleId,
  type: Type,
): readonly FunctionDeclaration[] {
  const target = staticTargetOf(checker, type);
  switch (target?.kind) {
    case 'owner':
      return staticFunctionsAmong(checker, modulesSeenFrom(checker, module), target);
    case 'parameter': {
      const names = knownConstraints(checker, type).flatMap(({ trait }) =>
        requiredFunctions(trait).flatMap(({ owner, name }) =>
          owner === undefined ? [] : name.text,
        ),
      );
      return [
        ...new Set(
          names.flatMap((name) =>
            staticCandidates(checker, module, target, name).map(({ declaration }) => declaration),
          ),
        ),
      ];
    }
    default:
      return [];
  }
}

function methodsOf(
  checker: CheckerContext,
  module: ModuleId,
  type: Type,
): readonly FunctionDeclaration[] {
  const found = new Set<FunctionDeclaration>();
  for (const name of methodNames(checker, module, type)) {
    for (const { declaration } of topLevelCandidates(checker, module, name, [type])) {
      if (takesAsSelf(checker, declaration, type)) {
        found.add(declaration);
      }
    }
  }
  return [...found];
}

/** The names a method of `type` may have, seen from `module`. */
function methodNames(checker: CheckerContext, module: ModuleId, type: Type): ReadonlySet<string> {
  const { bindings, program } = checker;
  const target = staticTargetOf(checker, type);
  const exporting = [
    program.roles.prelude,
    target?.kind === 'owner' ? target.module : undefined,
  ].filter((each) => each !== undefined);
  const { root } = programModule(program, module).tree;
  return new Set([
    ...declaredFunctions(root).map(({ name }) => name.text),
    ...root.items.flatMap((item) =>
      item.kind === 'NamedImport' ? item.names.map(({ text }) => text) : [],
    ),
    ...exporting.flatMap((each) => [...bindings.exportsOf(each).keys()]),
    ...knownConstraints(checker, type).flatMap(({ trait }) =>
      requiredFunctions(trait).map(({ name }) => name.text),
    ),
  ]);
}

/** Whether `declaration` is a method whose `self` takes a value of `type`, its arguments aside. */
function takesAsSelf(
  checker: CheckerContext,
  declaration: FunctionDeclaration,
  type: Type,
): boolean {
  const self = isMethod(declaration) ? checker.parametersOf(declaration)[0]?.type : undefined;
  if (self === undefined) {
    return false;
  }
  if (self.kind === 'parameter') {
    return true;
  }
  return self.kind === 'nominal' && type.kind === 'nominal'
    ? self.entity.declaration === type.entity.declaration
    : checker.fitOf(type, self) !== undefined;
}
