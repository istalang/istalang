---
name: hcom-send-pitfalls
description: hcom send pitfalls — inline text with backticks gets shell-mangled (send reports with --file); --intent ack needs --reply-to
metadata:
  type: reference
---

- An inline `hcom send ... -- '<text>'` built by an agent through a shell heredoc can lose every backtick span (command substitution) — a merge review arrived with all code names stripped. Ask examiners to send reports with `--file <path>`, and send long briefs/reports the same way.
- `--intent ack` fails without `--reply-to <id>`; use `--intent inform` for unsolicited notes. Don't pipe send output to /dev/null — the error is silent then.
- To recover a mangled message verbatim, `hcom events --agent <name> --type message --last 1` gives its JSON text.
