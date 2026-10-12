#!/usr/bin/env bash
# 把本仓的 skill 软链进 Claude Code（~/.claude/skills）与 Codex（~/.codex/skills）。
# 幂等：链对即跳过；目标被真实目录或其他链接占用则不动。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGETS=(
  "${HOME}/.claude/skills"
  "${HOME}/.codex/skills"
)

for target in "${TARGETS[@]}"; do
  mkdir -p "$target"
  for src in "$REPO_ROOT"/*/; do
    src="${src%/}"
    name="$(basename "$src")"
    [ -f "$src/SKILL.md" ] || continue
    link="$target/$name"
    if [ -L "$link" ] && [ "$(readlink "$link")" = "$src" ]; then
      echo "ok    $link"
    elif [ -e "$link" ] || [ -L "$link" ]; then
      echo "skip  $link 已被占用（$(readlink "$link" 2>/dev/null || echo 真实目录)）"
    else
      ln -s "$src" "$link"
      echo "link  $link -> $src"
    fi
  done
done
