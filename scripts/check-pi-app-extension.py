#!/usr/bin/env python3
"""Check the actual Pi entry point with the installed app's recovery extension.

No model request or saved session. A version/help check does not load extensions.
"""
import argparse
import json
import os
import selectors
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pi", required=True, help="Absolute Pi launcher or CLI JS path")
    parser.add_argument("--extension", required=True, help="Installed Luna recovery extension")
    parser.add_argument("--node", help="Explicit Node executable when --pi is a JS entry point")
    args = parser.parse_args()
    command = ([args.node] if args.node else []) + [args.pi]
    command += ["--mode", "rpc", "--no-session", "--no-extensions", "--no-skills",
                "--no-context-files", "--no-prompt-templates", "--no-themes",
                "--extension", args.extension]
    with tempfile.TemporaryDirectory(prefix="pi-app-extension-") as cwd:
        child = subprocess.Popen(command, cwd=cwd, stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        selector = selectors.DefaultSelector()
        selector.register(child.stdout, selectors.EVENT_READ, "stdout")
        selector.register(child.stderr, selectors.EVENT_READ, "stderr")
        buffers = {"stdout": b"", "stderr": b""}
        try:
            for request_id in ("first", "second"):
                child.stdin.write((json.dumps({"id": request_id, "type": "get_state"}) + "\n").encode())
                child.stdin.flush()
                deadline = time.monotonic() + 20
                received = False
                while time.monotonic() < deadline and not received:
                    for key, _ in selector.select(0.2):
                        chunk = os.read(key.fileobj.fileno(), 65536)
                        if not chunk:
                            selector.unregister(key.fileobj)
                            continue
                        buffers[key.data] += chunk
                        if key.data != "stdout":
                            continue
                        while b"\n" in buffers["stdout"]:
                            line, buffers["stdout"] = buffers["stdout"].split(b"\n", 1)
                            response = json.loads(line)
                            if response.get("id") == request_id:
                                if response.get("success") is not True:
                                    raise RuntimeError("get_state returned failure")
                                received = True
                    if child.poll() is not None:
                        raise RuntimeError(f"Pi exited with code {child.returncode}")
                if not received:
                    raise RuntimeError("Timed out waiting for get_state")
            print("PASS: installed app extension loads; Pi answers two RPC requests")
            return 0
        except (RuntimeError, BrokenPipeError, ValueError) as error:
            print(f"FAIL: {error}")
            print(buffers["stderr"].decode(errors="replace")[-3000:])
            return 1
        finally:
            selector.close()
            if child.poll() is None:
                child.terminate()
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


if __name__ == "__main__":
    raise SystemExit(main())
