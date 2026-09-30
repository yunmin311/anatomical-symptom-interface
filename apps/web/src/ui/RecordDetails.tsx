import {
  getStructure,
  REGIONS,
  buildPreVisitSummary,
  writablePaths,
} from '@asi/shared';
import type { SymptomRecord, AnswerMap, Episode } from '@asi/shared';
import { FactList } from './primitives.tsx';
import { answerSections, groupSummaryRows, readable } from './presentation.ts';

/** Read raw session answers, or use the domain's coverage-aware saved renderer. */
export function RecordDetails({
  record,
  answers,
  episode,
}: {
  record: SymptomRecord;
  answers?: AnswerMap;
  episode?: Episode;
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
                { label: 'Side', value: readable(record.location.side) },
                { label: 'Depth', value: readable(record.location.depth) },
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
          {answerSections(record, answers || {}).map((section) => (
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
          ))}
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
