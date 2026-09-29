import { useEffect, useState } from 'react';
import { useSession } from '../state/session.ts';

export function SummaryPanel() {
  const summary = useSession((s) => s.summary);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (summary) void useSession.getState().loadHistory();
  }, [summary]);

  if (!summary) return <p className="muted">Save the episode to generate a summary.</p>;

  const text = [
    summary.chiefComplaint,
    '',
    ...summary.history.map((h) => `${h.label}: ${h.value}`),
    '',
    summary.unconfirmedConsiderations.length
      ? `CONSIDERED BUT NOT CONFIRMED (AI candidates, not findings):\n${summary.unconfirmedConsiderations
          .map((u) => `  - ${u}`)
          .join('\n')}`
      : '',
    '',
    'This summary was produced by a patient self-report tool. It is not a diagnosis.',
  ]
    .filter(Boolean)
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

      {summary.unconfirmedConsiderations.length > 0 && (
        <>
          <h3 className="summary__h3">Considered, not confirmed</h3>
          <p className="muted">Suggestions only. These are not findings.</p>
          <ul className="summary__cands">
            {summary.unconfirmedConsiderations.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </>
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
