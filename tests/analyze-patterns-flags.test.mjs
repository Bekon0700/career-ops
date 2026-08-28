// analyze-patterns.mjs must reject a mistyped flag and an unusable
// --min-threshold/--min-vendor-n value instead of silently ignoring the flag
// or falling back to the default (#3113) — the same failure class #2982
// fixed for four other CLIs. Mirrors tests/funnel-velocity-flags.test.mjs.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(ROOT, 'analyze-patterns.mjs');
const SANDBOX = mkdtempSync(join(tmpdir(), 'career-ops-analyze-patterns-flags-'));

after(() => rmSync(SANDBOX, { recursive: true, force: true }));

function runAnalyze(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    // No applications.md in the sandbox: flag validation runs long before the
    // tracker is read, so every case here is decided before that matters.
    env: { ...process.env, CAREER_OPS_ROOT: SANDBOX },
  });
  assert.equal(result.error, undefined, `analyze-patterns.mjs failed to spawn: ${result.error?.message}`);
  assert.equal(result.signal, null, `analyze-patterns.mjs was killed by ${result.signal} (timeout?)`);
  return { ...result, all: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

test('valid invocation with no flags behaves as before (no flag-validation error)', () => {
  const result = runAnalyze();
  assert.notEqual(result.status, 2, `unexpected usage error: ${result.all}`);
  assert.doesNotMatch(result.all, /unrecognized flag/i);
  assert.doesNotMatch(result.all, /requires an integer/i);
  // No tracker in the sandbox -> analyze() reports its own "no applications" error.
  assert.match(result.stdout, /No applications found in tracker/);
});

test('a valid --min-threshold and --min-vendor-n value is accepted', () => {
  const result = runAnalyze('--min-threshold', '3', '--min-vendor-n', '10');
  assert.notEqual(result.status, 2, `unexpected usage error: ${result.all}`);
  assert.doesNotMatch(result.all, /unrecognized flag/i);
  assert.doesNotMatch(result.all, /requires an integer/i);
  assert.match(result.stdout, /No applications found in tracker/);
});

test('--min-threshold=0 is accepted (0 is a valid "no minimum")', () => {
  const result = runAnalyze('--min-threshold=0');
  assert.notEqual(result.status, 2, `unexpected usage error: ${result.all}`);
  assert.doesNotMatch(result.all, /requires an integer/i);
});

test('--help prints usage and exits 0', () => {
  const result = runAnalyze('--help');
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.all}`);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /--min-threshold/);
  assert.match(result.stdout, /--min-vendor-n/);
});

test('an unknown flag exits 2 and names it', () => {
  const result = runAnalyze('--min-threshhold', '3');
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /unrecognized flag\(s\): --min-threshhold/);
});

test('--min-threshold with a non-numeric value exits 2 and names the flag', () => {
  const result = runAnalyze('--min-threshold', 'abc');
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--min-threshold requires an integer/);
  assert.match(result.stderr, /"abc"/);
});

test('--min-vendor-n with a non-numeric value exits 2 and names the flag', () => {
  const result = runAnalyze('--min-vendor-n', 'xyz');
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--min-vendor-n requires an integer/);
  assert.match(result.stderr, /"xyz"/);
});

test('--min-vendor-n 0 exits 2 (a floor of 0 defeats the sample-size guard)', () => {
  const result = runAnalyze('--min-vendor-n', '0');
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--min-vendor-n requires an integer >= 1/);
});

test('a negative --min-vendor-n exits 2', () => {
  const result = runAnalyze('--min-vendor-n=-3');
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--min-vendor-n requires an integer/);
});

test('a negative --min-threshold exits 2', () => {
  const result = runAnalyze('--min-threshold=-1');
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--min-threshold requires an integer/);
});

test('--min-threshold without a value exits 2 instead of silently using the default', () => {
  const result = runAnalyze('--min-threshold');
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /--min-threshold requires a value/);
});

test('--help plus an unknown flag still fails', () => {
  const result = runAnalyze('--help', '--bogus');
  assert.equal(result.status, 2, `expected exit 2, got ${result.status}: ${result.all}`);
  assert.match(result.stderr, /unrecognized flag\(s\): --bogus/);
  assert.doesNotMatch(result.stdout, /Usage:/);
});
