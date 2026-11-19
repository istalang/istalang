---
description: traits, structural conformance, coherence, unions meeting traits, required fields, associated types and static functions, calls through a requirement; read before changing traits
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 8.2 Traits

A trait is a named set of functions, and optionally fields, that a type must have. A trait constrains a type parameter (`T is Addable`), and after `any` it types a value of any type meeting it (`any Notifier`, §8.3).

```ista
trait Addable<T = Self>:
    fn add(left: T, right: T) -> T

trait Comparable<T = Self>:
    fn compare(left: T, right: T) -> Int

trait Monoid:
    fn Self.zero() -> Self
    fn add(left: Self, right: Self) -> Self

fn sum<T is Monoid>(xs: Array<T>) -> T:
    let total = T.zero()
    for x in xs:
        total = total + x
    total

fn maxSendable<T is Sendable & Comparable>(xs: Array<T>) -> T?:
    ...
```

- **Members** are a list, as a struct's fields are (§2.1): one per line in the trait's body, or separated by `,`, on one line of it or in braces: `trait Shape { fn area(self: Self) -> Float, type Measure }`. Nothing evaluates them in order.
- **`Self` and defaults.** `Self` is the constrained type: in `T is Addable`, `Self` is `T`. Trait type parameters may have defaults, so `T is Addable` means `T is Addable<T>`. A trait may take several type parameters, such as `trait Convertible<To, From = Self>`.
- **Several traits.** `T is X & Y` requires both. In this position `&` joins traits; it never means a reference.
- **Structural conformance.** A type satisfies a trait when functions with the required signatures exist for it. There are no `impl` blocks. The required functions must be declared beside the types they take or beside the trait: in the module declaring one of those types (the prelude, for a primitive), for a static function also its own type's, or in the trait's own module. Only the types themselves count, not their type arguments, as in argument-dependent lookup (§13.1). So a module declaring a trait can declare its functions for types it doesn't own, such as primitives, and no caller has to import them.
- **Coherence.** Where a type meets a constraint, such as a generic call, never decides how: the functions found are the same in every module, and they are the ones every instantiation calls. Two modules therefore can't disagree about one value, as when one sorts an array that another searches, or one writes a value that another parses back. A module owning neither the type nor the trait can't make the one meet the other; it passes a function value instead (§6.4). A function's parameters must take the type as it is: one taking it only as a union's member, such as `fn add<T>(left: T?, right: T?) -> T`, is a function for `T?`, not for `T`. A shape (§5.2) has no module, so it meets a trait through functions declared in the trait's module, or in the module of another type they take; `Sendable`, `Encodable` and `Decodable` are derived for it as for any struct. An associated type is declared only by its type (§5.2), so it is the same in every module.
- **Unions.** A union (§4.2) has no module either. It meets a trait through functions declared for it, found as a shape's are, as `Optional.default` makes every `T?` `Default` (§19.3); or when each member meets the trait, a recursive union assuming itself meets it while its members are checked, and the trait could follow `any` (object safety, §8.3), which a static requirement such as `T.zero()`, having no value to dispatch on, rules out, and which never makes it `Encodable` or `Decodable` (§17.4). A call on a union that no function takes whole, such as `x.toString()` or `${x}`, calls the requirement of that name in a trait the union meets, among the traits visible at the call: declared there, imported, or the prelude's. It runs the member's own function, so `x.toString()` works on an `Int | Email` when both are `Stringable`, and `x` passes where `T is Stringable` or `any Stringable` is expected. Nothing at such a call names the trait's type arguments: one with a default takes it, and one without is inferred from the call's arguments, or from the type it is expected to give, as a function's own are (§8.1), so `e.apply(&settings)` on a union of `Entry` structs meeting `Applies<Settings>` (§5.2, Key types) calls through `Applies<Settings>`; a member that doesn't meet the trait with them is a compile error. Finding no such trait, or several, is a compile error.
- **Fields.** A trait may require fields, written like struct fields: `value: Int`. A type satisfies one with a readable member of the same name and type: a field it stores, or else a getter (§5.2) giving that type, found and judged as the witness of an unmarked requirement `fn get value(self: Self) -> Int` would be (§9.3). So a shared struct's handle, a primitive or an enum meets one through a getter. Generic code reads a field its type parameter's trait requires but can't change it, since the parameter may be an `any` type, through which only the value's own type has the field. A struct constraint (§8.1) states a struct's own fields instead, which generic code may also write.
- **Associated types.** A trait may require an associated type, `type Key`, maybe with a bound: `type Key is Stringable & Encodable`. A type meets it with an associated type of that name (§5.2) meeting the bound. Its kind is bounded too, `DataKind<"simple">` where no `DataKind` is written (§9.2), so a type whose associated type holds a kind meets the trait only where the bound allows it: `type Data is DataKind<"live" | "simple">`. Meeting a function requirement, `Self.Name` is the type's own: `fn validate<T>(self: Field<T>, data: T)` meets `fn validate(self: Self, data: Self.Data)`, since `Field<T>.Data` is `T`. `T.Data` is one type: where several traits of `T` require `Data`, it meets each one's bound. A **member bound**, `type Mode in Persistence`, bounds it to one member of a union instead, as `S in U` does a type parameter (§8.1), with no constraint beside it: a type meets it with an associated type that is one member, and `T.Mode` stands for one, so it is a member parameter's argument (`Resolver<T, Self.Mode>`) and, bounded to marks, a requirement's mark (`Self.Mode fn`, §9.3). A union or an `any` type has none (§5.2), so neither meets a trait requiring one where a type must, as a type argument does; a call through such a trait on a union's value still runs its member's function, each member meeting the trait with its own (Unions, above).
- **Static functions.** A trait may require a static function, declared on `Self`, such as `fn Self.zero() -> Self`. Generic code calls it through the type parameter: `T.zero()` (§6.2), or through a field's type, a type indexed by a key: `S[K].make(seed)` calls the `make` the constraint's entry for that field requires, or the field type's own once it is known (§11.2). Written before `.`, a type indexed by a type names a type, never an index into a value.
- **Generic requirements.** A required function may have type parameters of its own, such as `fn map<U>(self: Self, f: fn(T) -> U) -> Array<U>`. A function satisfies it when it is generic in the same way, up to the names of its type parameters.

- **Calls through a requirement.** A call through a constraint or an `any` value binds its arguments against the required function's own parameters (§6.1): names are its parameters', and its rest parameter reaches the function meeting it as one array. A required function has no defaults, since each type meeting the trait could give another; the function meeting it may have more parameters, each with a default, which it computes when called through the trait.
