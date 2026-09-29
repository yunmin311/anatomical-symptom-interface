import { useState } from 'react';
import { questionProgress } from '@asi/shared';
import { useSession } from '../state/session.ts';
import { RecordDetails } from './RecordDetails.tsx';
import { FactList, StatusTag } from './primitives.tsx';
import { formatDate, groupSummaryRows, summaryText } from './presentation.ts';

export function SummaryPanel() {
  const { summary, record, asked } = useSession();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  if (!summary) {
    const progress = questionProgress({record, asked: new Set(asked)});
    return <section className="summary"><div className="section-heading"><h2>Review before saving</h2><StatusTag>Not saved yet</StatusTag></div><p className="muted">{progress.answered} of {progress.total} questions answered. {progress.requiredLeft > 0 ? `${progress.requiredLeft} required questions remain. This record is incomplete.` : 'Review what is recorded below.'} Missing information is not a negative answer.</p><RecordDetails record={record} /></section>;
  }

  const text = summaryText(summary);
  return <article className="summary" aria-labelledby="summary-title"><header className="summary-heading"><StatusTag kind="selected">Saved episode</StatusTag><h2 id="summary-title">Pre-visit summary</h2><p className="small">Prepared {formatDate(summary.generatedAt)} from the recorded information.</p></header>
    <p className="summary__cc">{summary.chiefComplaint}</p>
    {groupSummaryRows(summary.history).map((section) => <section className="record-section" key={section.title}><h3>{section.title}</h3>{section.title === 'Anatomical location' && <p className="small">Patient-reported location and selections, not clinical findings.</p>}<FactList rows={section.rows} /></section>)}
    <section className="record-section record-section--candidates"><h3>Unconfirmed candidates</h3><StatusTag kind="candidate">Suggestions, not findings</StatusTag>{summary.unconfirmedConsiderations.length ? <ul>{summary.unconfirmedConsiderations.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="small">No unconfirmed structure candidates in this summary.</p>}</section>
    {summary.priorEpisodes.length > 0 && <section className="record-section"><h3>Earlier in this area</h3><ul>{summary.priorEpisodes.map((episode) => <li key={episode.id}><time dateTime={episode.startedAt}>{formatDate(episode.startedAt)}</time> — {episode.title} ({episode.status})</li>)}</ul></section>}
    <section className="record-section"><h3>Safety information</h3>{summary.safetyNotes.length ? summary.safetyNotes.map((note, index) => <div className={`safety safety--${note.severity}`} key={`${note.title}-${index}`}><p className="safety__label">{note.severity}</p><h4>{note.title}</h4><p>{note.message}</p><ol>{note.steps.map((step) => <li key={step}>{step}</li>)}</ol></div>) : <p className="small">No safety notes are included in this summary. This is not a safety clearance.</p>}</section>
    <footer className="summary__foot"><h3>Sources in this record</h3><ul className="source-list">{summary.dataSources.map((source) => <li key={source.sourceType}>{source.sourceType.replaceAll('_', ' ')} <span>{source.count} field{source.count === 1 ? '' : 's'}</span></li>)}</ul><p className="summary__disclaimer">This summary was produced by a patient self-report tool. It is not a diagnosis.</p>
      <div className="actions"><button className="btn btn--primary" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopyState('copied'); } catch { setCopyState('error'); } }}>{copyState === 'copied' ? 'Copied to clipboard' : 'Copy complete summary'}</button><button className="btn" onClick={() => window.print()}>Print summary</button><span role="status" className="small">{copyState === 'copied' ? 'Includes safety information and sources.' : copyState === 'error' ? 'Clipboard unavailable. Open the text below and copy it manually.' : ''}</span></div>
      <details className="copy-fallback"><summary>View summary as plain text</summary><label className="sr-only" htmlFor="summary-text">Complete summary text</label><textarea id="summary-text" readOnly value={text} rows={14} onFocus={(event) => event.currentTarget.select()} /></details>
    </footer>
  </article>;
}
