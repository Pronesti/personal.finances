#!/usr/bin/env python3
"""Synthetic slow-worker protocol only; no parser/provider/financial access."""
import json,os,subprocess,sys,time
os.umask(0o077)
settings=json.load(sys.stdin)
child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(900)'])
with open(sys.argv[1],'x') as marker:
 json.dump({'worker':os.getpid(),'descendant':child.pid,'originalStart':settings['originalStart'],'originalDeadline':settings['originalDeadline'],'credentialsPresent':any(name in os.environ for name in ['APP_KEY','DB_PASSWORD','ANTHROPIC_API_KEY'])},marker)
try:
 for phase in settings['phases']:
  if phase['kind']=='ocr':print(json.dumps({'event':'ocr_start','attempt':phase['attempt']}),flush=True)
  time.sleep(phase['duration_ms']/1000)
  if phase['kind']=='ocr':print(json.dumps({'event':'ocr_end','monotonic_ms':time.monotonic_ns()/1e6}),flush=True)
 time.sleep(settings['cleanup_ms']/1000)
 print(json.dumps({'event':'result','value':{'ok':True}}),flush=True)
finally:
 child.terminate();child.wait(timeout=1)
