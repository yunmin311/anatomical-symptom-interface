/**
 * The release gate must refuse to start while safety rules are unreviewed.
 *
 * This is a gate rather than an assertion in a unit test because it is a property
 * of the BUILT SERVER RUNNING, not of a function. `pnpm test` proves the release
 * profile reports itself honestly; it does not prove that starting a server in that
 * profile actually exits.
 *
 * Two things are checked, and both matter:
 *
 *   1. `ASI_RELEASE_PROFILE=release` refuses to boot.
 *   2. development still boots, so the gate is refusing for the stated reason
 *      rather than because something else is broken.
 *
 * If (2) were dropped, a gate that failed for any reason — a bad port, a missing
 * dependency, a syntax error — would read as a passing release gate.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SERVER_DIR = join(REPO, 'packages/server');
const ENTRY = join(SERVER_DIR, 'src/index.ts');

/**
 * A port nobody is using.
 *
 * This gate used to boot on hardcoded 8801/8802. Anything already on those ports
 * — on this machine an unrelated python3 process held 8802 — made the CONTROL
 * fail, and the failure reads as "the development profile will not boot", which
 * is a completely different claim from "the port was busy". A gate that can fail
 * for a reason unrelated to what it proves is worse than no gate, because it is
 * believed either way. Same fix as the HTTP-level server tests.
 */
function ephemeralPort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.on('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
}

/** Boot the server and resolve with how it exited. */
function boot(profile, port, dbPath) {
  return new Promise((res, rej) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', '--no-warnings', ENTRY],
      {
        cwd: SERVER_DIR,
        env: {
          ...process.env,
          ASI_DB_PATH: dbPath,
          ASI_PORT: String(port),
          ASI_RELEASE_PROFILE: profile,
          ANTHROPIC_API_KEY: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let out = '';
    child.stdout.on('data', (d) => {
      out += String(d);
    });
    child.stderr.on('data', (d) => {
      out += String(d);
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rej(new Error(`${profile} profile neither exited nor became ready:\n${out}`));
    }, 25_000);

    // If it becomes healthy, it booted, which is a FAILURE for the release profile.
    const poll = setInterval(async () => {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (r.ok) {
          clearInterval(poll);
          clearTimeout(timer);
          child.kill('SIGKILL');
          res({ booted: true, output: out });
        }
      } catch {
        /* not up yet */
      }
    }, 250);

    child.once('exit', (code) => {
      clearInterval(poll);
      clearTimeout(timer);
      res({ booted: false, code, output: out });
    });
  });
}

const dir = mkdtempSync(join(tmpdir(), 'asi-release-gate-'));
const problems = [];

try {
  const release = await boot('release', await ephemeralPort(), join(dir, 'release.sqlite'));
  if (release.booted) {
    problems.push('the server STARTED with ASI_RELEASE_PROFILE=release; unreviewed rules must block it');
  } else if (release.code === 0) {
    problems.push('the release profile refused with exit code 0, which reads as success');
  } else if (!/unreviewed|release|rule/i.test(release.output)) {
    problems.push(
      `the release profile refused for an unrecognised reason; it must say why:\n${release.output.slice(0, 400)}`,
    );
  } else {
    console.log(`release profile refused as required (exit ${release.code})`);
  }

  // The control: development must still boot, or gate (1) proves nothing.
  const development = await boot('development', await ephemeralPort(), join(dir, 'dev.sqlite'));
  if (!development.booted) {
    problems.push(
      `the DEVELOPMENT profile failed to boot, so the release refusal proves nothing:\n${development.output.slice(0, 400)}`,
    );
  } else {
    console.log('development profile still boots, so the refusal is specific');
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (problems.length) {
  console.error('\nrelease gate FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('release gate PASS');