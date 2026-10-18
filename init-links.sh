#!/usr/bin/env bash
# 把本仓的 skill 软链进 Claude Code（~/.claude/skills）、Codex（~/.codex/skills）
# 与 OpenCode（~/.config/opencode/skills）。
# 通过 skills CLI 全局安装/刷新 Matt Pocock 的 skills（需要 bunx 和网络）。
# 幂等：链对即跳过；目标被真实目录或其他链接占用则不动。
# -f/--force：目标即使是错误/断掉的软链也强制重链；真实目录仍不动（防误删本地内容）。
set -euo pipefail

FORCE=0
for arg in "$@"; do
  case "$arg" in
    -f|--force) FORCE=1 ;;
    *) echo "用法: $0 [-f|--force]" >&2; exit 2 ;;
  esac
done

if ! command -v bunx >/dev/null 2>&1; then
  echo "需要 bunx 来安装 Matt Pocock skills，请先安装 Bun。" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGETS=(
  "${HOME}/.claude/skills"
  "${HOME}/.codex/skills"
  "${HOME}/.config/opencode/skills"
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
      if [ "$FORCE" = 1 ] && [ -L "$link" ]; then
        rm "$link"
        ln -s "$src" "$link"
        echo "force $link -> $src"
      else
        echo "skip  $link 已被占用（$(readlink "$link" 2>/dev/null || echo 真实目录)）"
      fi
    else
      ln -s "$src" "$link"
      echo "link  $link -> $src"
    fi
  done
done

bunx skills@latest add mattpocock/skills --global --agent claude-code codex opencode --skill '*' --yes
