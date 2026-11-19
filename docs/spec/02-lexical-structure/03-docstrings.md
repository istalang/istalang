---
description: where docstrings stand and how their text lays out; read before changing docstrings
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 2.3 Docstrings

**Docstrings.** `"""…"""` says what a module, function, struct, enum or trait is for; tools show it, and the program never reads it. It is the first line of the declaration's indented body, or of a module, where only comments may come before it. A declaration without an indented body, such as an `extern fn`, a trait's requirement, an `extern struct` or a struct in braces, takes it on the next line, indented deeper. Fields, variants, aliases and constants take none, and a docstring anywhere else is a compile error. Its text is raw, with no escapes or values, ends at the first `"""`, and lays out its lines as a template does:

```ista
trait Notifier:
    """Sends a message to whoever a value stands for."""
    fn notify(self: Self, text: String) -> Unit
        """Delivers `text`; nothing waits for an answer."""

fn greet(name: String) -> String:
    """
    A greeting for `name`,
    in one line.
    """
    `Hello ${name}`
```
