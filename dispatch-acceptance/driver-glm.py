#!/usr/bin/env python3
"""派活给 glmfclaude（GLM 驱动的 Claude Code）。

用法：
    driver-glm.py <工作树> <任务书> <输出.ndjson> "<允许的工具,逗号分隔>"

为什么经由 zsh -ic 调用：`glmfclaude` 是 ~/.zshrc 里的 **shell 函数**（不是二进制），
里面带着 GLM 的 base_url 与 token。经 zsh 调可以复用那份定义，**不必把 token 抄进本文件**。

权限：**不用** `--dangerously-skip-permissions`（历史上被权限闸按「Create Unsafe Agents」拦过）。
改用 `--allowedTools` 显式白名单——任务书里也要把这份白名单原样写进去，让它知道边界。
"""
import json
import os
import subprocess
import sys

worktree = sys.argv[1]
brief_path = sys.argv[2]
out_path = sys.argv[3]
allowed = sys.argv[4] if len(sys.argv) > 4 else "Read,Glob,Grep"

brief = open(brief_path).read()
out_file = open(out_path, "w")
err_file = open(out_path + ".err", "w")

argv = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--add-dir", worktree,
    "--allowedTools", allowed,
]

proc = subprocess.Popen(
    ["zsh", "-ic", 'glmfclaude "$@"', "glmfclaude-driver", *argv],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err_file,
    text=True, cwd=worktree)

proc.stdin.write(brief)
proc.stdin.close()

saw_result = False
for line in proc.stdout:
    out_file.write(line)
    out_file.flush()
    try:
        if json.loads(line).get("type") == "result":
            saw_result = True
            break
    except Exception:
        continue

if saw_result:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    print("RESULT-SEEN", flush=True)
else:
    proc.kill()
    print("STREAM-ENDED-WITHOUT-RESULT", flush=True)
