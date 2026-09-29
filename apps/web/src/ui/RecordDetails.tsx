import { getStructure, QUALITY_LABELS, REGIONS } from '@asi/shared';
import type { SymptomRecord } from '@asi/shared';
import { FactList, StatusTag } from './primitives.tsx';
import { readable } from './presentation.ts';

export function RecordDetails({ record }: { record: SymptomRecord }) {
  const { location, temporal, function: impact } = record;
  const list = (values: string[]) => values.length ? values.map(readable).join(', ') : 'Not recorded';
  const region = REGIONS[location.region];
  const unconfirmed = record.consideredStructures.filter((candidate) => !location.userConfirmedStructureIds.includes(candidate.structureId));
  return <div className="record-details">
    <section className="record-section"><h3>Your own words</h3><blockquote className="own-words">{location.userPhrase || 'Not recorded'}</blockquote></section>
    <section className="record-section"><h3>Anatomical location</h3><p className="small">Recorded location, not a clinical finding.</p><FactList rows={[
      {label: 'Area', value: region.label}, {label: 'Location', value: region.subRegions.find((sub) => sub.id === location.subRegionId)?.label || 'Not recorded'},
      {label: 'Side', value: readable(location.side)}, {label: 'Depth', value: readable(location.depth)},
      {label: 'Pin', value: location.point ? 'Approximate mark placed on the schematic' : 'No pin placed'},
      {label: 'Selected structures', value: list(location.userConfirmedStructureIds.map((id) => getStructure(id)?.label || id))},
    ]} /></section>
    <section className="record-section"><h3>Symptom characteristics</h3><FactList rows={[
      {label: 'Quality', value: list(record.quality.map((quality) => QUALITY_LABELS[quality]))}, {label: 'Triggers', value: list(record.triggers)},
      {label: 'Movement detail', value: record.triggerDetail || 'Not recorded'}, {label: 'Radiation', value: list(record.radiation)}, {label: 'Tenderness', value: readable(record.tendernessOnPalpation)},
    ]} /></section>
    <section className="record-section"><h3>Timeline</h3><FactList rows={[
      {label: 'Onset', value: readable(temporal.onset)}, {label: 'Duration', value: temporal.durationValue != null ? `${temporal.durationValue} ${temporal.durationUnit || ''}` : 'Not recorded'},
      {label: 'Frequency', value: readable(temporal.frequency)}, {label: 'Trend', value: readable(temporal.trend)},
    ]} /></section>
    <section className="record-section"><h3>Functional impact</h3><FactList rows={[
      {label: 'Activities', value: list(impact.activitiesAffected)}, {label: 'Sleep affected', value: readable(impact.sleepAffected)},
      {label: 'Intensity', value: impact.intensity == null ? 'Not recorded' : `${impact.intensity} / 10`},
    ]} /></section>
    <section className="record-section record-section--candidates"><h3>Unconfirmed candidates</h3><StatusTag kind="candidate">Suggestions, not findings</StatusTag>{unconfirmed.length ? <ul>{unconfirmed.map((candidate) => <li key={candidate.structureId}>{getStructure(candidate.structureId)?.label || candidate.structureId}</li>)}</ul> : <p className="small">No unconfirmed structure candidates in this record.</p>}</section>
  </div>;
}
