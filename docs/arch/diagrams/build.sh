#!/usr/bin/env bash
# Renders every diagram source under this folder, or only the paths given:
#   docs/arch/diagrams/build.sh [path ...]
# A path may be a source file or a folder of them. Sources are found by what they are, never
# listed: an explainer is `*.archify.md`, and a standalone diagram is a JSON spec with
# `diagram_type` and `meta.output` (a spec without `meta.output` belongs to an explainer, which
# renders it). Each renders from its own folder, where its relative paths resolve.
# ARCHIFY overrides where the archify skill's CLI is.
set -euo pipefail

archify="${ARCHIFY:-$HOME/.claude/skills/archify/bin/archify.mjs}"
root="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -f "$archify" ]]; then
  echo "build.sh: archify not found at $archify; set ARCHIFY to its bin/archify.mjs" >&2
  exit 2
fi

# The sources under the given paths, generated folders left out.
sources() {
  find "$@" \( -type d \( -name 'visual-*' -o -name 'review-*' \) -prune \) -o \
    -type f \( -name '*.archify.md' -o -name '*.json' \) -print | sort
}

# "<type> <quality> <output>" for a standalone spec; nothing for any other JSON file.
standalone() {
  node -e '
    const spec = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const output = spec?.meta?.output;
    if (typeof spec?.diagram_type === "string" && typeof output === "string") {
      console.log(spec.diagram_type, spec.meta.quality_profile ?? "showcase", output);
    }
  ' "$1"
}

# Runs one finalize from the source's folder; prints its output only when it fails.
render() {
  local file="$1"
  shift
  local log
  if log="$(cd "$(dirname "$file")" && node "$archify" finalize "$@" 2>&1)"; then
    echo "ok      ${file#"$root"/}"
  else
    echo "FAILED  ${file#"$root"/}"
    echo "$log" | sed 's/^/        /'
    failed=$((failed + 1))
  fi
}

failed=0
targets=("$@")
if [[ ${#targets[@]} -eq 0 ]]; then
  targets=("$root")
fi

while IFS= read -r file; do
  name="$(basename "$file")"
  case "$name" in
    *.archify.md)
      render "$file" explainer "$name" "${name%.archify.md}.html"
      ;;
    *.json)
      read -r type quality output <<<"$(standalone "$file")" || true
      if [[ -n "${type:-}" ]]; then
        render "$file" "$type" "$name" "$output" --quality "$quality"
      fi
      unset type quality output
      ;;
  esac
done < <(sources "${targets[@]}")

if [[ $failed -gt 0 ]]; then
  echo "build.sh: $failed source(s) failed" >&2
  exit 1
fi
