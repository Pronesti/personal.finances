#!/usr/bin/env python3
"""Private process group with a local RSS supervisor; no shell or application environment."""
import os
import signal
import subprocess
import sys
import time
import psutil

os.umask(0o077)
os.setsid()
if len(sys.argv) < 2:
    sys.exit(2)
child = subprocess.Popen(sys.argv[1:])
owner = psutil.Process(os.getpid())
try:
    while child.poll() is None:
        rss = owner.memory_info().rss
        for process in owner.children(recursive=True):
            try:
                rss += process.memory_info().rss
            except psutil.NoSuchProcess:
                pass
        if rss > 768 * 1024 * 1024:
            print('{"code":"processing_memory_limit"}', file=sys.stderr, flush=True)
            os.killpg(os.getpgrp(), signal.SIGKILL)
        time.sleep(0.05)
    sys.exit(child.returncode)
finally:
    for process in owner.children(recursive=True):
        try:
            process.kill()
            process.wait(timeout=1)
        except psutil.NoSuchProcess:
            pass
