import { useEffect, useRef, useState } from "react";
import { nextQuestion, questionProgress, REGIONS, INTERVIEW } from "@asi/shared";
import type { InterviewQuestion } from "@asi/shared";
import { anatomy, useSession } from "../state/session.ts";
import { EmptyState, StatusTag } from "./primitives.tsx";

export function InterviewPanel() {
  const { record, answers, answer, editingQuestionId, cancelEditAnswer } = useSession();
  const context = { record, answers };
  const next = nextQuestion(context);
  const progress = questionProgress(context);

  // An edit overrides the next question. It must, because the next question is derived
  // from what is UNANSWERED: after a correction the question is still answered, so the
  // panel would otherwise walk straight past the thing being corrected.
  const editing =
    editingQuestionId === null
      ? null
      : (INTERVIEW[record.location.region] ?? []).find(
          (q) => q.id === editingQuestionId,
        ) ?? null;
  const question = editing ?? next;
  /**
   * Where this question sits, and how much is left.
   *
   * "0 of 8 answered" was the whole of it, and every part of that was a poor
   * answer to a question a person actually has: it did not say which question
   * they were on, it did not say how many were left, and a count called
   * "answered" is ambiguous precisely when it matters — "I am not sure" is a
   * real answer, and it is not the same as a yes.
   *
   * The ordinal is the question's index in the region's own question list, which
   * is a fact rather than an inference. It is deliberately NOT derived from
   * `progress.total`: that counts only the questions whose `showIf` currently
   * applies, so counting against it would report a position that does not exist
   * whenever a conditional question is out of scope. The two numbers answer
   * different questions and are labelled as such.
   */
  const regionQuestions = INTERVIEW[record.location.region] ?? [];
  const position = question ? regionQuestions.findIndex((q) => q.id === question.id) + 1 : 0;
  const openCount = progress.outstanding.length;
  const done = progress.total > 0 ? (progress.total - openCount) / progress.total : 0;

  if (!question)
    return (
      <EmptyState
        title="You have reached the end of these questions."
        action={
          <p className="small">
            Review the details before saving your episode.
          </p>
        }
      >
        {progress.answered} answers added; {progress.outstanding.length}{" "}
        questions remain unanswered or uncertain. This is a symptom record, not
        a diagnosis.
      </EmptyState>
    );

  return (
    <section className="panel interview-panel" aria-label="Current question">
      {editing && (
        <div className="interview-edit-banner" role="status">
          <span>
            <strong>Changing an answer you already gave.</strong> Your previous
            answer is replaced, not kept.
          </span>
          <button
            className="btn btn--quiet"
            onClick={() => {
              cancelEditAnswer();
            }}
          >
            Cancel
          </button>
        </div>
      )}
      <div className="interview-progress">
        <p className="interview-progress__where">
          <span className="eyebrow">
            {editing ? 'Changing an answer' : 'Now asking'}
          </span>
          <strong>
            Question {position} of {regionQuestions.length}
          </strong>
          <span className="small">
            {REGIONS[record.location.region].label} questions
          </span>
        </p>
        <p className="interview-progress__counts">
          <span>
            <strong>{progress.total - openCount}</strong> of {progress.total} answered
          </span>
          <span aria-hidden="true"> · </span>
          <span>
            <strong>{openCount}</strong> still open
          </span>
        </p>
        {/*
          A determinate bar, because "5 of 8" and a third of the way along are
          the same fact and one of them survives being glanced at.
        */}
        <div
          className="interview-progress__track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={progress.total - openCount}
          aria-label="Questions answered"
        >
          <span style={{ width: `${Math.round(done * 100)}%` }} />
        </div>
        {/*
          What "answered" means, said out loud. This is the one place a user can
          be told that declining to answer is recorded rather than guessed, and
          the sentence above the bar is what they will read when they wonder
          whether "I am not sure" cost them anything.
        */}
        <p className="interview-progress__note small">
          “I am not sure” is recorded as an answer. It stays separate from “no”,
          and nothing is filled in for you.
        </p>
      </div>
      <QuestionForm
        key={question.id}
        question={question}
        onAnswer={(value, triState) => {
          answer(question.id, value, triState);
          if (question.highlightStructureIds)
            anatomy.apply({
              type: "highlight",
              structureIds: question.highlightStructureIds,
              as: "candidate",
            });
        }}
      />
    </section>
  );
}

function QuestionForm({
  question,
  onAnswer,
}: {
  question: InterviewQuestion;
  onAnswer: (value: unknown, triState?: "yes" | "no" | "unknown") => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const prompt = useRef<HTMLLegendElement>(null);
  useEffect(() => {
    prompt.current?.focus();
  }, []);
  const isMulti = question.type === "multi";
  const isText = question.type === "text";
  const options =
    question.type === "boolean"
      ? [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
          { value: "unknown", label: "I am not sure" },
        ]
      : question.options;
  const canContinue = isText ? Boolean(text.trim()) : selected.length > 0;
  const exclusiveValues = new Set(
    (options ?? []).filter((option) => option.exclusive).map((option) => option.value),
  );
  const updateSelection = (value: string, checked: boolean) => {
    if (!isMulti) {
      setSelected([value]);
      return;
    }
    if (!checked) {
      setSelected(selected.filter((current) => current !== value));
      return;
    }
    // An exclusive uncertainty response replaces the whole selection, and any
    // definite selection removes it. The domain also treats them as incompatible.
    setSelected(
      exclusiveValues.has(value)
        ? [value]
        : [...selected.filter((current) => !exclusiveValues.has(current)), value],
    );
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!canContinue) return;
        const values = isText ? [text.trim()] : selected;
        onAnswer(isMulti ? values : values[0], isText ? "yes" : undefined);
      }}
    >
      <div className="question-context">
        {question.safetyRuleId && (
          <StatusTag>Safety-related question</StatusTag>
        )}
        <span className="small">
          {question.required ? "Required question" : "Optional question"}
        </span>
      </div>
      <fieldset className="question" aria-describedby="question-instruction">
        <legend className="question__prompt" ref={prompt} tabIndex={-1}>
          {question.prompt}
        </legend>
        <p id="question-instruction" className="small">
          {isMulti
            ? "Select all that apply, then continue."
            : isText
              ? "Answer in your own words."
              : "Select one answer, then continue."}
        </p>
        {options && (
          <div
            className={`answer-options ${isMulti ? "answer-options--multi" : ""}`}
          >
            {options.map((option) => (
              <label
                key={option.value}
                className={`answer-option ${selected.includes(option.value) ? "answer-option--selected" : ""}`}
              >
                <input
                  type={isMulti ? "checkbox" : "radio"}
                  name={question.id}
                  value={option.value}
                  checked={selected.includes(option.value)}
                  onChange={(event) => updateSelection(option.value, event.target.checked)}
                />
                <span>
                  <span className="option__label">{option.label}</span>
                  {"hint" in option && (
                    <span className="option__hint">{option.hint}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}
        {isText && (
          <>
            <label htmlFor="question-answer" className="sr-only">
              Your answer
            </label>
            <textarea
              id="question-answer"
              rows={4}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            {question.uncertainty && (
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => {
                  const uncertainty = question.uncertainty;
                  if (uncertainty) onAnswer(uncertainty.value, "unknown");
                }}
              >
                {question.uncertainty.label}
              </button>
            )}
          </>
        )}
        {!options && !isText && (
          <p className="notice">
            This question format is not available in this prototype. Your
            existing answers remain in the current record.
          </p>
        )}
      </fieldset>
      {question.rationale && (
        <details className="question-rationale">
          <summary>Why we ask this</summary>
          <p>{question.rationale}</p>
        </details>
      )}
      <div className="actions">
        <span className="small">
          {isMulti && selected.length > 0
            ? `${selected.length} selected`
            : "Your answer is added when you continue."}
        </span>
        <button className="btn btn--primary" disabled={!canContinue}>
          Continue
        </button>
      </div>
    </form>
  );
}
