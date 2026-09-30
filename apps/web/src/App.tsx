import { useEffect, useRef, useState } from 'react';
import { groundFromText, REGIONS } from '@asi/shared';
import { BodyMap } from './anatomy/BodyMap.tsx';
import { InterviewPanel } from './ui/InterviewPanel.tsx';
import { SafetyBanner } from './ui/SafetyBanner.tsx';
import { SummaryPanel } from './ui/SummaryPanel.tsx';
import { HistoryPanel } from './ui/HistoryPanel.tsx';
import {
  PageHeading,
  StatusTag,
  FactList,
  EmptyState,
} from './ui/primitives.tsx';
import { useSession } from './state/session.ts';
import type { Stage } from './state/session.ts';

const STEPS = ['Describe', 'Locate', 'Details', 'Review'] as const;
const STAGE_INDEX: Record<Stage, number> = {
  describe: 0,
  locate: 1,
  interview: 2,
  review: 3,
  history: -1,
};
const TITLES: Record<Stage, string> = {
  describe: 'Put what you feel into words.',
  locate: 'Find the place you mean.',
  interview: 'A little more about this area.',
  review: 'Your symptom record.',
  history: 'Your anatomical health map.',
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
    flags,
    record,
    save,
    reset,
    orchestratorKind,
    summary,
  } = useSession();
  const [returnStage, setReturnStage] = useState<Stage>('describe');
  const dialog = useRef<HTMLDialogElement>(null);
  const main = useRef<HTMLElement>(null);
  // The store drops score/matchedTerms; suppress its deterministic fallback shoulder in presentation.
  const noMatch =
    orchestratorKind === 'deterministic' &&
    !groundFromText(record.location.userPhrase || '');
  const hasDescription = Boolean(record.location.userPhrase) && !noMatch;
  const unlocated = stage === 'locate' && noMatch;
  const previousStage = useRef(stage);

  useEffect(() => {
    if (previousStage.current !== stage)
      main.current?.querySelector<HTMLElement>('#page-title')?.focus();
    previousStage.current = stage;
  }, [stage]);

  function openHistory() {
    setReturnStage(stage);
    setStage('history');
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="app__head">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            ◎
          </span>
          <span>
            Anatomical
            <br />
            <strong>Symptom Interface</strong>
          </span>
        </div>
        <div className="app__tools">
          <StatusTag>Development prototype</StatusTag>
          <button
            className="btn btn--quiet"
            disabled={busy}
            onClick={() =>
              stage === 'history' ? setStage(returnStage) : openHistory()
            }
          >
            {stage === 'history'
              ? 'Return to your record'
              : 'Personal health map'}
          </button>
        </div>
      </header>
      <div className="app__journey">
        <nav aria-label="Your record progress">
          <ol className="steps">
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={STAGE_INDEX[stage] === i ? 'step step--on' : 'step'}
                aria-current={STAGE_INDEX[stage] === i ? 'step' : undefined}
              >
                <span className="step__n">{i + 1}</span>
                <span>{label}</span>
              </li>
            ))}
          </ol>
        </nav>
        <p>Describe symptoms. Prepare for a conversation.</p>
      </div>
      <main
        id="main"
        className={`app__main app__main--${stage}`}
        ref={main}
        tabIndex={-1}
      >
        <div className="app__content">
          <PageHeading
            title={unlocated ? 'We could not identify an area.' : TITLES[stage]}
          >
            {stage === 'describe'
              ? 'A place to locate discomfort, record the details and prepare a summary to share.'
              : stage === 'locate'
                ? unlocated
                  ? 'Your description is kept here. No body area has been identified from these words.'
                  : 'Check the suggested area, then mark the location that matches what you feel.'
                : stage === 'interview'
                  ? 'One question at a time, based on the area you are describing.'
                  : stage === 'history'
                    ? 'Explore what you have recorded in each area of your body.'
                    : 'Keep your own words, recorded details and unconfirmed suggestions distinct.'}
          </PageHeading>
          {flags.length > 0 && stage !== 'history' && (
            <SafetyBanner flags={flags} />
          )}
          {error && stage !== 'history' && (
            <section className="notice notice--error" role="alert">
              <h2>
                {stage === 'describe'
                  ? 'Location service unavailable.'
                  : 'Your record could not be saved.'}
              </h2>
              <p>
                {stage === 'describe'
                  ? 'Your words are still here. Check the local service and try again. Offline rules also need the local service to be running.'
                  : 'Your current details are still on this page. Check the local service and try saving again.'}
              </p>
              <details>
                <summary>Technical details</summary>
                <p>{error}</p>
              </details>
            </section>
          )}
          {stage === 'describe' && (
            <section className="panel entry">
              <form
                className="describe"
                onSubmit={(event) => {
                  event.preventDefault();
                  void describe();
                }}
                aria-busy={busy}
              >
                <label htmlFor="description">
                  What has been bothering you?
                </label>
                <p id="description-help" className="muted">
                  Use your own words. You do not need to know anatomy. English
                  or 中文.
                </p>
                <textarea
                  id="description"
                  aria-describedby="description-help"
                  maxLength={2000}
                  value={utterance}
                  onChange={(event) => setUtterance(event.target.value)}
                  rows={5}
                  placeholder="For example: my right shoulder hurts deep inside when I lift my arm."
                />
                <div className="actions">
                  <p className="muted">{utterance.length} / 2,000 characters</p>
                  <button
                    type="submit"
                    className="btn btn--primary"
                    disabled={busy || !utterance.trim()}
                  >
                    {busy ? 'Finding a starting area…' : 'Locate on body map'}
                  </button>
                </div>
              </form>
              <div className="regions">
                <p>Supported in this prototype</p>
                <div className="regions__grid">
                  {Object.values(REGIONS).map((region) => (
                    <span className="region-label" key={region.id}>
                      {region.label}
                    </span>
                  ))}
                </div>
                <p className="muted">
                  Not sure where? Describe what you can. We will ask you to
                  check any suggestion.
                </p>
              </div>
            </section>
          )}
          {stage === 'locate' &&
            (unlocated ? (
              <EmptyState
                title="No location to show yet"
                action={
                  <button
                    className="btn btn--primary"
                    onClick={() => setStage('describe')}
                  >
                    Return to your description
                  </button>
                }
              >
                This prototype supports shoulder, neck, lower back and knee. You
                can name one of these areas in your own words if it matches what
                you feel. Other areas and general symptoms cannot be located
                here.
              </EmptyState>
            ) : (
              <BodyMap />
            ))}
          {stage === 'interview' && (
            <>
              <InterviewPanel />
              <div className="actions">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => setStage('locate')}
                >
                  Back to location
                </button>
                <button
                  className="btn btn--primary"
                  disabled={busy}
                  onClick={() => setStage('review')}
                >
                  Review current details
                </button>
              </div>
            </>
          )}
          {stage === 'review' && (
            <>
              <SummaryPanel />
              {!summary && (
                <div className="actions">
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => setStage('interview')}
                  >
                    Continue questions
                  </button>
                  <button
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() => void save()}
                  >
                    {busy ? 'Saving your record…' : 'Save & build summary'}
                  </button>
                </div>
              )}
              <button
                className="link"
                disabled={busy}
                onClick={() => dialog.current?.showModal()}
              >
                Start a new episode
              </button>
            </>
          )}
          {stage === 'history' && <HistoryPanel />}
        </div>
        {stage !== 'locate' && stage !== 'history' && (
          <aside className="context-rail" aria-label="About this record">
            {hasDescription ? (
              <section>
                <h2>Current location</h2>
                <StatusTag>Recorded details</StatusTag>
                <FactList
                  rows={[
                    {
                      label: 'Area',
                      value: REGIONS[record.location.region].label,
                    },
                    { label: 'Side', value: record.location.side },
                    { label: 'Depth', value: record.location.depth },
                  ]}
                />
                <p className="muted">
                  A description of where you feel symptoms, not a clinical
                  finding.
                </p>
                {orchestratorKind && (
                  <p className="small">
                    Starting area suggested by{' '}
                    {orchestratorKind === 'model'
                      ? 'the language model'
                      : 'offline rules'}
                    .
                  </p>
                )}
              </section>
            ) : (
              <section>
                <h2>From a feeling to a record</h2>
                <ol className="journey-notes">
                  <li>Describe it in your words.</li>
                  <li>Check the location on a body map.</li>
                  <li>Add details, then review and save.</li>
                </ol>
              </section>
            )}
            <section>
              <h2>For clearer conversations</h2>
              <p className="muted">
                This tool helps locate and organise symptoms. It does not
                diagnose or recommend treatment.
              </p>
              <p className="small">
                Development build. Safety rules have not been clinically
                reviewed. Not for real-world medical use.
              </p>
            </section>
          </aside>
        )}
      </main>
      <footer className="app__footer">
        <span>Anatomical Symptom Interface</span>
        <span>Your words. Your location. A clearer record.</span>
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
