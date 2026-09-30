/**
 * Session state.
 *
 * All decision logic lives in ./logic.ts, which is pure and directly tested.
 * This file is the thin shell: fetch, store, and viewer commands. The two
 * rules it must never break are that it never writes a record field directly
 * (it goes through `applyAnswer` in shared) and that it never posts a whole
 * SymptomRecord to the server (it posts validated field mutations).
 */
import { create } from 'zustand';
import type {
  AnswerMap,
  BodyRegion,
  ConsideredStructure,
  Depth,
  Episode,
  PreVisitSummary,
  SafetyEvaluation,
  Side,
  SymptomRecord,
} from '@asi/shared';
import { emptyRecord, EMPTY_ANSWERS } from '@asi/shared';
import { Svg2dAnatomyAdapter } from '../anatomy/svg2d.ts';
import type { MapPoint, ViewerState } from '../anatomy/types.ts';
import {
  applyLocalisation,
  deselectStructure,
  evaluateSession,
  labelFor,
  mutationsForAnswer,
  mutationsForField,
  peekNextQuestion,
  progressOf,
  recordAnswer,
  selectStructure,
} from './logic.ts';
import type { LocalisationOutcome } from './logic.ts';

const API = '/api';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { reason?: string; error?: string } | null;
    throw new Error(body?.reason ?? body?.error ?? `${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const anatomy = new Svg2dAnatomyAdapter();

export type Stage = 'describe' | 'locate' | 'clarify' | 'interview' | 'review' | 'history' | 'unsupported';

interface SessionState {
  stage: Stage;
  utterance: string;
  busy: boolean;
  error: string | null;

  record: SymptomRecord;
  answers: AnswerMap;
  consideredStructures: ConsideredStructure[];
  safety: SafetyEvaluation;
  /** Set when localisation refused. The MSK interview must not run. */
  refusal: string | null;

  episodeId: string | null;
  summary: PreVisitSummary | null;
  history: Episode[];
  orchestratorKind: 'deterministic' | 'model' | null;
  clarification: string | null;

  viewer: ViewerState;
  viewerTick: number;

  setStage: (s: Stage) => void;
  setUtterance: (u: string) => void;
  setError: (e: string | null) => void;
  syncViewer: () => void;

  describe: () => Promise<void>;
  pinAt: (point: MapPoint) => void;
  select: (id: string) => void;
  deselect: (id: string) => void;
  selectSubRegion: (id: string) => void;
  setSide: (side: Side) => void;
  setDepth: (depth: Depth) => void;
  answer: (questionId: string, raw: unknown, triState?: 'yes' | 'no' | 'unknown') => void;
  save: () => Promise<void>;
  loadSummary: () => Promise<void>;
  loadHistory: (personId?: string) => Promise<void>;
  reset: () => void;
}

const EMPTY_SAFETY = evaluateSession(emptyRecord('shoulder'), EMPTY_ANSWERS);

export const useSession = create<SessionState>((set, get) => {
  anatomy.subscribe(() => set((s) => ({ viewerTick: s.viewerTick + 1 })));

  const reevaluate = (record: SymptomRecord, answers: AnswerMap) => {
    const safety = evaluateSession(record, answers);
    set({ safety });
  };

  /** Persist field mutations and/or answers through the single write path. */
  const pushMutations = async (
    episodeId: string,
    payload: { fieldPath: string; value: unknown; provenance: unknown }[],
    answers: { questionId: string; raw: unknown; wroteFields: string[]; createdBy: string; rawText?: string | null }[],
  ) => {
    await api(`/episodes/${episodeId}/mutations`, {
      method: 'POST',
      body: JSON.stringify({ mutations: payload, answers }),
    });
  };

  return {
    stage: 'describe',
    utterance: '',
    busy: false,
    error: null,

    record: emptyRecord('shoulder'),
    answers: EMPTY_ANSWERS,
    consideredStructures: [],
    safety: EMPTY_SAFETY,
    refusal: null,

    episodeId: null,
    summary: null,
    history: [],
    orchestratorKind: null,
    clarification: null,

    viewer: anatomy.getState(),
    viewerTick: 0,

    setStage: (stage) => set({ stage }),
    setUtterance: (utterance) => set({ utterance }),
    setError: (error) => set({ error }),
    syncViewer: () => set((s) => ({ viewer: anatomy.getState(), viewerTick: s.viewerTick + 1 })),

    describe: async () => {
      const { utterance } = get();
      if (!utterance.trim()) return;
      set({ busy: true, error: null, refusal: null, clarification: null });
      try {
        const result = await api<LocalisationOutcome>('/localise', {
          method: 'POST',
          body: JSON.stringify({ utterance }),
        });

        const { record, considered, allowed, refusal } = applyLocalisation(get().record, result);

        if (!allowed) {
          // Localisation refused. Stop here: do NOT open an anatomy view, do NOT
          // fabricate a region, and do NOT start a region interview.
          set({ record, consideredStructures: considered, refusal, busy: false, stage: 'unsupported' });
          return;
        }

        anatomy.apply({ type: 'focusRegion', region: record.location.region });
        if (record.location.subRegionId) {
          anatomy.apply({ type: 'focusSubRegion', subRegionId: record.location.subRegionId });
        }
        anatomy.apply({
          type: 'highlight',
          structureIds: considered.map((c) => c.structureId),
          as: 'candidate',
        });

        const clarification =
          result.status === 'grounded' ? (result.clarificationQuestion ?? null) : null;

        set({
          record,
          consideredStructures: considered,
          answers: EMPTY_ANSWERS,
          orchestratorKind: result.status === 'grounded' ? 'deterministic' : null,
          clarification,
          busy: false,
          stage: clarification ? 'clarify' : 'locate',
        });
        reevaluate(record, EMPTY_ANSWERS);
        get().syncViewer();
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e), busy: false });
      }
    },

    pinAt: (point) => {
      anatomy.apply({ type: 'dropPin', point });
      const record = { ...get().record, location: { ...get().record.location, point } };
      set({ record });
      reevaluate(record, get().answers);
      get().syncViewer();
    },

    /** Visual selection. NOT confirmation of a structure being the problem. */
    select: (id) => {
      anatomy.apply({ type: 'highlight', structureIds: [id], as: 'selected' });
      const record = selectStructure(get().record, id);
      set({ record });
      get().syncViewer();
    },

    deselect: (id) => {
      const record = deselectStructure(get().record, id);
      set({ record });
    },

    selectSubRegion: (id) => {
      anatomy.apply({ type: 'focusSubRegion', subRegionId: id });
      const record = { ...get().record, location: { ...get().record.location, subRegionId: id } };
      set({ record, stage: 'interview' });
      reevaluate(record, get().answers);
      get().syncViewer();
    },

    setSide: (side) => {
      const record = { ...get().record, location: { ...get().record.location, side } };
      set({ record });
      reevaluate(record, get().answers);
    },

    setDepth: (depth) => {
      anatomy.apply({ type: 'setDepth', depth });
      const record = { ...get().record, location: { ...get().record.location, depth } };
      set({ record });
      reevaluate(record, get().answers);
      get().syncViewer();
    },

    answer: (questionId, raw, triState) => {
      const { record, answers, wroteFields, answer } = recordAnswer(
        get().record,
        get().answers,
        questionId,
        raw,
        triState,
      );
      set({ record, answers, error: null });
      reevaluate(record, answers);

      // Persist asynchronously. A failure here must not desynchronise the UI,
      // so it surfaces as an error rather than a silent success.
      const id = get().episodeId;
      if (id) {
        void pushMutations(id, mutationsForAnswer(record, answer, wroteFields), [
          {
            questionId,
            raw: answer.raw,
            wroteFields,
            createdBy: 'user',
            rawText: answer.provenance.rawText ?? null,
          },
        ]).catch((e: unknown) => set({ error: e instanceof Error ? e.message : String(e) }));
      }
    },

    save: async () => {
      const { record, answers, episodeId, utterance } = get();
      set({ busy: true, error: null });
      try {
        let id = episodeId;
        const locationMutations = [
          ...mutationsForField('location.region', record.location.region),
          ...mutationsForField('location.side', record.location.side),
          ...mutationsForField('location.depth', record.location.depth),
          ...(record.location.subRegionId
            ? mutationsForField('location.subRegionId', record.location.subRegionId)
            : []),
          ...(record.location.point ? mutationsForField('location.point', record.location.point) : []),
          ...(record.location.userSelectedStructureIds.length
            ? mutationsForField('location.userSelectedStructureIds', record.location.userSelectedStructureIds)
            : []),
          ...(utterance ? mutationsForField('location.userPhrase', utterance) : []),
        ];

        if (!id) {
          const ep = await api<Episode>('/episodes', {
            method: 'POST',
            body: JSON.stringify({
              personId: 'local',
              displayName: 'Me',
              grounding: { status: 'grounded', region: record.location.region, side: record.location.side, by: get().orchestratorKind ?? 'deterministic' },
              mutations: locationMutations,
              answers: Object.values(answers).map((a) => ({
                questionId: a.questionId,
                raw: a.raw,
                wroteFields: a.wroteFields,
                createdBy: 'user',
                rawText: a.provenance.rawText ?? null,
              })),
            }),
          });
          id = ep.id;
          set({ episodeId: ep.id });
          // The create call already wrote the location and answers.
          const { summary } = await api<{ summary: PreVisitSummary }>(`/episodes/${ep.id}/summary`);
          set({ summary, busy: false, stage: 'review' });
          void get().loadHistory();
          return;
        }

        await pushMutations(id, locationMutations, []);
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
      anatomy.apply({ type: 'focusRegion', region: 'shoulder' });
      const record = emptyRecord('shoulder');
      set({
        stage: 'describe',
        utterance: '',
        record,
        answers: EMPTY_ANSWERS,
        consideredStructures: [],
        safety: evaluateSession(record, EMPTY_ANSWERS),
        refusal: null,
        clarification: null,
        episodeId: null,
        summary: null,
        error: null,
        viewer: anatomy.getState(),
        viewerTick: 0,
      });
    },
  };
});

export { peekNextQuestion, progressOf, labelFor };
export type { LocalisationOutcome };
export type { AnswerMap, BodyRegion, ConsideredStructure, MapPoint, SafetyEvaluation, SymptomRecord };
