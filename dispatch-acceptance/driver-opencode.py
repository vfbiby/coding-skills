#!/usr/bin/env python3
"""派活给 OpenCode（默认 DeepSeek V4.1 Flash）。

用法：
    driver-opencode.py <工作树> <任务书> <输出.ndjson> [模型] [超时秒]

示例：
    driver-opencode.py ~/codes/repo-wt-85 ~/codes/agy-tasks/85/brief.md \\
        ~/codes/agy-tasks/85/out.ndjson deepseek/deepseek-flash 14400

为什么用 `--standalone`：不碰当前会话正在用的共享 OpenCode 后台服务，
每个任务起一个私有 server，互不干扰；任务结束进程即退出。

模型：
    deepseek/deepseek-flash        = DeepSeek V4.1 Flash 1017（默认，快、便宜）
    deepseek/deepseek-flash#high   = 同一模型的高思考预算（难活再用）
    deepseek/deepseek-v4-pro       = 更强、更贵
    也可用 OPENCODE_DISPATCH_MODEL 覆盖。

边界：OpenCode 没有 Claude Code 的 `--allowedTools`。这个 driver 只能做两件事：
  1) 启动前检查任务书里确实写了硬边界（不 push / 不合并 / 不关票 / 禁止段）；
  2) 把全过程原始 JSONL 和 meta 落盘，方便验收方复核。
真正的命令级边界必须由任务书写死（允许哪些命令、禁止哪些命令、禁止哪些动作）。
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import threading
import time

DEFAULT_MODEL = "deepseek/deepseek-flash"
DEFAULT_TIMEOUT = 4 * 60 * 60  # 4 小时

REQUIRED_BOUNDARY_PHRASES = ["不 push", "不合并", "不关票", "禁止"]


def die(message: str, code: int = 2) -> int:
    print(f"[driver-opencode] {message}", file=sys.stderr, flush=True)
    return code


def one_line(text: str, limit: int) -> str:
    flattened = " ".join((text or "").split())
    return flattened[:limit]


def main() -> int:
    if len(sys.argv) < 4:
        return die(
            "用法: driver-opencode.py <工作树> <任务书> <输出.ndjson> [模型] [超时秒]"
        )

    worktree = os.path.abspath(sys.argv[1])
    brief_path = os.path.abspath(sys.argv[2])
    out_path = os.path.abspath(sys.argv[3])
    model = (
        sys.argv[4]
        if len(sys.argv) > 4
        else os.environ.get("OPENCODE_DISPATCH_MODEL", DEFAULT_MODEL)
    )
    try:
        timeout = int(
            sys.argv[5]
            if len(sys.argv) > 5
            else os.environ.get("OPENCODE_DISPATCH_TIMEOUT", DEFAULT_TIMEOUT)
        )
    except ValueError:
        return die("超时秒数必须是整数")

    if not os.path.isdir(worktree):
        return die(f"工作树不存在: {worktree}")
    if not os.path.isfile(brief_path):
        return die(f"任务书不存在: {brief_path}")

    with open(brief_path, encoding="utf-8") as handle:
        brief = handle.read()
    if not brief.strip():
        return die("任务书是空的")

    missing = [item for item in REQUIRED_BOUNDARY_PHRASES if item not in brief]
    if missing:
        return die(
            "任务书缺少硬边界段落（缺: "
            + "、".join(missing)
            + "）。OpenCode 没有工具白名单，任务书必须写死允许/禁止的命令与动作。"
        )

    title = os.environ.get("OPENCODE_DISPATCH_TITLE", "dispatch")
    argv = [
        "opencode",
        "run",
        "--standalone",
        "--auto",
        "--format",
        "json",
        "--agent",
        "build",
        "-m",
        model,
        "--title",
        title,
        brief,
    ]

    out_file = open(out_path, "w", encoding="utf-8")
    err_path = out_path + ".err"
    err_file = open(err_path, "w", encoding="utf-8")

    started = time.time()
    print(
        f"[driver-opencode] worktree={worktree} model={model} timeout={timeout}s",
        flush=True,
    )

    proc = subprocess.Popen(
        argv,
        cwd=worktree,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=err_file,
        text=True,
        bufsize=1,
    )

    timed_out = False

    def kill_after_timeout() -> None:
        nonlocal timed_out
        timed_out = True
        try:
            proc.kill()
        except ProcessLookupError:
            pass

    timer = threading.Timer(timeout, kill_after_timeout)
    timer.daemon = True
    timer.start()

    def forward_signal(signum, _frame) -> None:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        raise SystemExit(128 + signum)

    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, forward_signal)
        except ValueError:
            pass

    session_id = None
    tool_count = 0
    error_count = 0
    step_finish_reasons: list[str] = []
    last_text = ""

    assert proc.stdout is not None
    for line in proc.stdout:
        out_file.write(line)
        out_file.flush()
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        session_id = event.get("sessionID") or session_id
        kind = event.get("type")

        if kind == "text":
            text = (event.get("part") or {}).get("text") or ""
            if text:
                last_text = text
                print("TXT " + one_line(text, 220), flush=True)
        elif kind == "tool_use":
            part = event.get("part") or {}
            tool = part.get("tool") or "?"
            state = part.get("state") or {}
            tool_input = state.get("input") or {}
            detail = (
                tool_input.get("command")
                or tool_input.get("path")
                or tool_input.get("pattern")
                or tool_input.get("description")
                or ""
            )
            tool_count += 1
            print(f"USE {tool} {one_line(str(detail), 110)}", flush=True)
        elif kind == "error":
            error_count += 1
            error = event.get("error") or {}
            print(
                "ERR "
                + one_line(
                    f"{error.get('type', '')} {error.get('message', '')}", 220
                ),
                flush=True,
            )
        elif kind == "step_finish":
            reason = (event.get("part") or {}).get("reason")
            if reason:
                step_finish_reasons.append(str(reason))

    code = proc.wait()
    timer.cancel()
    out_file.close()
    err_file.close()

    duration = round(time.time() - started, 1)
    meta = {
        "model": model,
        "worktree": worktree,
        "brief": brief_path,
        "output": out_path,
        "stderr": err_path,
        "session_id": session_id,
        "exit_code": code,
        "timed_out": timed_out,
        "duration_seconds": duration,
        "tool_calls": tool_count,
        "error_events": error_count,
        "step_finish_reasons": step_finish_reasons,
        "last_text": last_text,
    }
    meta_path = out_path + ".meta.json"
    with open(meta_path, "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False, indent=2)

    if timed_out:
        print(f"OPENCODE-TIMEOUT after {timeout}s", flush=True)
    print(
        f"OPENCODE-EXIT {code} session={session_id or '-'} "
        f"tools={tool_count} errors={error_count} duration={duration}s",
        flush=True,
    )
    print(f"OPENCODE-META {meta_path}", flush=True)
    print("OPENCODE-LAST-TEXT " + one_line(last_text, 300), flush=True)

    # OpenCode 有时在瞬时 transport 错误后仍完成了任务但进程退出 1；
    # 退出码交给验收方结合 meta/log 判断，这里如实返回。
    return code


if __name__ == "__main__":
    sys.exit(main())
