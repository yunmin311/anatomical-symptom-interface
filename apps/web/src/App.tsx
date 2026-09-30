import { useEffect, useRef, useState } from "react";
import { REGIONS } from "@asi/shared";
import { BodyMap } from "./anatomy/BodyMap.tsx";
import { BodyIndex } from "./anatomy/BodyIndex.tsx";
import { InterviewPanel } from "./ui/InterviewPanel.tsx";
import { SafetyBanner } from "./ui/SafetyBanner.tsx";
import { SummaryPanel } from "./ui/SummaryPanel.tsx";
import { HistoryPanel } from "./ui/HistoryPanel.tsx";
import { PageHeading, EmptyState } from "./ui/primitives.tsx";
import { useSession } from "./state/session.ts";
import type { Stage } from "./state/session.ts";

const TITLES: Record<Stage, string> = {
  describe: "What are you feeling?",
  locate: "Locate your discomfort",
  clarify: "Check the starting area",
  unsupported: "No location established",
  interview: "Describe the experience",
  review: "Review your account",
  history: "Your body, over time",
};
const TASKS: Record<Stage, string> = {
  describe: "New episode",
  locate: "Body / Location",
  clarify: "Body / Location",
  unsupported: "New episode",
  interview: "Location / Experience",
  review: "Experience / Record",
  history: "Body / History",
};

export function App() {
  const {
    stage,
    setStage,
    utterance,
    setUtterance,
    describe,
    busy,
    error,
    safety,
    refusal,
    clarification,
    record,
    save,
    reset,
    summary,
  } = useSession();
  const [returnStage, setReturnStage] = useState<Stage>("describe");
  const dialog = useRef<HTMLDialogElement>(null);
  const previousStage = useRef(stage);
  useEffect(() => {
    if (previousStage.current !== stage)
      document.getElementById("page-title")?.focus();
    previousStage.current = stage;
  }, [stage]);
  const located = ["locate", "interview", "review", "clarify"].includes(stage);
  return (
    <div className={`app app--${stage}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app__head">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            a<span>·</span>s
          </span>
          <span>
            Anatomical
            <br />
            <strong>Symptom Interface</strong>
          </span>
        </div>
        <span className="workspace-name">Personal anatomical workspace</span>
        <button
          className="btn btn--quiet"
          disabled={busy}
          onClick={() => {
            if (stage === "history") setStage(returnStage);
            else {
              setReturnStage(stage);
              setStage("history");
            }
          }}
        >
          {stage === "history"
            ? "Return to your record"
            : "Personal health map"}
          <span aria-hidden="true"> ↗</span>
        </button>
      </header>
      <main id="main" className={`app__main app__main--${stage}`} tabIndex={-1}>
        <div className="task-context">
          <span>{TASKS[stage]}</span>
          <span>
            {summary && stage === "review"
              ? "Saved episode"
              : "Development prototype"}
          </span>
        </div>
        <PageHeading
          title={
            summary && stage === "review"
              ? "A record to take with you"
              : TITLES[stage]
          }
        />
        {stage !== "history" && (
          <SafetyBanner
            flags={safety.flags}
            withheld={safety.withheld}
            blocked={safety.blocked}
          />
        )}
        {error && stage !== "history" && (
          <section className="notice notice--error" role="alert">
            <h2>
              {stage === "describe"
                ? "Location service unavailable"
                : "Your record could not be saved"}
            </h2>
            <p>
              {stage === "describe"
                ? "Your words are still here. Try again when the local service is available. Offline rules also need the local service."
                : "Your details are still here. Try saving again when the local service is available."}
            </p>
            <details>
              <summary>Technical details</summary>
              <p>{error}</p>
            </details>
          </section>
        )}
        {stage === "describe" && (
          <div className="entry-layout">
            <section className="entry">
              <p className="entry-intro">
                Describe it in your words. Locate it on your body.
                <br />
                Build a record you can share.
              </p>
              <form
                className="describe"
                aria-busy={busy}
                onSubmit={(e) => {
                  e.preventDefault();
                  void describe();
                }}
              >
                <label htmlFor="description">
                  What has been bothering you?
                </label>
                <textarea
                  id="description"
                  value={utterance}
                  onChange={(e) => setUtterance(e.target.value)}
                  aria-describedby="description-help"
                  maxLength={2000}
                  rows={5}
                  placeholder="For example: my right shoulder hurts deep inside when I lift my arm."
                />
                <div className="actions">
                  <span id="description-help" className="small">
                    Your own words · English or 中文
                  </span>
                  <span className="small">{utterance.length} / 2,000</span>
                </div>
                <button
                  className="btn btn--primary"
                  disabled={busy || !utterance.trim()}
                >
                  {busy ? "Finding a starting area…" : "Locate on body map"}{" "}
                  <span aria-hidden="true">→</span>
                </button>
              </form>
              <p className="entry-boundary">
                For symptom location and organisation. Not diagnosis or
                treatment.
              </p>
            </section>
            <aside className="entry-body" aria-label="Supported body areas">
              <BodyIndex />
              <p className="small">
                Four areas available in this prototype.
                <br />
                Other symptoms may not be supported.
              </p>
            </aside>
          </div>
        )}
        {stage === "unsupported" && (
          <div className="unsupported-layout">
            <span className="unlocated-mark" aria-hidden="true">
              ⊙
            </span>
            <blockquote className="own-words">{utterance}</blockquote>
            <EmptyState
              title="This description cannot enter the body-map workflow"
              action={
                <button
                  className="btn btn--primary"
                  onClick={() => setStage("describe")}
                >
                  Edit description
                </button>
              }
            >
              {refusal} No record has been created and no body region has been
              assumed.
            </EmptyState>
            <p className="small">
              Supported areas:{" "}
              {Object.values(REGIONS)
                .map((r) => r.label)
                .join(" · ")}
              .
            </p>
          </div>
        )}
        {stage === "clarify" && (
          <EmptyState
            title="A little more location context"
            action={
              <button
                className="btn btn--primary"
                onClick={() => setStage("locate")}
              >
                Show me the body map
              </button>
            }
          >
            {clarification}
          </EmptyState>
        )}
        {stage === "locate" && <BodyMap />}
        {stage === "interview" && (
          <div className="experience-layout">
            <aside className="experience-context">
              <BodyIndex active={record.location.region} />
              <blockquote>{record.location.userPhrase}</blockquote>
              <p className="small">
                {REGIONS[record.location.region].label} · {record.location.side}{" "}
                · {record.location.depth}
              </p>
              <button className="link" onClick={() => setStage("locate")}>
                Adjust location
              </button>
            </aside>
            <div>
              <InterviewPanel />
              <div className="actions interview-exit">
                <span className="small">
                  You can review an incomplete record.
                </span>
                <button className="link" onClick={() => setStage("review")}>
                  Review current details →
                </button>
              </div>
            </div>
          </div>
        )}
        {stage === "review" && (
          <div className="review-layout">
            <SummaryPanel />
            {!summary && (
              <div className="actions review-actions">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => setStage("interview")}
                >
                  Continue questions
                </button>
                <button
                  className="btn btn--primary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy ? "Saving your record…" : "Save & build summary"}
                </button>
              </div>
            )}
            <button
              className="link new-episode"
              disabled={busy}
              onClick={() => dialog.current?.showModal()}
            >
              Start a new episode
            </button>
          </div>
        )}
        {stage === "history" && <HistoryPanel />}
        {located && stage !== "locate" && (
          <p className="small workflow-boundary">
            Location indications and self-reported information. Not clinical
            findings.
          </p>
        )}
      </main>
      <footer className="app__footer">
        <span>Development build · Not for real-world medical use.</span>
        <span>Safety rules have not been clinically reviewed.</span>
      </footer>
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby="new-episode-title"
      >
        <h2 id="new-episode-title">Start a new episode?</h2>
        <p>
          Unsaved details in this session will be cleared. Saved episodes remain
          in your health map.
        </p>
        <form method="dialog" className="actions">
          <button className="btn" autoFocus>
            Keep this record
          </button>
          <button className="btn btn--primary" onClick={() => reset()}>
            Start new episode
          </button>
        </form>
      </dialog>
    </div>
  );
}
