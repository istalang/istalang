---
description: & parameters: what can be referenced, copy-in and copy-out of elements and shared values, no stored or dangling references; read before changing references
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 7.3 References

**References.** A parameter of type `&T` refers to the caller's variable instead of a copy. Changes made through it are visible to the caller, including to other concurrent executions of the same instance:

```python
ista async fn collectSignature(sigs: &Array<Signature>, signer: String):
    _ = signQueue(signer).sendRevertible(SignRequest{signer: signer})
    sigs.push(await runtime.delegate signatures(signer).receive())

ista async fn signContract(contract: Contract) -> Array<Signature>:
    let sigs: Array<Signature> = []
    const a = collectSignature(&sigs, "alice")
    const b = collectSignature(&sigs, "bob")
    await a
    await b
    sigs
```

The rules:

- **Explicit at the call site.** An argument passed by reference is written `&x`. Only a method's `self` takes its reference implicitly, so `x.f()` passes `x` by reference when the chosen `f` takes `&self`; `x` must then be a place that may change (a variable, a field or element of one, or the value behind a shared struct, `*x`, or a part of one), never a call's result, a `const`, or a value read through an optional chain (§10.4). `&` may stand only before a whole call argument, and `&T` only as a parameter's type; anywhere else either is a compile error.
- **Exact types.** A reference names the caller's own variable, so its type must be the parameter's exactly: no value is converted into a union through a reference.
- **One kind of reference, and it allows mutation.** A read-only reference would add nothing, because a by-value parameter can't change at all (§6.1).
- **What can be referenced.** A `let` variable or a `&` parameter, a field or tuple element path of one (`&self.items`, `&t.0`), a field a struct's key names when the key is one name (`&s[k]`, §10.2), a field path as `&s.region` is, an element of any indexable value (`&m["a"]`), or the value behind a shared struct or a path of one (`&*u`, `&u->items`). A reference parameter passed on with `&` passes the same reference. One variable may be passed by `&` twice in one call, and both refer to it; but not when either reaches through an element of it (`f(&xs[i], &xs[j])`, `f(&a[0].x, &a[0].y)`, `f(&xs, &xs[0])`), a compile error, since an element is a copy for the call. Nor may one call be passed two places that reach through shared structs (`f(&u->a, &w->b)`), since such a value is a copy too and two handles may be one. An element is read through its container's `index` and written back with `setIndex`, whether the container is an `Array`, a `Map` or a user type (§10.2).
- **Elements and shared structs' values are copied in and out.** An element passed by `&` (`&m["a"]`, or `m["a"].f()` for a method taking `&self`) is read with `index` before the call, which panics for a key the map doesn't hold, and written back with `setIndex` when the call returns. A shared struct's value passed by `&` (`&u->items`, or `u->items.push(x)`) is read from its cell and written back the same way (§10.2). During the call the container, or the handle, still holds the old value, as a closure sharing it or a second `&` to it sees. When the call returns, the copy is written into the container or the handle's value as it holds it then, so what changed another part of it during the call stays changed. An async call returns its future before its callee ends, so passing an element or a shared struct's value by `&` to an async function is a compile error: copy it into a `let`, pass that, and assign it back.
- **References aren't values.** They can't be stored in variables or struct fields, returned or sent. Aliasing exists only for the duration of a call.
- **No references to constants.** Neither a `const` variable nor an `extern` constant can be passed by `&`.
- **No dangling references.** A referenced variable's storage stays alive until every call holding a reference to it has ended, even if its block ends first. It just can't be named after its block ends.
