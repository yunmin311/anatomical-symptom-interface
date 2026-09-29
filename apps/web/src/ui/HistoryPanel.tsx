import { useSession } from '../state/session.ts';

export function HistoryPanel() {
  const history = useSession((s) => s.history);
  const { loadHistory } = useSession();

  if (!history.length) {
    return (
      <p className="muted">
        Nothing recorded yet.{' '}
        <button className="link" onClick={() => void loadHistory()}>
          Reload
        </button>
      </p>
    );
  }

  const byRegion = new Map<string, typeof history>();
  for (const ep of history) {
    const key = `${ep.region} · ${ep.side}`;
    byRegion.set(key, [...(byRegion.get(key) ?? []), ep]);
  }

  return (
    <div className="history">
      {[...byRegion.entries()].map(([key, eps]) => (
        <section key={key} className="history__group">
          <h3 className="history__key">{key}</h3>
          <p className="muted history__count">
            {eps.length} episode{eps.length > 1 ? 's' : ''}
          </p>
          <ul>
            {eps.map((ep) => (
              <li key={ep.id} className={`history__item history__item--${ep.status}`}>
                <div className="history__row">
                  <strong>{ep.title}</strong>
                  <span className="history__date">{ep.startedAt.slice(0, 10)}</span>
                </div>
                <p className="history__meta">
                  {ep.record.quality.join(', ') || 'no quality recorded'}
                  {ep.record.temporal.trend !== 'unknown' && ` · ${ep.record.temporal.trend}`}
                  {ep.record.temporal.durationValue != null &&
                    ` · ${ep.record.temporal.durationValue} ${ep.record.temporal.durationUnit}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
