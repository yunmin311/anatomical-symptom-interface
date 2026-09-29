/**
 * @asi/shared — the domain core.
 *
 * Everything in here is pure, deterministic, dependency-light and usable from
 * the browser, the server, a test runner, and a future CLI. There is no I/O
 * here and no network calls. That is deliberate: the safety-critical parts
 * (provenance invariants, red-flag rules, summary rendering) must be verifiable
 * without a model in the loop.
 */
export * from './provenance.ts';
export * from './anatomy.ts';
export * from './symptom.ts';
export * from './grounding.ts';
export * from './summary.ts';
export * from './interview/engine.ts';
export * from './rules/redflags.ts';
