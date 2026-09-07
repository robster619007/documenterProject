// Runs Lighthouse CI, then sweeps the throwaway folders it leaves behind into
// lighthouse-logs/ so they never linger in the project root.
//
// Background: on WSL, Windows env vars (TMP/TEMP/LOCALAPPDATA) leak into the
// shell as "C:\Users\...\AppData\Local\...". chrome-launcher feeds those to build
// Chrome's user-data-dir; with no leading "/", Linux treats them as RELATIVE, so
// Chrome creates "lighthouse.NNNN" profile folders inside the current directory
// (the project). Trying to redirect Chrome's temp dir instead made Chrome's
// singleton lock fail on the slow /mnt/d mount ("Unable to connect to Chrome"),
// so rather than fight the launcher we let it run in its known-good default and
// simply relocate the leftovers afterwards. chrome-launcher normally deletes
// these on exit; the path quirk defeats its own cleanup, which is why they stay.
//
// This is a dev/test-only tool. Nothing here runs when the app itself runs
// (dev/build/preview or the deployed static site).
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logsDir = join(root, 'lighthouse-logs');
const sweepDir = join(logsDir, 'chrome-temp');

// Reports land in lighthouse-logs/reports (see lighthouserc.cjs upload target);
// swept Chrome profiles land in lighthouse-logs/chrome-temp, reset each run so it
// can't grow unbounded.
mkdirSync(join(logsDir, 'reports'), { recursive: true });
rmSync(sweepDir, { recursive: true, force: true });
mkdirSync(sweepDir, { recursive: true });

// Build fresh, then make a public-only copy of dist for auditing: the /dev harness
// pages ship test JS and are not part of the shipped site, so they must not be
// judged against the performance budgets. LH_DIST points the config at this copy.
console.log('[run-lh] Building the site…');
const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', env: process.env });
if (build.status !== 0) process.exit(build.status ?? 1);

const publicDist = join(logsDir, 'public-dist');
rmSync(publicDist, { recursive: true, force: true });
cpSync(join(root, 'dist'), publicDist, { recursive: true });
rmSync(join(publicDist, 'dev'), { recursive: true, force: true });

const env = { ...process.env };
env.CHROME_PATH = env.CHROME_PATH || chromium.executablePath();
env.LH_DIST = './lighthouse-logs/public-dist';

const lhciBin = join(root, 'node_modules', '.bin', 'lhci');
const result = spawnSync(lhciBin, ['autorun', `--config=${join(root, 'lighthouserc.cjs')}`], {
  cwd: root,
  stdio: 'inherit',
  env,
});

// A folder is a stray Chrome profile if it looks like "lighthouse.NNNN" or still
// carries the mangled Windows path (AppData / a literal backslash). None of the
// real project files match these.
const isStray = (name) =>
  /lighthouse\.\d+/.test(name) || name.includes('AppData') || name.includes('\\');

let moved = 0;
for (const name of readdirSync(root)) {
  if (!isStray(name)) continue;
  renameSync(join(root, name), join(sweepDir, name));
  moved++;
}
if (moved > 0) {
  console.log(`\n[run-lh] Swept ${moved} stray Chrome folder(s) into lighthouse-logs/chrome-temp/`);
}

// LHCI creates its own working directory, ".lighthouseci", in the project root and
// writes the per-run reports there. It has to live in cwd while lhci runs, so we
// relocate it here, once the run is done, into lighthouse-logs to keep the project
// root clean. The reports we keep are already copied to lighthouse-logs/reports by
// the config's upload target, so this move is purely tidying.
const lhciWork = join(root, '.lighthouseci');
if (existsSync(lhciWork)) {
  const dest = join(logsDir, 'lighthouseci-work');
  rmSync(dest, { recursive: true, force: true });
  renameSync(lhciWork, dest);
  console.log('[run-lh] Moved .lighthouseci/ into lighthouse-logs/lighthouseci-work/');
}

process.exit(result.status ?? 1);
