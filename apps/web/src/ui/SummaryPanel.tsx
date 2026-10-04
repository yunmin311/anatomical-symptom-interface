import { useState } from 'react';
import { questionProgress, renderPlainText } from '@asi/shared';
import { useSession } from '../state/session.ts';
import { RecordDetails } from './RecordDetails.tsx';
import { FactList, StatusTag } from './primitives.tsx';
import { formatDate, groupSummaryRows, statusPhrase } from './presentation.ts';

export function SummaryPanel() {
  const { summary, record, answers, startEditAnswer } = useSession();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>(
    'idle',
  );
  if (!summary) {
    const progress = questionProgress({ record, answers });
    return (
      <section className="summary">
        <div className="section-heading">
          <h2>Review before saving</h2>
        </div>
        {/*
          "Not saved yet" was a status tag beside the heading, which read as a
          state the RECORD is in rather than a fact about saving. It is a fact
          about saving, so it is now a sentence in the sentence that talks about
          saving, and the heading is left to be the heading.
        */}
        <p className="muted">
          Nothing is saved yet. {progress.answered} of {progress.total} questions
          answered.{' '}
          {progress.outstanding.length > 0
            ? `${progress.outstanding.length} questions are unanswered or uncertain. This record is incomplete.`
            : 'Review what is recorded below.'}{' '}
          Missing information is not a negative answer.
        </p>
        {/*
          The edit path is offered HERE and only here: the record is still in progress
          and not yet saved. On the saved view below it is deliberately absent, because a
          "change" control that cannot change anything is worse than no control.
        */}
        <RecordDetails
          record={record}
          answers={answers}
          onEditAnswer={startEditAnswer}
        />
      </section>
    );
  }

  // One plain-text payload for both the clipboard and the manual-copy fallback,
  // rendered by the domain so the copied text can never drift from the canonical
  // summary. The frontend must not re-implement this.
  const text = renderPlainText(summary);
  const sections = groupSummaryRows(summary.history);
  /*
    The patient's own words lead, and the generated complaint line follows it.

    `chiefComplaint` is domain-generated and stays exactly as it is — it is a
    correct, deterministic summary of the record. But it is a run of semicolons
    ("Shoulder — character not established; not established; duration not asked;
    frequency not asked; trend not asked.") and it was the first thing on the
    document, above the one thing in it that a clinician and the patient both
    came for. Reordering two existing elements fixes that without touching a
    single word the domain produces.
  */
  const ownWords = sections.find((section) => section.title === 'Your own words');
  return (
    <article className="summary" aria-labelledby="summary-title">
      <header className="summary-heading">
        <StatusTag kind="selected">Saved episode</StatusTag>
        <h2 id="summary-title">Pre-visit summary</h2>
        <p className="small">
          Prepared {formatDate(summary.generatedAt)} from the recorded
          information.
        </p>
      </header>
      {ownWords && ownWords.rows.length > 0 ? (
        <section className="summary__lead" aria-label="In your own words">
          <span className="eyebrow">In your own words</span>
          {ownWords.rows.map((row) => (
            <blockquote className="own-words" key={row.label}>
              {row.value}
            </blockquote>
          ))}
        </section>
      ) : (
        <section className="summary__lead" aria-label="Chief complaint">
          <span className="eyebrow">Chief complaint</span>
          <p className="summary__cc">{summary.chiefComplaint}</p>
        </section>
      )}
      {ownWords && ownWords.rows.length > 0 && (
        <details className="summary__cc-detail">
          <summary>One-line summary</summary>
          <p className="summary__cc">{summary.chiefComplaint}</p>
        </details>
      )}
      {sections
        .filter((section) => section.title !== 'Your own words')
        .map((section) => (
        <section className="record-section" key={section.title}>
          <h3>{section.title}</h3>
          {section.title === 'Anatomical location' && (
            <p className="small">
              Patient-reported location and selections, not clinical findings.
            </p>
          )}
          {section.title === 'Your own words' ? (
            section.rows.map((row) => (
              <blockquote className="own-words" key={row.label}>
                {row.value}
              </blockquote>
            ))
          ) : (
            <FactList rows={section.rows} />
          )}
        </section>
      ))}
      {summary.safetyGateBlocked && (
        <div className="notice notice--error" role="alert">
          <h3>Safety gate blocked</h3>
          <p>
            One or more safety rules matched but have not completed clinical
            review. This record has NOT been safely assessed.
          </p>
        </div>
      )}
      {summary.visualSelections.length > 0 &&
        !summary.history.some(
          (row) => row.label === 'Areas pointed to on the body map',
        ) && (
          <section className="record-section">
            <h3>Areas you pointed to</h3>
            <p className="small">A location indication, not a finding.</p>
            <ul>
              {summary.visualSelections.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          </section>
        )}
      <section className="record-section record-section--candidates">
        <h3>Suggested, not acted on</h3>
        <StatusTag kind="candidate">Suggestions, not findings</StatusTag>
        {summary.unselectedSuggestions.length ? (
          <ul>
            {summary.unselectedSuggestions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="small">
            No unselected structure suggestions in this summary.
          </p>
        )}
      </section>
      {summary.priorEpisodes.length > 0 && (
        <section className="record-section">
          <h3>Earlier in this area</h3>
          <ul>
            {summary.priorEpisodes.map((episode) => (
              <li key={episode.id}>
                {/*
                  Date and state, and deliberately not the title.

                  Every episode title is `"<region> — <date>"`, so it restated
                  the section this list is already scoped to and the date printed
                  next to it: `Oct 4, 2026 — shoulder — 2026-10-04 (open)`. The
                  raw `(open)` is worse — a storage enum at the same weight as a
                  date. A title derived from what the user said is a Main Agent
                  capability request in docs/design/v1-product-audit.md, not
                  something this view should fabricate.
                */}
                <time dateTime={episode.startedAt}>
                  {formatDate(episode.startedAt)}
                </time>{' '}
                — {statusPhrase(episode.status)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="record-section">
        <h3>Safety information</h3>
        {summary.safetyNotes.length ? (
          summary.safetyNotes.map((note, index) => (
            <div
              className={`safety safety--${note.severity}`}
              key={`${note.title}-${index}`}
            >
              <p className="safety__label">{note.severity}</p>
              <h4>{note.title}</h4>
              <p>{note.message}</p>
              <ol>
                {note.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ))
        ) : (
          <p className="small">
            No safety notes are included in this summary. This is not a safety
            clearance.
          </p>
        )}
      </section>
      {summary.withheldNotes.length > 0 && (
        <section className="record-section">
          <h3>Withheld safety guidance</h3>
          <ul>
            {summary.withheldNotes.map((note) => (
              <li key={note.ruleId}>
                {note.severity}: {note.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
      {summary.outstandingFields.length > 0 && (
        <section className="record-section">
          <h3>Information not established</h3>
          <p className="small">
            {summary.outstandingFields.length} fields have no stored value.
            Missing information is not a negative answer.
          </p>
          <details>
            <summary>View unrecorded fields</summary>
            <ul>
              {summary.outstandingFields.map((field) => (
                <li key={field}>
                  {field.replaceAll('.', ' / ').replaceAll('_', ' ')}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
      <footer className="summary__foot">
        {/*
          Take it with you, then show where it came from.

          Provenance and export used to share one block with the copy button on
          top of it, so the two things a reader wants from a clinical summary —
          hand it over, and trust it — were stacked on each other. The action
          comes first because it is what the person holding the phone is about to
          do; the source list is reference material and reads fine underneath.
        */}
        <h3>Take it with you</h3>
        <div className="actions">
          <button
            className="btn btn--primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopyState('copied');
              } catch {
                setCopyState('error');
              }
            }}
          >
            {copyState === 'copied'
              ? 'Copied to clipboard'
              : 'Copy complete summary'}
          </button>
          <button className="btn" onClick={() => window.print()}>
            Print summary
          </button>
          <span role="status" className="small">
            {copyState === 'copied'
              ? 'Includes safety information and sources.'
              : copyState === 'error'
                ? 'Clipboard unavailable. Open the text below and copy it manually.'
                : ''}
          </span>
        </div>
        <details className="copy-fallback">
          <summary>View summary as plain text</summary>
          <label className="sr-only" htmlFor="summary-text">
            Complete summary text
          </label>
          <textarea
            id="summary-text"
            readOnly
            value={text}
            rows={14}
            onFocus={(event) => event.currentTarget.select()}
          />
        </details>
        <h3>Sources in this record</h3>
        <ul className="source-list">
          {summary.dataSources.map((source) => (
            <li key={source.sourceType}>
              {source.sourceType.replaceAll('_', ' ')}{' '}
              <span>
                {source.count} field{source.count === 1 ? '' : 's'}
              </span>
            </li>
          ))}
        </ul>
        <p className="summary__disclaimer">
          This summary was produced by a patient self-report tool. It is not a
          diagnosis.
        </p>
      </footer>
    </article>
  );
}
