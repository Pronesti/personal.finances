import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function resetSyntheticRateLimits() {
  const cwd=fileURLToPath(new URL('../../backend/',import.meta.url));
  // Never clear a cache before independently checking the approved browser DB/roots.
  execFileSync('php',['artisan','tarjetas:test-target:check','--env=browser-testing'],{cwd,stdio:'pipe'});
  execFileSync('php',['artisan','cache:clear','--env=browser-testing'],{cwd,stdio:'pipe'});
}
