import type { SafetyFlag, WithheldFlag } from '@asi/shared';

const LABEL: Record<SafetyFlag['severity'], string> = {
  info: 'Worth mentioning',
  caution: 'Please get this checked',
  urgent: 'Needs checking today',
  emergency: 'Get help now',
};

/**
 * Safety banner. Deliberately unmissable and deliberately plain: no disease
 * names, no probabilities, no "it might be". Only "get this assessed".
 *
 * When the release profile withheld a time-critical rule, that is shown as a
 * BLOCK rather than hidden. Silently showing a shorter list of flags would tell
 * the user "we checked and you're fine" when in fact a rule matched and could
 * not be shown.
 */
export function SafetyBanner({
  flags,
  withheld = [],
  blocked = false,
}: {
  flags: SafetyFlag[];
  withheld?: WithheldFlag[];
  blocked?: boolean;
}) {
  if (!flags.length && !withheld.length) return null;

  if (blocked && !flags.length) {
    return (
      <div className="safety safety--emergency" role="alert">
        <p className="safety__label">Cannot complete safety check</p>
        <h3 className="safety__title">A safety rule matched but could not be shown</h3>
        <p className="safety__message">
          One or more safety rules for your answers have not completed clinical review, so their
          guidance is withheld. This record has not been safely assessed. Do not rely on this tool
          to tell you whether you need care — contact a clinician.
        </p>
        <ol className="safety__steps">
          <li>Contact a clinician or your local emergency service.</li>
          <li>Treat this record as incomplete rather than as reassurance.</li>
        </ol>
      </div>
    );
  }

  const top = flags[0];
  if (!top) return null;

  return (
    <>
      {blocked && (
        <div className="safety safety--emergency" role="alert">
          <p className="safety__label">Incomplete safety check</p>
          <h3 className="safety__title">Some safety guidance is unavailable</h3>
          <p className="safety__message">
            {withheld.length} further rule{withheld.length > 1 ? 's' : ''} matched your answers but
            {withheld.length > 1 ? ' have' : ' has'} not completed clinical review, so{' '}
            {withheld.length > 1 ? 'they are' : 'it is'} withheld. Do not treat this as a clean
            result.
          </p>
        </div>
      )}
      <div className={`safety safety--${top.severity}`} role="alert">
        <p className="safety__label">{LABEL[top.severity]}</p>
        <h3 className="safety__title">{top.title}</h3>
        <p className="safety__message">{top.userMessage}</p>
        <ol className="safety__steps">
          {top.actionSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {top.reviewStatus === 'unreviewed' && (
          <p className="safety__proto">
            Prototype notice: this guidance has not been clinically reviewed. Treat it as a prompt
            to seek care, not as clinical advice.
          </p>
        )}
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
    </>
  );
}
