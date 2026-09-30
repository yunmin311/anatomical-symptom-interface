#!/usr/bin/env node
/**
 * CI gate for release-safety metadata.
 *
 * The previous check grepped a number out of the health payload and treated an
 * empty match as green. That is a silent-pass failure mode: rename the field,
 * change the response shape, or let the server fail to start, and the check
 * still "passed".
 *
 * This parses the JSON and requires:
 *   - every field present, of the right primitive type
 *   - totalSafetyRules a positive integer (a zero-rule engine looks safe)
 *   - unreviewedSafetyRules between 0 and totalSafetyRules
 *   - the release profile stated explicitly
 *   - releaseReady consistent with the blocking rule list
 *
 * It then asserts the development build is HONEST about being unreviewed: if
 * time-critical rules are unreviewed, releaseReady must be false.
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: check-safety-metadata.mjs <health.json>');
  process.exit(2);
}

let raw;
try {
  raw = readFileSync(path, 'utf8');
} catch (e) {
  console.error(`::error::could not read health payload at ${path}: ${e.message}`);
  process.exit(1);
}

let health;
try {
  health = JSON.parse(raw);
} catch (e) {
  console.error(`::error::health payload is not valid JSON: ${e.message}`);
  console.error(`--- payload ---\n${raw}\n----------------`);
  process.exit(1);
}

const failures = [];

const requireNumber = (key) => {
  const v = health[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    failures.push(`${key} must be a finite number, got ${JSON.stringify(v)}`);
    return null;
  }
  return v;
};

const requireString = (key) => {
  const v = health[key];
  if (typeof v !== 'string' || v.length === 0) {
    failures.push(`${key} must be a non-empty string, got ${JSON.stringify(v)}`);
    return null;
  }
  return v;
};

const requireBool = (key) => {
  const v = health[key];
  if (typeof v !== 'boolean') {
    failures.push(`${key} must be a boolean, got ${JSON.stringify(v)}`);
    return null;
  }
  return v;
};

if (health.ok !== true) failures.push(`ok must be true, got ${JSON.stringify(health.ok)}`);

const profile = requireString('releaseProfile');
if (profile && profile !== 'development' && profile !== 'release') {
  failures.push(`releaseProfile must be 'development' or 'release', got "${profile}"`);
}
const unreviewed = requireNumber('unreviewedSafetyRules');
const total = requireNumber('totalSafetyRules');
const releaseReady = requireBool('releaseReady');
requireString('orchestrator');
requireNumber('writableFields');

if (total !== null && (!Number.isInteger(total) || total <= 0)) {
  failures.push(`totalSafetyRules must be a positive integer; a zero-rule engine reports "safe" for everything (got ${total})`);
}
if (total !== null && unreviewed !== null) {
  if (!Number.isInteger(unreviewed) || unreviewed < 0) {
    failures.push(`unreviewedSafetyRules must be a non-negative integer, got ${unreviewed}`);
  }
  if (unreviewed > total) {
    failures.push(`unreviewedSafetyRules (${unreviewed}) exceeds totalSafetyRules (${total})`);
  }
}

const blocking = health.blockingSafetyRules;
if (!Array.isArray(blocking)) {
  failures.push(`blockingSafetyRules must be an array, got ${JSON.stringify(blocking)}`);
} else if (releaseReady === true && blocking.length > 0) {
  failures.push(
    `releaseReady is true but ${blocking.length} blocking rule(s) are listed: ${blocking.join(', ')}`,
  );
} else if (releaseReady === false && blocking.length === 0) {
  failures.push('releaseReady is false but no blocking rules are listed — the gate is unexplained');
}

// The development build must not pretend its rules are validated.
if (profile === 'development' && unreviewed !== null && unreviewed > 0 && releaseReady !== false) {
  failures.push(
    `${unreviewed} rule(s) are unreviewed, so releaseReady must be false in the development profile`,
  );
}

if (failures.length) {
  console.error('::error::release-safety metadata check FAILED');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('--- payload ---\n' + raw + '\n----------------');
  process.exit(1);
}

console.log(
  `release-safety metadata OK: profile=${profile} rules=${total} unreviewed=${unreviewed} ` +
    `releaseReady=${releaseReady} blocking=${blocking.length}`,
);
if (releaseReady === false) {
  console.log(
    '::notice::this build is NOT release ready. Unreviewed safety rules are being surfaced ' +
      'as prototype guidance. It must not be pointed at real users.',
  );
}
process.exit(0);
