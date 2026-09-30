import { useState } from 'react';
import { useSession } from '../state/session.ts';

export function SummaryPanel() {
  const summary = useSession((s) => s.summary);
  const [copied, setCopied] = useState(false);

  if (!summary) return <p className="muted">Save the episode to generate a summary.</p>;

  const text = [
    summary.chiefComplaint,
    '',
    ...summary.history.map((h) => `${h.label}: ${h.value}`),
    '',
    ...(summary.visualSelections.length
      ? [
          'AREAS YOU POINTED TO ON THE BODY MAP (a location you indicated, not a finding):',
          ...summary.visualSelections.map((v) => `  - ${v}`),
        ]
      : []),
    ...(summary.unselectedSuggestions.length
      ? [
          '',
          'SUGGESTED BY THE TOOL AND NOT ACTED ON (not findings):',
          ...summary.unselectedSuggestions.map((u) => `  - ${u}`),
        ]
      : []),
    ...(summary.safetyGateBlocked
      ? ['', '*** SAFETY GATE BLOCKED ***', 'One or more safety rules matched but have not completed clinical review. This record has NOT been safely assessed.']
      : []),
    '',
    'This summary was produced by a patient self-report tool. It is not a diagnosis.',
  ]
    .filter((x) => x !== undefined)
    .join('\n');

  return (
    <div className="summary">
      <h2 className="summary__title">Pre-visit summary</h2>
      <p className="summary__cc">{summary.chiefComplaint}</p>

      <dl className="summary__grid">
        {summary.history.map((h) => (
          <div key={h.label} className="summary__row">
            <dt>{h.label}</dt>
            <dd>{h.value}</dd>
          </div>
        ))}
      </dl>

      {summary.priorEpisodes.length > 0 && (
        <>
          <h3 className="summary__h3">Earlier in this area</h3>
          <ul className="summary__prior">
            {summary.priorEpisodes.map((p) => (
              <li key={p.id}>
                {p.startedAt.slice(0, 10)} — {p.title} <em>({p.status})</em>
              </li>
            ))}
          </ul>
        </>
      )}

      {summary.visualSelections.length > 0 && (
        <>
          <h3 className="summary__h3">Areas you pointed to</h3>
          <p className="muted">A location you indicated on the body map. Not a finding.</p>
          <ul className="summary__cands">
            {summary.visualSelections.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </>
      )}

      {summary.unselectedSuggestions.length > 0 && (
        <>
          <h3 className="summary__h3">Suggested, not acted on</h3>
          <p className="muted">Suggestions only. These are not findings.</p>
          <ul className="summary__cands">
            {summary.unselectedSuggestions.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </>
      )}

      {summary.safetyGateBlocked && (
        <div className="summary__blocked" role="alert">
          <strong>Safety gate blocked.</strong> A safety rule matched but has not completed
          clinical review, so its guidance was withheld. This record must not be treated as
          safely assessed.
        </div>
      )}

      <footer className="summary__foot">
        <p className="summary__sources">
          Sources: {summary.dataSources.map((d) => `${d.sourceType} (${d.count})`).join(' · ')}
        </p>
        <p className="summary__disclaimer">Not a diagnosis. Produced from your own description.</p>
        <button
          className="btn"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copied' : 'Copy for the doctor'}
        </button>
      </footer>
    </div>
  );
}
