import { useEffect } from 'react';
import { BodyMap } from './anatomy/BodyMap.tsx';
import { InterviewPanel } from './ui/InterviewPanel.tsx';
import { SafetyBanner } from './ui/SafetyBanner.tsx';
import { SummaryPanel } from './ui/SummaryPanel.tsx';
import { HistoryPanel } from './ui/HistoryPanel.tsx';
import { useSession } from './state/session.ts';
import { peekNextQuestion, progressOf } from './state/session.ts';
import { REGIONS } from '@asi/shared';

const STAGES = [
  { id: 'describe', label: 'Describe' },
  { id: 'locate', label: 'Locate' },
  { id: 'interview', label: 'Detail' },
  { id: 'review', label: 'Summary' },
  { id: 'history', label: 'History' },
] as const;

export function App() {
  const stage = useSession((s) => s.stage);
  const setStage = useSession((s) => s.setStage);
  const utterance = useSession((s) => s.utterance);
  const setUtterance = useSession((s) => s.setUtterance);
  const describe = useSession((s) => s.describe);
  const busy = useSession((s) => s.busy);
  const error = useSession((s) => s.error);
  const setError = useSession((s) => s.setError);
  const safety = useSession((s) => s.safety);
  const record = useSession((s) => s.record);
  const answers = useSession((s) => s.answers);
  const save = useSession((s) => s.save);
  const reset = useSession((s) => s.reset);
  const loadHistory = useSession((s) => s.loadHistory);
  const refusal = useSession((s) => s.refusal);
  const clarification = useSession((s) => s.clarification);
  const orchestratorKind = useSession((s) => s.orchestratorKind);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const next = peekNextQuestion(record, answers);
  const progress = progressOf(record, answers);

  return (
    <div className="app">
      <header className="app__head">
        <h1 className="app__title">Anatomical Symptom Interface</h1>
        <nav className="app__steps">
          {STAGES.map((s, i) => (
            <button
              key={s.id}
              className={`step ${stage === s.id ? 'step--on' : ''}`}
              onClick={() => setStage(s.id)}
            >
              <span className="step__n">{i + 1}</span>
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="app__main">
        <section className="app__col">
          {stage === 'describe' && (
            <div className="panel">
              <h2 className="panel__h">Where does it hurt?</h2>
              <p className="muted">
                Say it however you would say it out loud. You do not need to know any anatomy.
              </p>
              <form
                className="describe"
                onSubmit={(e) => {
                  e.preventDefault();
                  void describe();
                }}
              >
                <textarea
                  value={utterance}
                  onChange={(e) => setUtterance(e.target.value)}
                  rows={3}
                  placeholder="e.g. right shoulder, deep inside, hurts when I lift my arm"
                  autoFocus
                />
                <button type="submit" className="btn btn--primary" disabled={busy || !utterance.trim()}>
                  {busy ? 'Working…' : 'Show me where'}
                </button>
              </form>

              <div className="regions">
                <p className="regions__label">Or pick an area</p>
                <div className="regions__grid">
                  {Object.values(REGIONS).map((r) => (
                    <button
                      key={r.id}
                      className="region"
                      onClick={() => {
                        // Picking a region IS grounding, so it goes through the
                        // same localise path with a pinned region.
                        setUtterance(`${r.label.toLowerCase()}`);
                        void useSession.getState().describe();
                      }}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {error && <p className="error">{error}</p>}
            </div>
          )}

          {stage === 'unsupported' && (
            <div className="panel">
              <h2 className="panel__h">This workflow cannot help with that</h2>
              <p>{refusal}</p>
              <p className="muted">
                Nothing has been recorded. No body region was guessed, and none of the
                shoulder / neck / lower back / knee questions were asked.
              </p>
              <button className="btn" onClick={reset}>
                Start again
              </button>
            </div>
          )}

          {stage === 'clarify' && (
            <div className="panel">
              <h2 className="panel__h">One quick thing</h2>
              <p>{clarification}</p>
              <div className="panel--actions">
                <button className="btn btn--primary" onClick={() => setStage('locate')}>
                  Show me the body
                </button>
              </div>
            </div>
          )}

          {stage === 'locate' && <BodyMap />}

          {stage === 'interview' && (
            <>
              <InterviewPanel />
              <div className="panel panel--actions">
                <button className="btn btn--primary" onClick={() => void save()} disabled={busy}>
                  {busy ? 'Saving…' : 'Save & build summary'}
                </button>
                <button className="btn" onClick={() => void save()}>
                  Skip to summary
                </button>
              </div>
            </>
          )}

          {stage === 'review' && (
            <>
              <button className="link" onClick={reset}>
                Start a new episode
              </button>
              <SummaryPanel />
            </>
          )}

          {stage === 'history' && <HistoryPanel />}
        </section>

        <aside className="app__col app__col--side">
          <SafetyBanner flags={safety.flags} withheld={safety.withheld} blocked={safety.blocked} />

          <section className="panel panel--tight">
            <h3 className="panel__h3">This session</h3>
            <dl className="facts">
              <div>
                <dt>Area</dt>
                <dd>{REGIONS[record.location.region].label}</dd>
              </div>
              <div>
                <dt>Side</dt>
                <dd>{record.location.side}</dd>
              </div>
              <div>
                <dt>Depth</dt>
                <dd>{record.location.depth}</dd>
              </div>
              <div>
                <dt>Your words</dt>
                <dd>{record.location.userPhrase ?? '—'}</dd>
              </div>
              <div>
                <dt>Answered</dt>
                <dd>
                  {progress.answered}/{progress.total}
                  {progress.outstanding.length > 0 && ` (${progress.outstanding.length} not established)`}
                </dd>
              </div>
            </dl>
            {orchestratorKind && (
              <p className="muted facts__note">
                Location read by {orchestratorKind === 'model' ? 'the assistant' : 'offline rules'} —
                please correct it on the map.
              </p>
            )}
            {next && (
              <p className="muted facts__note">Next question: {next.rationale}</p>
            )}
          </section>

          <section className="panel panel--tight">
            <h3 className="panel__h3">What this is not</h3>
            <p className="muted">
              This tool records what you feel and helps you describe it. It does not diagnose, and
              pointing at a structure on the body map is a location, not a finding. If something is
              wrong, a clinician decides that, not this.
            </p>
          </section>

          {error && (
            <section className="panel panel--tight">
              <h3 className="panel__h3">Not saved</h3>
              <p className="error">{error}</p>
              <button className="link" onClick={() => setError(null)}>
                Dismiss
              </button>
            </section>
          )}
        </aside>
      </main>
    </div>
  );
}
