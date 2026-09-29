/**
 * Session state. Deliberately small: the record is the product, the store just
 * orchestrates fetching and the current view.
 */
import { create } from 'zustand';
import type {
  BodyRegion,
  ConsideredStructure,
  Depth,
  Episode,
  PreVisitSummary,
  SafetyFlag,
  Side,
  SymptomRecord,
} from '@asi/shared';
import { emptyRecord, evaluateRedFlags, nextQuestion, questionProgress } from '@asi/shared';
import { Svg2dAnatomyAdapter } from '../anatomy/svg2d.ts';
import type { BodyPin, MapPoint, ViewerState } from '../anatomy/types.ts';

const API = '/api';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

export const anatomy = new Svg2dAnatomyAdapter();

export interface LocaliseResult {
  region: BodyRegion;
  side: Side;
  depth: Depth;
  suggestedSubRegionId: string | null;
  consideredStructures: ConsideredStructure[];
  userPhrase: string;
  by: 'deterministic' | 'model';
  matchedTerms: string[];
  score: number;
}

export type Stage = 'describe' | 'locate' | 'interview' | 'review' | 'history';

interface SessionState {
  stage: Stage;
  utterance: string;
  busy: boolean;
  error: string | null;

  record: SymptomRecord;
  asked: string[];
  consideredStructures: ConsideredStructure[];
  flags: SafetyFlag[];

  episodeId: string | null;
  summary: PreVisitSummary | null;
  history: Episode[];
  orchestratorKind: 'deterministic' | 'model' | null;

  viewer: ViewerState;
  /** Bumped whenever the anatomy adapter emits, to trigger React updates. */
  viewerTick: number;

  setStage: (s: Stage) => void;
  setUtterance: (u: string) => void;
  setBusy: (b: boolean) => void;
  setError: (e: string | null) => void;
  syncViewer: () => void;

  describe: () => Promise<void>;
  pinAt: (point: MapPoint) => void;
  confirmStructure: (id: string) => void;
  rejectStructure: (id: string) => void;
  confirmSubRegion: (id: string) => void;
  setSide: (side: Side) => void;
  setDepth: (depth: Depth) => void;
  answer: (questionId: string, value: unknown, optionValues: string[]) => void;
  save: () => Promise<void>;
  loadSummary: () => Promise<void>;
  loadHistory: (personId?: string) => Promise<void>;
  reset: () => void;
}

const reevaluate = (record: SymptomRecord): SafetyFlag[] => evaluateRedFlags(record, { region: record.location.region });

/** Append without duplicating, preserving the element type. */
const add = <T,>(arr: readonly T[], ...items: T[]): T[] => [...new Set([...arr, ...items])];

export const useSession = create<SessionState>((set, get) => {
  anatomy.subscribe(() => set((s) => ({ viewerTick: s.viewerTick + 1 })));

  return {
    stage: 'describe',
    utterance: '',
    busy: false,
    error: null,

    record: emptyRecord('shoulder'),
    asked: [],
    consideredStructures: [],
    flags: [],

    episodeId: null,
    summary: null,
    history: [],
    orchestratorKind: null,

    viewer: anatomy.getState(),
    viewerTick: 0,

    setStage: (stage) => set({ stage }),
    setUtterance: (utterance) => set({ utterance }),
    setBusy: (busy) => set({ busy }),
    setError: (error) => set({ error }),
    syncViewer: () => set((s) => ({ viewer: anatomy.getState(), viewerTick: s.viewerTick + 1 })),

    /** Free text → grounded candidates → open the anatomy view there. */
    describe: async () => {
      const { utterance } = get();
      if (!utterance.trim()) return;
      set({ busy: true, error: null });
      try {
        const r = await api<LocaliseResult>('/localise', {
          method: 'POST',
          body: JSON.stringify({ utterance }),
        });
        anatomy.apply({ type: 'focusRegion', region: r.region });
        if (r.suggestedSubRegionId) {
          anatomy.apply({ type: 'focusSubRegion', subRegionId: r.suggestedSubRegionId });
        }
        anatomy.apply({ type: 'highlight', structureIds: r.consideredStructures.map((c) => c.structureId), as: 'candidate' });

        const record = emptyRecord(r.region);
        record.location = {
          ...record.location,
          side: r.side,
          depth: r.depth,
          subRegionId: r.suggestedSubRegionId,
          userPhrase: r.userPhrase,
          point: null,
          userConfirmedStructureIds: [],
        };
        record.consideredStructures = r.consideredStructures;

        set({
          record,
          consideredStructures: r.consideredStructures,
          asked: [],
          flags: reevaluate(record),
          orchestratorKind: r.by,
          busy: false,
          stage: 'locate',
        });
        get().syncViewer();
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e), busy: false });
      }
    },

    pinAt: (point) => {
      anatomy.apply({ type: 'dropPin', point });
      const record = { ...get().record, location: { ...get().record.location, point } };
      set({ record, flags: reevaluate(record) });
      get().syncViewer();
    },

    /** User confirmation: the only path by which a candidate becomes a fact. */
    confirmStructure: (id) => {
      anatomy.apply({ type: 'highlight', structureIds: [id], as: 'confirmed' });
      const record = get().record;
      record.location.userConfirmedStructureIds = [...new Set([...record.location.userConfirmedStructureIds, id])];
      record.consideredStructures = record.consideredStructures.map((c) =>
        c.structureId === id ? { ...c, confirmedByUser: true } : c,
      );
      set({ record });
      get().syncViewer();
    },

    rejectStructure: (id) => {
      const v = anatomy.getState();
      anatomy.apply({ type: 'removePin', pinId: v.activePin ? '__none__' : '__none__' });
      const record = get().record;
      record.location.userConfirmedStructureIds = record.location.userConfirmedStructureIds.filter((x) => x !== id);
      record.consideredStructures = record.consideredStructures.filter((c) => c.structureId !== id);
      set({ record });
    },

    confirmSubRegion: (id) => {
      anatomy.apply({ type: 'focusSubRegion', subRegionId: id });
      const record = { ...get().record, location: { ...get().record.location, subRegionId: id } };
      set({ record, stage: 'interview', flags: reevaluate(record) });
      get().syncViewer();
    },

    setSide: (side) => {
      const record = { ...get().record, location: { ...get().record.location, side } };
      set({ record, flags: reevaluate(record) });
    },

    setDepth: (depth) => {
      anatomy.apply({ type: 'setDepth', depth });
      const record = { ...get().record, location: { ...get().record.location, depth } };
      set({ record, flags: reevaluate(record) });
      get().syncViewer();
    },

    answer: (questionId, value, optionValues) => {
      const record = structuredClone(get().record);
      const { asked } = get();

      switch (questionId) {
        case 'shoulder.injury_context':
        case 'neck.mechanism':
        case 'lower_back.mechanism':
        case 'knee.mechanism':
          record.context.recentInjury = String(value);
          break;
        case 'shoulder.weakness':
        case 'lower_back.weakness':
          if (String(value) === 'true') {
            record.quality = add(record.quality, 'instability');
            record.function.activitiesAffected = [...record.function.activitiesAffected, 'leg feels weak'];
          }
          break;
        case 'shoulder.radiation':
        case 'neck.arming':
        case 'lower_back.leg_symptoms':
          if (value !== 'none') record.radiation = [String(value)];
          break;
        case 'lower_back.numbness':
          if (String(value) === 'true') record.quality = add(record.quality, 'numbness');
          break;
        case 'shoulder.night_pain':
          if (String(value) === 'true') record.triggers = add(record.triggers, 'night');
          break;
        case 'shoulder.tenderness':
          record.tendernessOnPalpation = String(value) as never;
          break;
        case 'shoulder.elevation':
        case 'neck.movement':
        case 'knee.stairs':
          record.triggerDetail = optionValues.join(', ');
          record.triggers = add(record.triggers, 'movement' as never);
          break;
        case 'shoulder.vascular':
        case 'neck.systemic':
        case 'lower_back.systemic':
        case 'knee.instability':
          if (String(value) === 'true') {
            record.context.systemicSymptoms = add(record.context.systemicSymptoms, 'fever');
          }
          break;
        case 'knee.swelling':
          if (String(value) !== 'none') record.quality = add(record.quality, 'swelling');
          break;
        case 'knee.weight_bearing':
          record.function.unableWeighBearing = String(value) as never;
          break;
        case 'lower_back.bladder':
        case 'lower_back.movement':
        case 'shoulder.trauma_urgent':
        case 'neck.trauma_urgent':
        case 'shoulder.headache':
        case 'neck.headache':
        case 'knee.locking':
          if (questionId === 'lower_back.movement') record.triggerDetail = optionValues.join(', ');
          if (questionId === 'knee.locking' && String(value) === 'true') {
            record.quality = add(record.quality, 'clicking');
          }
          break;
        default:
          break;
      }

      // Question ids whose safety rule fired become explicit record gaps so the
      // rule engine can see the signal without us smuggling free text.
      record.gaps = [...new Set([...record.gaps, `asked:${questionId}`])];

      set({
        record,
        asked: [...asked, questionId],
        flags: reevaluate(record),
      });
    },

    save: async () => {
      const { record, episodeId, utterance } = get();
      set({ busy: true, error: null });
      try {
        let id = episodeId;
        if (!id) {
          const ep = await api<Episode>('/episodes', {
            method: 'POST',
            body: JSON.stringify({
              personId: 'local',
              displayName: 'Me',
              region: record.location.region,
              side: record.location.side,
              userPhrase: utterance,
              record,
            }),
          });
          id = ep.id;
          set({ episodeId: ep.id });
        } else {
          await api(`/episodes/${id}/record`, {
            method: 'PATCH',
            body: JSON.stringify({ record }),
          });
        }

        // Persist the user-confirmation side of the record as real provenance.
        for (const fieldPath of ['location.side', 'location.depth', 'location.subRegionId', 'location.point']) {
          const value = fieldPath
            .split('.')
            .reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], record);
          if (value == null) continue;
          await api(`/episodes/${id}/confirm`, {
            method: 'POST',
            body: JSON.stringify({ fieldPath, value, verificationStatus: 'user_confirmed' }),
          });
        }

        const { summary } = await api<{ summary: PreVisitSummary }>(`/episodes/${id}/summary`);
        set({ summary, busy: false, stage: 'review' });
        void get().loadHistory();
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e), busy: false });
      }
    },

    loadSummary: async () => {
      const { episodeId } = get();
      if (!episodeId) return;
      const { summary } = await api<{ summary: PreVisitSummary }>(`/episodes/${episodeId}/summary`);
      set({ summary });
    },

    loadHistory: async (personId = 'local') => {
      const history = await api<Episode[]>(`/episodes?personId=${encodeURIComponent(personId)}`);
      set({ history });
    },

    reset: () => {
      const viewer = anatomy.getState();
      anatomy.apply({ type: 'focusRegion', region: 'shoulder' });
      set({
        stage: 'describe',
        utterance: '',
        record: emptyRecord('shoulder'),
        asked: [],
        consideredStructures: [],
        flags: [],
        episodeId: null,
        summary: null,
        error: null,
        viewer: anatomy.getState(),
        viewerTick: viewer ? 0 : 0,
      });
    },
  };
});

export { nextQuestion, questionProgress };
export type { BodyPin, MapPoint, ViewerState };
