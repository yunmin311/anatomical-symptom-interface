#!/usr/bin/env node
/**
 * End-to-end API checks against a running server.
 *   pnpm --filter @asi/server start   (in another shell)
 *   node scripts/smoke.mjs
 */
const BASE = process.env.ASI_BASE ?? 'http://localhost:8787';

let pass = 0;
let fail = 0;

async function check(name, fn) {
  try {
    const r = await fn();
    if (r === true) {
      pass++;
      console.log(`  ok   ${name}`);
    } else {
      fail++;
      console.log(`  FAIL ${name} — ${r}`);
    }
  } catch (e) {
    fail++;
    console.log(`  FAIL ${name} — ${e.message}`);
  }
}

const get = (p) => fetch(`${BASE}${p}`).then((r) => r.json());
/** POSTs to the API namespace. Paths are given without the `/api` prefix. */
const post = (p, body) =>
  fetch(`${BASE}/api${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json().then((j) => ({ status: r.status, body: j })));
/** Raw fetch, for asserting an endpoint is absent. */
const raw = (method, p, body) =>
  fetch(`${BASE}/api${p}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const userProv = (rawText = null) => ({
  sourceType: 'user_statement',
  verificationStatus: 'user_confirmed',
  createdBy: 'user',
  rawText,
});
const selectionProv = () => ({
  sourceType: 'user_selection',
  verificationStatus: 'user_confirmed',
  createdBy: 'user',
});
const aiProv = () => ({
  sourceType: 'ai_inference',
  verificationStatus: 'unverified',
  createdBy: 'attacker',
  confidence: 0.95,
});

const OK = (status, ...codes) => (r) => {
  if (!codes.includes(r.status)) return `expected ${codes.join('/')} got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`;
  return true;
};

console.log(`smoke test against ${BASE}\n`);

let episodeId;
let refused;

/* ---------------- release safety metadata ---------------- */

await check('health publishes complete release-safety metadata', async () => {
  const h = await get('/api/health');
  for (const k of ['ok', 'orchestrator', 'releaseProfile', 'releaseReady', 'unreviewedSafetyRules', 'totalSafetyRules', 'blockingSafetyRules', 'writableFields']) {
    if (!(k in h)) return `health is missing "${k}"`;
  }
  if (typeof h.totalSafetyRules !== 'number' || h.totalSafetyRules <= 0) return 'totalSafetyRules must be positive';
  if (!Array.isArray(h.blockingSafetyRules)) return 'blockingSafetyRules must be an array';
  return true;
});

await check('the development build does not claim to be release ready', async () => {
  const h = await get('/api/health');
  if (h.unreviewedSafetyRules > 0 && h.releaseReady !== false) return 'releaseReady must be false while rules are unreviewed';
  return true;
});

/* ---------------- anatomy reference data ---------------- */

await check('all four V1 regions are published', async () => {
  const r = await get('/api/regions');
  return r.length === 4 ? true : `got ${r.length} regions`;
});

await check('structure terminology is not fabricated as verified codes', async () => {
  const r = await get('/api/regions/shoulder');
  const codes = r.subRegions.flatMap((s) => s.structures).filter((s) => s.coding?.status === 'verified');
  return codes.length === 0 ? true : `${codes.length} structures claim verified coding`;
});

/* ---------------- routing ---------------- */

await check('a grounded complaint localises with a region', async () => {
  const r = await post('/localise', { utterance: '右肩里面这里疼，抬手就明显' });
  const b = r.body;
  if (b.status !== 'grounded') return `expected grounded, got ${b.status}`;
  if (b.region !== 'shoulder') return `region=${b.region}`;
  if (b.side !== 'right') return `side=${b.side}`;
  if (b.consideredStructures?.some((s) => s.selectedByUser)) return 'model pre-selected a structure';
  return true;
});

await check('the response states which orchestrator read the text', async () => {
  const r = await post('/localise', { utterance: 'my lower back is stiff' });
  if (r.body.status !== 'grounded') return `expected grounded, got ${r.body.status}`;
  if (!['deterministic', 'model'].includes(r.body.by)) {
    return `by must be reported, got ${JSON.stringify(r.body.by)}`;
  }
  // Without a key the orchestrator is the offline one, and the response must
  // say so rather than leaving the caller to guess.
  const h = await get('/api/health');
  if (h.orchestrator === 'deterministic' && r.body.by !== 'deterministic') {
    return `server is deterministic but reported by=${r.body.by}`;
  }
  return true;
});

await check('the grounded episode records which orchestrator read the text', async () => {
  const h = await get('/api/health');
  const r = await post('/episodes', {
    personId: 'smoke',
    grounding: {
      status: 'grounded',
      region: 'shoulder',
      side: 'right',
      by: h.orchestrator === 'model' ? 'model' : 'deterministic',
    },
    mutations: [
      {
        fieldPath: 'location.region',
        value: 'shoulder',
        provenance: { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user' },
      },
    ],
  });
  if (r.status !== 201) return `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;
  const ep = await get(`/api/episodes/${r.body.id}`);
  const expected = h.orchestrator === 'model' ? 'model' : 'deterministic';
  if (ep.grounding?.by !== expected) {
    return `grounding.by=${JSON.stringify(ep.grounding?.by)}, expected ${expected}`;
  }
  return true;
});

await check('an unsupported response carries no orchestrator attribution', async () => {
  const r = await post('/localise', { utterance: 'my chest feels tight' });
  if (r.body.status !== 'unsupported') return `expected unsupported, got ${r.body.status}`;
  if (r.body.by !== undefined) return 'a refusal must not claim an orchestrator read it';
  return true;
});

await check('an ungrounded complaint is refused, never defaulted to shoulder', async () => {
  const r = await post('/localise', { utterance: 'I just feel a bit off' });
  if (r.body.status !== 'unsupported') return `expected unsupported, got ${r.body.status}`;
  if (!r.body.message) return 'refusal carried no message';
  if (r.body.region) return 'an unsupported result must not carry a region';
  return true;
});

await check('a non-MSK complaint routes out of the MSK workflow', async () => {
  const r = await post('/localise', { utterance: 'my chest feels tight and I cannot breathe' });
  if (r.body.status !== 'unsupported') return `expected unsupported, got ${r.body.status}`;
  if (r.body.reason !== 'out_of_scope') return `reason=${r.body.reason}`;
  return true;
});

await check('the refusal names no condition and no severity', async () => {
  const r = await post('/localise', { utterance: 'my chest feels tight' });
  const m = r.body.message ?? '';
  for (const bad of [/heart attack/i, /anxiety/i, /you have/i, /diagnos/i, /life.threatening/i]) {
    if (bad.test(m)) return `refusal matched ${bad}`;
  }
  return true;
});

await check('an unsupported episode cannot be created', async () => {
  const r = await post('/episodes', {
    personId: 'smoke',
    grounding: { status: 'unsupported', reason: 'out_of_scope' },
  });
  return r.status === 409 && r.body.error === 'episode_not_localised' ? true : `${r.status} ${JSON.stringify(r.body)}`;
});

/* ---------------- the removed bypass endpoints ---------------- */

await check('the old record PATCH endpoint is gone', async () => {
  const r = await raw('PATCH', '/episodes/whatever/record', { record: { quality: ['dull'] } });
  return r.status === 404 ? true : `expected 404, got ${r.status}`;
});

await check('the old provenance-only confirm endpoint is gone', async () => {
  const r = await raw('POST', '/episodes/whatever/confirm', {
    fieldPath: 'quality',
    value: ['dull'],
    verificationStatus: 'user_confirmed',
  });
  return r.status === 404 ? true : `expected 404, got ${r.status}`;
});

/* ---------------- the write path ---------------- */

await check('a grounded episode is created with validated mutations', async () => {
  const r = await post('/episodes', {
    personId: 'smoke',
    displayName: 'Smoke',
    grounding: { status: 'grounded', region: 'knee', side: 'left', by: 'deterministic' },
    mutations: [
      { fieldPath: 'location.region', value: 'knee', provenance: userProv() },
      { fieldPath: 'location.side', value: 'left', provenance: userProv() },
      { fieldPath: 'location.userSelectedStructureIds', value: ['asi:knee.patella'], provenance: selectionProv() },
      { fieldPath: 'function.intensity', value: 5, provenance: userProv() },
    ],
  });
  if (r.status !== 201) return `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`;
  episodeId = r.body.id;
  return true;
});

await check('the value and its provenance are both persisted', async () => {
  const ep = await get(`/api/episodes/${episodeId}`);
  if (ep.record.location.side !== 'left') return `side=${ep.record.location.side}`;
  if (ep.provenance['location.side']?.sourceType !== 'user_statement') return 'no provenance for the written value';
  return true;
});

await check('a field with no write has no provenance', async () => {
  const ep = await get(`/api/episodes/${episodeId}`);
  if ('location.depth' in ep.provenance) return 'a never-written field has provenance';
  return true;
});

await check('a model cannot write a user-grounded field', async () => {
  const r = await post(`/episodes/${episodeId}/mutations`, {
    mutations: [{ fieldPath: 'location.userSelectedStructureIds', value: ['asi:knee.meniscus-medial'], provenance: aiProv() }],
  });
  return r.status === 422 && r.body.error === 'field_policy_violation' ? true : `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;
});

await check('a rejected batch rolls back the legal writes with it', async () => {
  const r = await post(`/episodes/${episodeId}/mutations`, {
    mutations: [
      { fieldPath: 'quality', value: ['dull'], provenance: userProv() },
      { fieldPath: 'quality', value: ['dull'], provenance: aiProv() },
    ],
  });
  if (r.status !== 422) return `expected 422, got ${r.status}`;
  const ep = await get(`/api/episodes/${episodeId}`);
  return ep.provenance['quality'] === undefined ? true : 'a rolled-back batch still wrote a field';
});

await check('an unknown field path is rejected', async () => {
  const r = await post(`/episodes/${episodeId}/mutations`, {
    mutations: [{ fieldPath: 'location.notAField', value: 'x', provenance: userProv() }],
  });
  return r.status === 422 ? true : `expected 422, got ${r.status}`;
});

await check('gaps cannot be written by a client', async () => {
  const r = await post(`/episodes/${episodeId}/mutations`, {
    mutations: [{ fieldPath: 'gaps', value: ['quality'], provenance: { sourceType: 'system_rule', verificationStatus: 'unverified', createdBy: 'x' } }],
  });
  return r.status === 422 ? true : `expected 422, got ${r.status}`;
});

/* ---------------- ISSUE 1: safety semantics end to end ---------------- */

await check('ISSUE 1: bladder = no does NOT fire cauda equina', async () => {
  const r = await post('/episodes', {
    personId: 'smoke',
    grounding: { status: 'grounded', region: 'lower_back', side: 'midline' },
    answers: [{ questionId: 'lower_back.bladder', raw: 'no', wroteFields: [], createdBy: 'user' }],
  });
  if (r.status !== 201) return `${r.status}`;
  const safety = (await get(`/api/episodes/${r.body.id}`)).safety;
  return safety.flags.some((f) => f.ruleId === 'msk.cauda_equina') === false
    ? true
    : 'an explicit "no" fired the cauda equina rule';
});

await check('ISSUE 1: bladder = yes DOES fire cauda equina', async () => {
  const r = await post('/episodes', {
    personId: 'smoke',
    grounding: { status: 'grounded', region: 'lower_back', side: 'midline' },
    answers: [{ questionId: 'lower_back.bladder', raw: 'yes', wroteFields: [], createdBy: 'user' }],
  });
  if (r.status !== 201) return `${r.status}`;
  const safety = (await get(`/api/episodes/${r.body.id}`)).safety;
  const flag = safety.flags.find((f) => f.ruleId === 'msk.cauda_equina');
  return flag ? true : 'an explicit "yes" did not reach the cauda equina rule';
});

await check('ISSUE 1: "I am not sure" is stored as unknown, not as no', async () => {
  const r = await post('/episodes', {
    personId: 'smoke',
    grounding: { status: 'grounded', region: 'lower_back', side: 'midline' },
    answers: [{ questionId: 'lower_back.bladder', raw: "don't know", wroteFields: [], createdBy: 'user' }],
  });
  const ep = await get(`/api/episodes/${r.body.id}`);
  const a = ep.answers['lower_back.bladder'];
  if (!a) return 'answer not persisted';
  if (a.triState !== 'unknown') return `triState=${a.triState}`;
  return true;
});

await check('a stale answer from another region cannot fire a safety rule', async () => {
  // A knee episode whose answer map carries a lower-back "yes". Region-scoped
  // signals must ignore it, so msk.systemic_symptoms must not fire.
  const r = await post('/episodes', {
    personId: 'smoke',
    grounding: { status: 'grounded', region: 'knee', side: 'left' },
    mutations: [
      {
        fieldPath: 'temporal.durationValue',
        value: 5,
        provenance: { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user' },
      },
      {
        fieldPath: 'temporal.durationUnit',
        value: 'days',
        provenance: { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user' },
      },
    ],
    answers: [{ questionId: 'lower_back.systemic', raw: 'yes', wroteFields: [], createdBy: 'user' }],
  });
  if (r.status !== 201) return `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;
  const ep = await get(`/api/episodes/${r.body.id}`);
  if (ep.safety.signals.fever_or_systemic_unwell !== 'not_asked') {
    return `signal=${ep.safety.signals.fever_or_systemic_unwell}, expected not_asked`;
  }
  if (ep.safety.flags.some((f) => f.ruleId === 'msk.systemic_symptoms')) {
    return 'a stale lower-back answer fired a rule on a knee episode';
  }
  return true;
});

await check('the same answer does fire in the region that asks it', async () => {
  const r = await post('/episodes', {
    personId: 'smoke',
    grounding: { status: 'grounded', region: 'lower_back', side: 'midline' },
    mutations: [
      {
        fieldPath: 'temporal.durationValue',
        value: 5,
        provenance: { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user' },
      },
      {
        fieldPath: 'temporal.durationUnit',
        value: 'days',
        provenance: { sourceType: 'user_statement', verificationStatus: 'user_confirmed', createdBy: 'user' },
      },
    ],
    answers: [{ questionId: 'lower_back.systemic', raw: 'yes', wroteFields: [], createdBy: 'user' }],
  });
  const ep = await get(`/api/episodes/${r.body.id}`);
  if (ep.safety.signals.fever_or_systemic_unwell !== 'yes') {
    return `signal=${ep.safety.signals.fever_or_systemic_unwell}, expected yes`;
  }
  if (!ep.safety.flags.some((f) => f.ruleId === 'msk.systemic_symptoms')) {
    return 'the rule did not fire in the region that asks the question';
  }
  return true;
});

await check('ISSUE 1: the safety question wrote no record field', async () => {
  const r = await post('/episodes', {
    personId: 'smoke',
    grounding: { status: 'grounded', region: 'lower_back', side: 'midline' },
    answers: [{ questionId: 'lower_back.bladder', raw: 'yes', wroteFields: [], createdBy: 'user' }],
  });
  const ep = await get(`/api/episodes/${r.body.id}`);
  const touched = ep.record.gaps.includes('quality') ? 'quality' : null;
  return !Object.keys(ep.provenance).some((k) => ['quality', 'triggers', 'function.activitiesAffected'].includes(k))
    ? true
    : `a safety-only answer wrote ${touched ?? 'a record field'}`;
});

/* ---------------- ISSUE 4: the interview gate ---------------- */

await check('an unsupported episode cannot start a region interview', async () => {
  const r = await post('/episodes', { personId: 'smoke', grounding: { status: 'unsupported', reason: 'ungrounded' } });
  return r.status === 409 ? true : `an unsupported episode was created (${r.status})`;
});

await check('a grounded episode gets a region question', async () => {
  const r = await post(`/episodes/${episodeId}/interview/next`, {});
  if (r.status !== 200) return `${r.status}`;
  if (r.body.blocked) return 'a grounded episode was blocked from the interview';
  if (!r.body.next) return 'no next question';
  return true;
});

/* ---------------- ISSUE 5 + 3: the summary ---------------- */

await check('a client cannot make a candidate both selected and unselected', async () => {
  // The client writes a candidate flag that CONTRADICTS the canonical id set:
  // it claims 'selected' for a structure the user did not select. The canonical
  // set must win, and the summary must never list it in both sections.
  const r = await post('/episodes', {
    personId: 'smoke',
    grounding: { status: 'grounded', region: 'knee', side: 'left' },
    mutations: [
      {
        fieldPath: 'location.userSelectedStructureIds',
        value: ['asi:knee.patella'],
        provenance: { sourceType: 'user_selection', verificationStatus: 'user_confirmed', createdBy: 'user' },
      },
      {
        // Both candidates present, but the flags are deliberately wrong: patella
        // (which IS selected) says false, meniscus (which is NOT) says true.
        fieldPath: 'consideredStructures',
        value: [
          { structureId: 'asi:knee.patella', rationale: 'Near the kneecap.', confidence: 0.5, selectedByUser: false },
          { structureId: 'asi:knee.meniscus-medial', rationale: 'Nearby structure.', confidence: 0.4, selectedByUser: true },
        ],
        provenance: { sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'seed', confidence: 0.5 },
      },
    ],
  });
  if (r.status !== 201) return `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;
  const id = r.body.id;

  const ep = await get(`/api/episodes/${id}`);
  const by = (sid) => ep.record.consideredStructures.find((c) => c.structureId === sid);
  if (by('asi:knee.patella')?.selectedByUser !== true) return 'the canonical selection was not applied on read';
  if (by('asi:knee.meniscus-medial')?.selectedByUser !== false) return 'a stale selected flag survived';

  // Rationale and confidence are untouched by the projection.
  if (by('asi:knee.patella')?.rationale !== 'Near the kneecap.') return 'rationale was altered';
  if (by('asi:knee.meniscus-medial')?.confidence !== 0.4) return 'confidence was altered';
  if (ep.record.consideredStructures.length !== 2) return 'a candidate was added or dropped';

  const { summary } = await get(`/api/episodes/${id}/summary`);
  const overlap = summary.visualSelections.filter((v) => summary.unselectedSuggestions.includes(v));
  if (overlap.length) return `listed in both sections: ${JSON.stringify(overlap)}`;
  if (JSON.stringify(summary.visualSelections) !== JSON.stringify(['Patella'])) {
    return `visualSelections=${JSON.stringify(summary.visualSelections)}`;
  }
  if (JSON.stringify(summary.unselectedSuggestions) !== JSON.stringify(['Medial meniscus'])) {
    return `unselectedSuggestions=${JSON.stringify(summary.unselectedSuggestions)}`;
  }
  return true;
});

await check('a selected id the model never suggested is still a visual selection', async () => {
  const r = await post('/episodes', {
    personId: 'smoke',
    grounding: { status: 'grounded', region: 'knee', side: 'left' },
    mutations: [
      {
        fieldPath: 'location.userSelectedStructureIds',
        value: ['asi:knee.lcl'],
        provenance: { sourceType: 'user_selection', verificationStatus: 'user_confirmed', createdBy: 'user' },
      },
      {
        fieldPath: 'consideredStructures',
        value: [],
        provenance: { sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'seed', confidence: 0.5 },
      },
    ],
  });
  const ep = await get(`/api/episodes/${r.body.id}`);
  if (JSON.stringify(ep.record.location.userSelectedStructureIds) !== JSON.stringify(['asi:knee.lcl'])) {
    return 'the selection was lost';
  }
  if (ep.record.consideredStructures.length !== 0) return 'a candidate was invented';
  const { summary } = await get(`/api/episodes/${r.body.id}/summary`);
  if (JSON.stringify(summary.visualSelections) !== JSON.stringify(['Lateral collateral ligament'])) {
    return `visualSelections=${JSON.stringify(summary.visualSelections)}`;
  }
  return true;
});

await check('an unanswered field is rendered as "not asked", never a negative', async () => {
  const { summary } = await get(`/api/episodes/${episodeId}/summary`);
  const find = (label) => summary.history.find((h) => h.label === label)?.value;
  if (find('Systemic symptoms') !== 'not asked') return `Systemic symptoms: ${find('Systemic symptoms')}`;
  if (find('Sleep affected') !== 'not asked') return `Sleep affected: ${find('Sleep affected')}`;
  return true;
});

await check('a visual selection is reported as a location, not a confirmation', async () => {
  const { summary } = await get(`/api/episodes/${episodeId}/summary`);
  if (summary.visualSelections.length !== 1) return `visualSelections=${JSON.stringify(summary.visualSelections)}`;
  if (/confirmed/i.test(JSON.stringify(summary))) return 'the summary still says "confirmed"';
  return true;
});

await check('clearing a selection preserves the suggestion, it does not delete it', async () => {
  // The summary separates "areas you pointed to" from "suggested, not acted on".
  // Deselecting must move a structure from the first to the second, never remove
  // it from both, or the record loses evidence of what was considered.
  const r = await post('/episodes', {
    personId: 'smoke',
    grounding: { status: 'grounded', region: 'knee', side: 'left' },
    mutations: [
      {
        fieldPath: 'location.userSelectedStructureIds',
        value: ['asi:knee.patella'],
        provenance: { sourceType: 'user_selection', verificationStatus: 'user_confirmed', createdBy: 'user' },
      },
      {
        fieldPath: 'consideredStructures',
        value: [
          { structureId: 'asi:knee.patella', confidence: 0.5, selectedByUser: true },
          { structureId: 'asi:knee.meniscus-medial', confidence: 0.4, selectedByUser: false },
        ],
        provenance: { sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'seed', confidence: 0.5 },
      },
    ],
  });
  if (r.status !== 201) return `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`;
  const id = r.body.id;

  let s = (await get(`/api/episodes/${id}/summary`)).summary;
  if (s.visualSelections.length !== 1 || s.unselectedSuggestions.length !== 1) {
    return `before: selected=${s.visualSelections.length} unselected=${s.unselectedSuggestions.length}`;
  }

  // The user changes their mind: clear the selection, keep the candidate.
  const clear = await post(`/episodes/${id}/mutations`, {
    mutations: [
      {
        fieldPath: 'location.userSelectedStructureIds',
        value: [],
        provenance: { sourceType: 'user_edited', verificationStatus: 'user_confirmed', createdBy: 'user' },
      },
      {
        fieldPath: 'consideredStructures',
        value: [
          { structureId: 'asi:knee.patella', confidence: 0.5, selectedByUser: false },
          { structureId: 'asi:knee.meniscus-medial', confidence: 0.4, selectedByUser: false },
        ],
        provenance: { sourceType: 'ai_inference', verificationStatus: 'unverified', createdBy: 'seed', confidence: 0.5 },
      },
    ],
  });
  if (clear.status !== 200) return `${clear.status} ${JSON.stringify(clear.body).slice(0, 160)}`;

  s = (await get(`/api/episodes/${id}/summary`)).summary;
  if (s.visualSelections.length !== 0) return `selection was not cleared: ${JSON.stringify(s.visualSelections)}`;
  if (s.unselectedSuggestions.length !== 2) {
    return `deselection DELETED a suggestion: unselected=${JSON.stringify(s.unselectedSuggestions)}`;
  }
  if (!s.unselectedSuggestions.includes('Patella')) return 'the deselected candidate was lost';
  return true;
});

await check('the plain-text export disclaims diagnosis and lists outstanding fields', async () => {
  const t = await fetch(`${BASE}/api/episodes/${episodeId}/summary.txt`).then((r) => r.text());
  if (!/not a diagnosis/i.test(t)) return 'missing disclaimer';
  if (!/NOT ESTABLISHED/.test(t)) return 'missing outstanding fields section';
  if (/Systemic symptoms: none reported/.test(t)) return 'claimed "none reported" for an unasked field';
  return true;
});

/* ---------------- health map ---------------- */

await check('the health map indexes episodes by body region', async () => {
  const m = await get('/api/healthmap/smoke');
  return m.length >= 1 ? true : JSON.stringify(m);
});

await check('seeded history shows up with a recurrence', async () => {
  const eps = await get('/api/episodes?personId=local');
  const knee = eps.filter((e) => e.region === 'knee');
  return knee.length >= 2 && knee[0].record.temporal.isRecurrence
    ? true
    : `expected a recurring knee history, got ${knee.length}`;
});

void refused;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
