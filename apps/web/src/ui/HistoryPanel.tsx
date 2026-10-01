import { useEffect, useMemo, useState } from "react";
import { REGIONS } from "@asi/shared";
import type { BodyRegion } from "@asi/shared";
import { useSession } from "../state/session.ts";
import { EmptyState, StatusTag } from "./primitives.tsx";
import { BodyIndex } from "../anatomy/BodyIndex.tsx";
import { RecordDetails } from "./RecordDetails.tsx";
import { formatDate } from "./presentation.ts";
import { presentSpatialHistory } from "./spatial-history.ts";

export function HistoryPanel() {
  const { history, spatial, loadHistory, loadSpatialHistory, reopenEpisode } =
    useSession();
  const [filter, setFilter] = useState<BodyRegion | "all">("all");
  const [request, setRequest] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [revision, setRevision] = useState(0);
  const [resuming, setResuming] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setRequest("loading");
    // Both the episodes and the places come from the server. The places are NOT
    // derived from the episodes: a place is (person, region, side, sub-region,
    // quantised point cell) and the client only knows three of those five, so
    // grouping them here would merge two places the storage layer deliberately
    // kept apart.
    void Promise.all([loadHistory(), loadSpatialHistory()])
      .then(() => {
        if (active) setRequest("ready");
      })
      .catch(() => {
        if (active) setRequest("error");
      });
    return () => {
      active = false;
    };
  }, [loadHistory, loadSpatialHistory, revision]);

  // Presentation only: labels, ordering and grouping BY REGION over places the
  // server already identified. It does not create, merge or recount a place.
  //
  // Declared ABOVE the early returns on purpose. A hook placed after them runs a
  // different number of times on the loading render than on the ready one, which
  // React rejects outright.
  const places = useMemo(() => presentSpatialHistory(spatial), [spatial]);

  if (request === "loading")
    return (
      <div className="empty-state" role="status">
        <h2>Loading your health map…</h2>
        <p className="muted">Looking for saved episodes.</p>
      </div>
    );
  if (request === "error")
    return (
      <div className="notice notice--error" role="alert">
        <h2>Your health map could not be loaded.</h2>
        <p>
          Check the local service and try again. This does not mean your records
          are empty.
        </p>
        <button
          className="btn"
          onClick={() => setRevision((value) => value + 1)}
        >
          Try again
        </button>
      </div>
    );
  if (history.length === 0)
    return (
      <EmptyState
        title="Your health map starts with one episode."
        action={
          <button
            className="btn"
            onClick={() => setRevision((value) => value + 1)}
          >
            Refresh records
          </button>
        }
      >
        When you save a symptom record, it appears here under its body area.
        Over time, each area becomes a timeline of your own experiences.
      </EmptyState>
    );

  const regions = Object.values(REGIONS).filter(
    (region) => filter === "all" || filter === region.id,
  );
  return (
    <div className="healthmap-layout">
      <aside className="healthmap-index" aria-label="Filter by body area">
        <h2>Body areas</h2>
        <p className="small">
          {history.length} saved episode{history.length === 1 ? "" : "s"}
        </p>
        <button
          aria-pressed={filter === "all"}
          className="healthmap-region"
          onClick={() => setFilter("all")}
        >
          All areas <span>{history.length}</span>
        </button>
        <BodyIndex
          active={filter === "all" ? undefined : filter}
          onSelect={setFilter}
          counts={Object.fromEntries(
            Object.values(REGIONS).map((region) => [
              region.id,
              history.filter((episode) => episode.region === region.id).length,
            ]),
          )}
        />
        {/*
          Where the body has history, not just how many episodes exist: the
          places the user actually pointed at, most-visited first.
        */}
        {places.regions.length > 0 && (
          <div className="location-marks" data-testid="location-marks">
            <span className="eyebrow">Where you have pointed</span>
            <ul>
              {places.regions
                .filter((r) => filter === 'all' || r.region === filter)
                .flatMap((r) =>
                  r.marks.slice(0, 3).map((mark) => (
                    <li key={mark.id} data-testid={`mark-${mark.region}`}>
                      <button
                        className="location-mark"
                        onClick={() => setFilter(r.region)}
                      >
                        <span className="location-mark__label">{mark.label}</span>
                        <span className="location-mark__count">
                          {mark.episodeCount}
                        </span>
                      </button>
                    </li>
                  )),
                )}
            </ul>
          </div>
        )}
        <p className="small">
          Counts reflect saved records, not symptom severity.
        </p>
        <button
          className="link"
          onClick={() => setRevision((value) => value + 1)}
        >
          Refresh records
        </button>
      </aside>
      <div className="history" aria-live="polite">
        {regions.map((region) => {
          const episodes = history
            .filter((episode) => episode.region === region.id)
            .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
          if (!episodes.length && filter === "all") return null;
          return (
            <section className="history__group" key={region.id}>
              <div className="history-group-heading">
                <h2>{region.label}</h2>
                <span className="small">
                  {episodes.length} episode{episodes.length === 1 ? "" : "s"}
                </span>
              </div>
              {episodes.length === 0 ? (
                <p className="empty-state muted">
                  No episodes recorded in this area.
                </p>
              ) : (
                <ol className="episode-timeline">
                  {episodes.map((episode) => (
                    <li key={episode.id} className="episode-timeline__item">
                      <p className="episode-date">
                        <time dateTime={episode.startedAt}>
                          {formatDate(episode.startedAt)}
                        </time>
                      </p>
                      <details className="episode">
                        <summary>
                          <span className="episode__heading">
                            <strong>{episode.title}</strong>
                            <span className="small">
                              {episode.side === "unknown"
                                ? "Side not recorded"
                                : episode.side.replaceAll("_", " ")}
                            </span>
                          </span>
                          <StatusTag>{episode.status}</StatusTag>
                        </summary>
                        <div className="episode__detail">
                          <RecordDetails
                            record={episode.record}
                            episode={episode}
                          />
                          {/*
                            Continue, not "edit". The endpoint hydrates the record,
                            the answers and the next question from the SAME episode
                            id, so the next save updates it in place. Creating a
                            second record for the same complaint would make the
                            history lie about how many times something happened.
                          */}
                          <p>
                            <button
                              className="btn"
                              disabled={resuming === episode.id}
                              onClick={() => {
                                setResuming(episode.id);
                                void reopenEpisode(episode.id).finally(() =>
                                  setResuming(null),
                                );
                              }}
                            >
                              {resuming === episode.id
                                ? "Opening…"
                                : "Continue this episode"}
                            </button>
                          </p>
                          {episode.safetyFlags.length > 0 && (
                            <section className="record-section">
                              <h3>Recorded safety flags</h3>
                              <ul>
                                {episode.safetyFlags.map((flag) => (
                                  <li key={flag.ruleId}>
                                    <strong>{flag.severity}</strong>:{" "}
                                    {flag.reason}
                                    <p className="small">
                                      Review status: {flag.ruleReviewStatus}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            </section>
                          )}
                          <p className="small">
                            Saved episode. Patient-reported information, not a
                            diagnosis.
                          </p>
                        </div>
                      </details>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
