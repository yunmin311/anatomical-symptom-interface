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
  EpisodeReopen,
  PreVisitSummary,
  SafetyEvaluation,
  Side,
  SpatialHistoryNode,
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

/**
 * Make the viewer state match a record, by REPLACEMENT.
 *
 * `syncViewer` only projected depth, so every other visual field survived
 * whatever happened last: a reset episode inherited the previous one's
 * selection, candidates, rejections and pin, because none of the additive
 * commands in the vocabulary can express removal. That is a state the record can
 * no longer produce, so it could never be corrected — a new episode showing a
 * selection the user made for a different complaint.
 *
 * So each field is set from the record with a replacing command, in dependency
 * order: region first (it clears the sub-region and highlight sets), then the
 * sub-region, then the three id sets, then depth, then the pin. `focusRegion`
 * clearing the highlights is why the candidate set has to be applied after it.
 *
 * Rejections are deliberately NOT carried by a record — they are a
 * presentation-local "not that one" — so they are cleared here rather than
 * projected. Pin HISTORY also survives: it is evidence of past episodes, not
 * state of this one. The active marker does not.
 */
function projectRecordToViewer(
  record: SymptomRecord,
  considered: ConsideredStructure[],
): void {
  anatomy.apply({ type: 'focusRegion', region: record.location.region });
  if (record.location.subRegionId)
    anatomy.apply({ type: 'focusSubRegion', subRegionId: record.location.subRegionId });
  anatomy.apply({
    type: 'setSelected',
    structureIds: [...record.location.userSelectedStructureIds],
  });
  anatomy.apply({
    type: 'setHighlighted',
    structureIds: considered.map((c) => c.structureId),
  });
  anatomy.apply({ type: 'clearReject', structureIds: [...anatomy.getState().rejectedStructureIds] });
  anatomy.apply({ type: 'setDepth', depth: record.location.depth });
  if (record.location.point) anatomy.apply({ type: 'movePin', point: record.location.point });
  else anatomy.apply({ type: 'clearPin' });
}

export type Stage = 'describe' | 'locate' | 'clarify' | 'interview' | 'review' | 'history' | 'unsupported';

interface SessionState {
  stage: Stage;
  /**
   * The question the user is correcting, or null.
   *
   * Held as an explicit target rather than by rewinding a cursor, because "which
   * question is next" is derived from which questions are unanswered and an edit does
   * not change that -- it only changes what is on screen.
   */
  editingQuestionId: string | null;
  startEditAnswer: (questionId: string) => void;
  cancelEditAnswer: () => void;
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
  /**
   * Places, AS THE SERVER GROUPS THEM.
   *
   * Fetched rather than derived, on purpose. The client used to group episodes
   * itself and would merge two places the server had deliberately kept apart,
   * because a place is (person, region, side, sub-region, point cell) and the
   * client only knew three of those five. Nothing here may regroup it.
   */
  spatial: SpatialHistoryNode[];
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
  /** Dismiss a tool suggestion. Presentation-only; the candidate is kept. */
  reject: (id: string) => void;
  /** Undo a rejection. */
  unreject: (id: string) => void;
  selectSubRegion: (id: string) => void;
  setSide: (side: Side) => void;
  setDepth: (depth: Depth) => void;
  answer: (questionId: string, raw: unknown, triState?: 'yes' | 'no' | 'unknown') => void;
  save: () => Promise<void>;
  loadSummary: () => Promise<void>;
  loadHistory: (personId?: string) => Promise<void>;
  /** Load places from the server read model. Never derived from `history`. */
  loadSpatialHistory: (personId?: string) => Promise<void>;
  /**
   * Resume a saved episode: hydrate the record, the answers and the viewer from
   * the server, and carry on the SAME episode rather than starting a new one.
   */
  reopenEpisode: (id: string) => Promise<void>;
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
    editingQuestionId: null,

    startEditAnswer: (questionId) => {
      set({ editingQuestionId: questionId, stage: 'interview' });
    },

    cancelEditAnswer: () => set({ editingQuestionId: null }),
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
    spatial: [],
    orchestratorKind: null,
    clarification: null,

    viewer: anatomy.getState(),
    viewerTick: 0,

    setStage: (stage) => set({ stage }),
    setUtterance: (utterance) => set({ utterance }),
    setError: (error) => set({ error }),
    /**
     * Refresh the viewer's React state, and project the record's depth into the
     * viewer on the way through.
     *
     * Depth is something the user told us — often via localisation rather than
     * the depth control — and it decides which tissue layers the anatomy viewer
     * shows. Projecting it here rather than at each call site means a record can
     * never say "deep inside" while the viewer still displays every layer.
     */
    syncViewer: () => {
      anatomy.apply({ type: 'setDepth', depth: get().record.location.depth });
      set((s) => ({ viewer: anatomy.getState(), viewerTick: s.viewerTick + 1 }));
    },

    describe: async () => {
      const { utterance } = get();
      if (!utterance.trim()) return;
      set({ busy: true, error: null, refusal: null, clarification: null });
      try {
        const result = await api<LocalisationOutcome>('/localise', {
          method: 'POST',
          body: JSON.stringify({ utterance }),
        });

        const { record, considered, allowed, refusal, by } = applyLocalisation(get().record, result);

        if (!allowed) {
          // Localisation refused. Stop here: do NOT open an anatomy view, do NOT
          // fabricate a region, and do NOT start a region interview.
          set({
            record,
            consideredStructures: considered,
            refusal,
            orchestratorKind: null,
            busy: false,
            stage: 'unsupported',
          });
          return;
        }

        // A re-localisation REPLACES the viewer, it does not add to it. Describing
        // a second symptom in the same session used to leave the first episode's
        // selection, candidates, rejections and pin on screen behind the new
        // ones, because every command in the vocabulary is additive and none of
        // them could take the old set back.
        projectRecordToViewer(record, considered);

        const clarification =
          result.status === 'grounded' ? (result.clarificationQuestion ?? null) : null;

        set({
          record,
          consideredStructures: considered,
          answers: EMPTY_ANSWERS,
          // Carried through from the orchestrator, not inferred from the status:
          // a grounded result may have come from the model.
          orchestratorKind: by,
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

    /**
     * Visual selection. NOT confirmation of a structure being the problem.
     *
     * The record's canonical set is `location.userSelectedStructureIds`; the
     * viewer only ever mirrors it, via a replacing command so a deselected id
     * can actually leave.
     */
    select: (id) => {
      const record = selectStructure(get().record, id);
      set({ record });
      anatomy.apply({
        type: 'setSelected',
        structureIds: record.location.userSelectedStructureIds,
      });
      get().syncViewer();
    },

    /**
     * Withdraw a visual selection. The candidate survives — a dismissal is a view
     * decision, and deleting the suggestion would be lossy — so this changes the
     * canonical id set and tells the viewer to match.
     */
    deselect: (id) => {
      const record = deselectStructure(get().record, id);
      set({ record });
      // Without this the adapter kept the id as selected, so a deselect left the
      // record and the viewer disagreeing about what the user pointed at.
      anatomy.apply({
        type: 'setSelected',
        structureIds: record.location.userSelectedStructureIds,
      });
      get().syncViewer();
    },

    /**
     * Dismiss a tool suggestion: "not that one".
     *
     * This is a presentation-local decision about which SUGGESTION to show, not
     * a statement about the user's body, so it is not written to the record. The
     * candidate is kept exactly as it was — rejecting a suggestion must not
     * delete the evidence that it was considered, which is the same reasoning
     * that makes deselect lossless. It only changes what the viewer highlights.
     */
    reject: (id) => {
      // The adapter subscription bumps viewerTick, so the map and any 3D viewer
      // re-render from this alone.
      anatomy.apply({ type: 'reject', structureIds: [id] });
    },

    /** Undo a rejection and let the suggestion be considered again. */
    unreject: (id) => {
      anatomy.apply({ type: 'clearReject', structureIds: [id] });
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
      // Whether this is an edit is read BEFORE the state is written, because writing the
      // answer clears the edit target.
      const editing = get().editingQuestionId === questionId;
      const { record, answers, wroteFields, answer } = recordAnswer(
        get().record,
        get().answers,
        questionId,
        raw,
        triState,
        { edited: editing },
      );
      set({ record, answers, error: null, editingQuestionId: null });
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

    loadSpatialHistory: async (personId = 'local') => {
      const spatial = await api<SpatialHistoryNode[]>(
        `/healthmap/${encodeURIComponent(personId)}/spatial`,
      );
      set({ spatial });
    },

    /**
     * Resume a saved episode.
     *
     * The server assembles everything a resuming session needs — record,
     * answers, next question, progress, outstanding fields, safety — because
     * re-deriving "what is the next question" in the browser is how a client ends
     * up disagreeing with the server about an interview in progress.
     *
     * TWO THINGS THIS MUST NOT DO, and the reason they are called out:
     *
     * It must not create a new episode. `episodeId` is set to the one that was
     * opened, so the next `save()` takes the `pushMutations` branch and updates it
     * in place. Creating a second record for the same complaint would make the
     * history lie about how many times something happened.
     *
     * And it must not leave the viewer showing the previous episode's state, which
     * `projectRecordToViewer` handles by replacement — the same reason `describe`
     * uses it. Reopening is exactly as able to inherit a stale selection as
     * starting a new episode is.
     *
     * Rejections are presentation-only and are not stored on an episode, so they
     * are cleared rather than restored; pin HISTORY survives because it is
     * evidence of past episodes, but the active marker is this episode's.
     */
    reopenEpisode: async (id) => {
      set({ busy: true, error: null });
      try {
        const reopened = await api<EpisodeReopen>(`/episodes/${encodeURIComponent(id)}/reopen`);
        const record = reopened.episode.record;

        // `consideredStructures` is the CANDIDATE projection, not the selection:
        // the viewer needs both restored, and `projectRecordToViewer` applies them
        // as replacing commands so nothing from the previous episode survives.
        projectRecordToViewer(record, record.consideredStructures ?? []);
        reevaluate(record, reopened.answers);

        set({
          episodeId: reopened.episode.id,
          record,
          answers: reopened.answers,
          safety: reopened.safety ?? evaluateSession(record, reopened.answers),
          summary: null,
          refusal: null,
          clarification: null,
          busy: false,
          viewer: anatomy.getState(),
          viewerTick: get().viewerTick + 1,
          // Back to the interview. Not 'review': there is nothing new to review,
          // and an episode with questions outstanding should go back to asking
          // them. A finished episode still lands here and simply has no next
          // question, which the interview panel already handles.
          stage: 'interview',
        });
        void get().loadHistory();
        void get().loadSpatialHistory();
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e), busy: false });
      }
    },

    reset: () => {
      const record = emptyRecord('shoulder');
      // Reset the VIEWER too, not just the store. It used to only move the
      // camera, so the previous episode's selection, candidates, rejections and
      // pin stayed on screen and in adapter state, and the new episode started
      // showing them as if they were the user's current answer.
      projectRecordToViewer(record, []);
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
        spatial: [],
        error: null,
        viewer: anatomy.getState(),
        viewerTick: get().viewerTick + 1,
      });
    },
  };
});

export { peekNextQuestion, progressOf, labelFor };
export type { LocalisationOutcome };
export type { AnswerMap, BodyRegion, ConsideredStructure, MapPoint, SafetyEvaluation, SymptomRecord };
