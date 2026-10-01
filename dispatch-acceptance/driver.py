import json, subprocess, sys, time

worktree = sys.argv[1]
brief = open(sys.argv[2]).read()
out_path = sys.argv[3]
out_file = open(out_path, "w")
err_file = open(out_path + ".err", "w")

proc = subprocess.Popen(
    ["agy", "--dangerously-skip-permissions",
     "--add-dir", worktree,
     "--input-format", "stream-json", "--output-format", "stream-json"],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err_file, text=True,
    cwd=worktree)

proc.stdin.write(json.dumps({"event": "user", "message": {"content": brief}}) + "\n")
proc.stdin.flush()

saw_result = False
for line in proc.stdout:
    out_file.write(line)
    out_file.flush()
    if '"event":"result"' in line or '"event": "result"' in line:
        saw_result = True
        break

if saw_result:
    proc.stdin.close()
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
    print("RESULT-SEEN", flush=True)
else:
    proc.kill()
    print("STREAM-ENDED-WITHOUT-RESULT", flush=True)
