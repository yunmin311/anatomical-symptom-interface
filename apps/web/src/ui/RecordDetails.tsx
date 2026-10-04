import {
  getStructure,
  REGIONS,
  buildPreVisitSummary,
  writablePaths,
} from '@asi/shared';
import type { SymptomRecord, AnswerMap, Episode } from '@asi/shared';
import { INTERVIEW } from '@asi/shared';
import { FactList } from './primitives.tsx';
import {
  answersInSection,
  answerSections,
  depthPhrase,
  groupSummaryRows,
  sidePhrase,
} from './presentation.ts';

/** The prompt for a question id, or the id itself if it is no longer in the engine. */
function questionLabel(questionId: string): string {
  for (const list of Object.values(INTERVIEW))
    for (const question of list) if (question.id === questionId) return question.prompt;
  return questionId;
}

/** Read raw session answers, or use the domain's coverage-aware saved renderer. */
export function RecordDetails({
  record,
  answers,
  episode,
  onEditAnswer,
}: {
  record: SymptomRecord;
  answers?: AnswerMap;
  episode?: Episode;
  /**
   * Re-present an already-answered question so it can be corrected.
   *
   * Only supplied where a user can actually change something: inside an episode they
   * are still editing. On a SAVED episode it is omitted, because offering a control that
   * silently does nothing is worse than not offering it.
   */
  onEditAnswer?: (questionId: string) => void;
}) {
  const region = REGIONS[record.location.region];
  const saved = episode
    ? buildPreVisitSummary(episode, {
        coverage: Object.fromEntries(
          writablePaths().map((path) => [
            path,
            Boolean(episode.provenance[path]),
          ]),
        ),
      })
    : null;
  const sections = saved ? groupSummaryRows(saved.history) : null;
  return (
    <div className="record-details">
      {sections ? (
        sections.map((section) => (
          <section className="record-section" key={section.title}>
            <h3>{section.title}</h3>
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
        ))
      ) : (
        <>
          <section className="record-section">
            <h3>Your own words</h3>
            <blockquote className="own-words">
              {record.location.userPhrase || 'Not recorded'}
            </blockquote>
          </section>
          <section className="record-section">
            <h3>Anatomical location</h3>
            <p className="small">
              Location indications, not clinical findings.
            </p>
            <FactList
              rows={[
                { label: 'Area', value: region.label },
                {
                  label: 'Location',
                  value:
                    region.subRegions.find(
                      (s) => s.id === record.location.subRegionId,
                    )?.label || 'Not established',
                },
                { label: 'Side', value: sidePhrase(record.location.side) },
                { label: 'Depth', value: depthPhrase(record.location.depth) },
                {
                  label: 'Pin',
                  value: record.location.point
                    ? 'Approximate schematic mark'
                    : 'No pin placed',
                },
              ]}
            />
          </section>
          <p className="small">
            Unanswered questions remain “Not asked”; uncertainty remains “Not
            established”.
          </p>
          {answerSections(record, answers || {}).map((section) => {
            const sectionAnswers = answersInSection(record, answers || {}, section.title);
            const asked = section.rows.filter((row) => row.asked);
            const neverAsked = section.rows.filter((row) => !row.asked);
            return (
            <section className="record-section" key={section.title}>
              <h3>{section.title}</h3>
              {section.title === 'Your own words' ? (
                section.rows.map((row) => (
                  <blockquote className="own-words" key={row.label}>
                    {row.value}
                  </blockquote>
                ))
              ) : (
                <>
                  {/*
                    What the user answered, first and flat. Then the questions
                    that were never put to them, in one labelled disclosure
                    instead of eight consecutive `Not asked` rows running down the
                    page. Nothing is dropped and no value changes: the audit called
                    this screen "truthful and unscannable", and both halves of that
                    were true at once.
                  */}
                  {asked.length > 0 && <FactList rows={asked} />}
                  {neverAsked.length > 0 && (
                    <details className="not-asked">
                      <summary>
                        {neverAsked.length} question
                        {neverAsked.length === 1 ? '' : 's'} not asked
                      </summary>
                      <p className="small">
                        Never put to you, so nothing was recorded. Not the same as
                        an answer of “no”.
                      </p>
                      <FactList rows={neverAsked} />
                    </details>
                  )}
                </>
              )}
              {onEditAnswer && sectionAnswers.length > 0 && (
                <div className="answer-edits">
                  <span className="eyebrow">Change an answer</span>
                  <ul>
                    {sectionAnswers.map((a) => (
                      <li key={a.questionId}>
                        {/*
                          A button, because it is one. These were links styled
                          identically to every other link on the page, including
                          "Start a new episode", and nothing in them said they
                          return you to the questions.
                        */}
                        <button
                          className="btn btn--small"
                          data-testid={`edit-answer-${a.questionId}`}
                          onClick={() => onEditAnswer(a.questionId)}
                        >
                          {questionLabel(a.questionId)}
                          <span className="sr-only"> — go back to this question</span>
                        </button>
                        {a.provenance.sourceType === 'user_edited' && (
                          <span className="muted small">you changed this</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
            );
          })}
        </>
      )}
      <section className="record-section">
        <h3>Visual structure selections</h3>
        <p className="small">Areas pointed to, not findings.</p>
        {record.location.userSelectedStructureIds.length ? (
          <ul>
            {record.location.userSelectedStructureIds.map((id) => (
              <li key={id}>{getStructure(id)?.label || id}</li>
            ))}
          </ul>
        ) : (
          <p className="small">No structures selected.</p>
        )}
      </section>
      <section className="record-section record-section--candidates">
        <h3>Suggested, not acted on</h3>
        <p className="small">Tool suggestions, not findings.</p>
        <ul>
          {record.consideredStructures
            .filter((c) => !c.selectedByUser)
            .map((c) => (
              <li key={c.structureId}>
                {getStructure(c.structureId)?.label || c.structureId}
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}
