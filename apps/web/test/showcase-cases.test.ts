/**
 * The Showcase case scripts, checked against the live interview registry.
 *
 * A case is a promise to a demonstrator: "answer this, and that is what happens".
 * The promise breaks silently — the panel renders whatever the script says, and
 * clicking an option value the registry no longer has does nothing at all — so the
 * breakage has to be caught by a test rather than by somebody watching a live demo.
 *
 * It also enforces the rule the cases exist to respect: they describe what a person
 * felt, pointed at, or was doing. A condition name, a test result or a piece of
 * advice appearing in demonstration material is the same defect as one appearing in
 * the product, and the easiest way in is to be helpful while writing an example.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { INTERVIEW } from "@asi/shared";
import type { InterviewQuestion } from "@asi/shared";
import { SHOWCASE_CASES, caseById } from "../src/showcase/cases.ts";

const SHOULDER = INTERVIEW.shoulder ?? [];
const question = (id: string): InterviewQuestion => {
  const found = SHOULDER.find((q) => q.id === id);
  assert.ok(found, `showcase references ${id}, which the shoulder interview does not ask`);
  return found;
};

test("every case has words to type and something to show", () => {
  assert.ok(SHOWCASE_CASES.length >= 3, "the showcase needs at least three cases");
  assert.ok(SHOWCASE_CASES.length <= 5, "the showcase is scoped to five cases");
  const ids = SHOWCASE_CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "two cases share an id");
  for (const item of SHOWCASE_CASES) {
    assert.ok(item.utterance.trim().length > 10, `${item.id} has no utterance`);
    assert.ok(item.shows.trim().length > 10, `${item.id} does not say what it shows`);
    assert.ok(item.steps.length > 0, `${item.id} has no answer script`);
  }
});

test("every scripted answer is one the registry actually offers", () => {
  for (const item of SHOWCASE_CASES) {
    for (const step of item.steps) {
      const q = question(step.questionId);
      const values = Array.isArray(step.answer) ? step.answer : [step.answer];

      if (q.type === "boolean") {
        assert.ok(
          values.every((v) => v === "yes" || v === "no" || v === "unknown"),
          `${item.id}/${step.questionId} is boolean and was given ${JSON.stringify(step.answer)}`,
        );
        continue;
      }

      if (q.type === "text") {
        for (const value of values) {
          const isTheUncertaintyButton = q.uncertainty?.value === value;
          const isRealText =
            value.trim().length > 0 && value !== "unsure" && value !== "unknown";
          assert.ok(
            isTheUncertaintyButton || isRealText,
            `${item.id}/${step.questionId} is free text and was given "${value}", which reads as a refusal rather than an answer`,
          );
        }
        continue;
      }

      const declared = new Set((q.options ?? []).map((option) => option.value));
      assert.ok(declared.size > 0, `${item.id}/${step.questionId} has no options to pick`);
      for (const value of values) {
        assert.ok(
          declared.has(value),
          `${item.id}/${step.questionId} offers ${[...declared].join(", ")} — not "${value}"`,
        );
      }
      // An exclusive option mixed with a selective one records NOTHING, which is a
      // real domain behaviour but a useless thing to hand a demonstrator.
      const exclusive = new Set(
        (q.options ?? []).filter((o) => o.exclusive).map((o) => o.value),
      );
      const mixed =
        exclusive.size > 0 &&
        values.some((v) => exclusive.has(v)) &&
        values.some((v) => !exclusive.has(v));
      assert.ok(!mixed, `${item.id}/${step.questionId} mixes an exclusive answer with a selective one`);
    }
  }
});

test("a case does not answer a question its region would not ask", () => {
  for (const item of SHOWCASE_CASES) {
    for (const step of item.steps) {
      const q = question(step.questionId);
      assert.equal(q.region, "shoulder", `${step.questionId} is not a shoulder question`);
    }
  }
});

test("the order a case depends on is a case that exists", () => {
  for (const item of SHOWCASE_CASES) {
    for (const after of item.after ?? []) {
      assert.ok(caseById(after), `${item.id} says to run after ${after}, which is not a case`);
      assert.notEqual(after, item.id, `${item.id} says to run after itself`);
    }
  }
});

test("a case says what it is for, and names no condition, result or treatment", () => {
  // Demonstration material is read aloud to an audience, so the ban is on the whole
  // register: not just the domain's own rule, but the words that invite a clinician's
  // vocabulary into a patient-facing demo.
  const forbidden = [
    "diagnos",
    "tendonitis",
    "tear",
    "strain",
    "sprain",
    "fracture",
    "dislocation",
    "arthritis",
    "impingement",
    "rotator cuff",
    "frozen shoulder",
    "x-ray",
    "xray",
    "ultrasound",
    "mri",
    "scan shows",
    "blood test",
    "physio",
    "physiotherapy",
    "take ibuprofen",
    "ibuprofen",
    "paracetamol",
    "naproxen",
    "should see a doctor",
    "you should rest",
    "ice it",
    "diagnosis of",
  ];
  for (const item of SHOWCASE_CASES) {
    const text = [
      item.title,
      item.shows,
      item.utterance,
      ...(item.locate ?? []),
      ...(item.notes ?? []),
      ...item.steps.flatMap((step) => [step.how, ...[step.answer].flat()]),
    ]
      .join(" ")
      .toLowerCase();
    for (const word of forbidden) {
      assert.ok(
        !text.includes(word),
        `${item.id} contains "${word}". A case describes what someone felt or did; it does not name a condition, a result, or a treatment.`,
      );
    }
  }
});

test("a case says a structure was pointed at, never that it was found", () => {
  // Rule 7 of the product, in the place it is easiest to break: a demonstrator
  // improvising around a case will say "confirmed" unless the material never does.
  const confirmed = /\bconfirmed?\b/i;
  for (const item of SHOWCASE_CASES) {
    const text = [item.title, item.shows, item.utterance, ...(item.locate ?? []), ...(item.notes ?? [])].join(
      " ",
    );
    assert.ok(
      !confirmed.test(text),
      `${item.id} says a structure was "confirmed". The wording is "pointed at" or "indicated".`,
    );
  }
});