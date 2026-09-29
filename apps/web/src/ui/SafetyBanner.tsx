import type { SafetyFlag } from '@asi/shared';

const LABEL: Record<SafetyFlag['severity'], string> = {
  info: 'Worth mentioning',
  caution: 'Please get this checked',
  urgent: 'Needs checking today',
  emergency: 'Get help now',
};

/**
 * Safety banner. Deliberately unmissable and deliberately plain: no disease
 * names, no probabilities, no "it might be". Only "get this assessed".
 */
export function SafetyBanner({ flags }: { flags: SafetyFlag[] }) {
  if (!flags.length) return null;
  const top = flags[0]!;

  return (
    <div className={`safety safety--${top.severity}`} role="alert">
      <p className="safety__label">{LABEL[top.severity]}</p>
      <h3 className="safety__title">{top.title}</h3>
      <p className="safety__message">{top.userMessage}</p>
      <ol className="safety__steps">
        {top.actionSteps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {flags.length > 1 && (
        <details className="safety__more">
          <summary>{flags.length - 1} other note{flags.length > 2 ? 's' : ''}</summary>
          <ul>
            {flags.slice(1).map((f) => (
              <li key={f.ruleId}>
                <strong>{f.title}</strong> — {f.userMessage}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
