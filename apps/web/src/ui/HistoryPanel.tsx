import { useEffect, useMemo, useState } from "react";
import { REGIONS } from "@asi/shared";
import type { BodyRegion } from "@asi/shared";
import { useSession } from "../state/session.ts";
import { EmptyState, StatusTag } from "./primitives.tsx";
import { BodyIndex } from "../anatomy/BodyIndex.tsx";
import { RecordDetails } from "./RecordDetails.tsx";
import { formatDate, sidePhrase, statusPhrase } from "./presentation.ts";
import { presentSpatialHistory } from "./spatial-history.ts";

export function HistoryPanel() {
  const { history, spatial, loadHistory, loadSpatialHistory, reopenEpisode } =
    useSession();
  const [filter, setFilter] = useState<BodyRegion | "all">("all");
  /**
   * The OPENED PLACE, by the server's `regionRowId`.
   *
   * Separate from `filter` on purpose. `filter` is a region, which is a display
   * grouping; a PLACE is what the server decided, and two places can sit in the same
   * sub-region a few millimetres apart. Clicking a mark used to set the region filter,
   * which showed every episode in the region as though the mark were one place --
   * precisely the client-side regrouping `spatial-history.ts` exists to forbid.
   *
   * Null means no place is open.
   */
  const [openPlaceId, setOpenPlaceId] = useState<string | null>(null);
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

  /**
   * The open place, and the exact set of episode ids the SERVER says belong to it.
   *
   * Built from `place.episodes`, not from re-matching the episode list on region,
   * side and sub-region. Those are three of the five fields that make a place; the
   * other two are the quantised point cell and the row identity. Re-matching locally
   * would merge two places the server deliberately kept apart -- the failure this panel
   * exists to avoid.
   *
   * Null when no place is open, or when the place has been closed.
   */
  const openPlace = openPlaceId
    ? places.regions.flatMap((r) => r.marks).find((m) => m.id === openPlaceId) ?? null
    : null;
  const openPlaceEpisodeIds = openPlace
    ? new Set(openPlace.episodes.map((e) => e.id))
    : null;
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
                  /*
                    Every mark, not the first three. The list is already ordered by
                    recency and capping it at three meant a person with more than three
                    places could not reach the rest of their own history from the map --
                    the counts were on screen and the way in was not.
                  */
                  r.marks.map((mark) => (
                    <li key={mark.id} data-testid={`mark-${mark.region}`}>
                      {/*
                        Opens the PLACE, not the region. This used to set the region
                        filter, which showed every episode in the region as though one
                        mark were one place -- exactly the client-side regrouping
                        `spatial-history.ts` exists to forbid. Two places can share a
                        sub-region and differ only by their point cell.
                      */}
                      <button
                        className="location-mark"
                        data-place-id={mark.id}
                        aria-pressed={openPlaceId === mark.id}
                        onClick={() =>
                          setOpenPlaceId((current) => (current === mark.id ? null : mark.id))
                        }
                      >
                        <span className="location-mark__label">{mark.label}</span>
                        {/*
                          A count with no "last time" cannot answer "which of
                          these three was recent", which is the only reason to
                          look at a place. `lastEpisodeAt` is already on the place
                          the server sent; it was simply not shown.
                        */}
                        <span className="location-mark__when">
                          {mark.lastEpisodeAt
                            ? formatDate(mark.lastEpisodeAt)
                            : 'No date recorded'}
                        </span>
                        <span className="location-mark__count">
                          {mark.episodeCount} episode
                          {mark.episodeCount === 1 ? '' : 's'}
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
      {openPlace && (
        /*
          The open place, stated in the server's own terms.
          
          The aggregate point and each episode's own point are BOTH shown, and labelled
          as different things. Collapsing them would mean every episode in this place
          appears to have happened at the mean of all of them, which is precisely the
          substitution the server contract exists to prevent.
        */
        <section
          className="open-place"
          data-testid="open-place"
          aria-live="polite"
          aria-label={`Selected place: ${openPlace.label}`}
        >
          <div className="open-place__heading">
            <h2>{openPlace.label}</h2>
            <button
              className="link"
              data-testid="close-place"
              onClick={() => setOpenPlaceId(null)}
            >
              Close
            </button>
          </div>
          <p className="small">
            {openPlace.episodeCount} episode
            {openPlace.episodeCount === 1 ? "" : "s"} in this place.
            {openPlace.lastEpisodeAt
              ? ` Most recent ${formatDate(openPlace.lastEpisodeAt)}: ${
                  openPlace.episodes[0]?.title ?? ""
                }`
              : ""}
          </p>
          <p className="small muted">
            {openPlace.point
              ? "Area of this place on the body map (the average of the pins here)."
              : "No episode in this place carried a point, so there is no position to show."}
          </p>
        </section>
      )}
      <div className="history" aria-live="polite">
        {regions.map((region) => {
          const episodes = history
            .filter(
              (episode) =>
                episode.region === region.id &&
                // `null` means no place is open, so everything in the region shows.
                (openPlaceEpisodeIds === null || openPlaceEpisodeIds.has(episode.id)),
            )
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
                            {/*
                              The user's own words are the heading, not the title.

                              Every episode title is `"<region> — <date>"`, so
                              three episodes in one region were indistinguishable
                              except by the date already printed underneath — and
                              "most recent occurrence" and "is this the open one"
                              are not answerable from a list like that. This is
                              the alternative the audit asked for: show the
                              distinguishing facts instead of relying on the
                              title. A title derived from what the user said is a
                              Main Agent capability request, recorded in
                              docs/design/v1-product-audit.md, not invented here.
                            */}
                            <strong className="episode__words">
                              {episode.record.location.userPhrase ||
                                episode.title}
                            </strong>
                            <span className="small">
                              {sidePhrase(episode.side)}
                            </span>
                          </span>
                          <StatusTag>{statusPhrase(episode.status)}</StatusTag>
                        </summary>
                        <div className="episode__detail">
                          {(() => {
                            const own = openPlace?.episodes.find((e) => e.id === episode.id);
                            if (!openPlace) return null;
                            return (
                              <p className="small muted" data-testid="episode-own-point">
                                {own?.point
                                  ? "This episode's own position, which may differ from the place average."
                                  : "This episode carried no point of its own."}
                              </p>
                            );
                          })()}
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
