/**
 * The Showcase entry: synthetic cases, and what each one is here to show.
 *
 * It sits on the describe screen because that is where a case begins — the point of
 * picking one is to put the words into the real box and let the product do the rest.
 * Nothing here writes anything: the panel only fills in the description and gets out
 * of the way, so the case is walked by the same code path as any other complaint.
 */
import { useState } from "react";
import { useSession } from "../state/session.ts";
import { SHOWCASE_CASES, caseById } from "./cases.ts";
import type { ShowcaseCase } from "./cases.ts";
import { INTERVIEW } from "@asi/shared";

export function ShowcasePanel({ onClose }: { onClose: () => void }) {
  const { setUtterance } = useSession();
  const [openId, setOpenId] = useState<string | null>(SHOWCASE_CASES[0]?.id ?? null);

  const start = (item: ShowcaseCase) => {
    setUtterance(item.utterance);
    onClose();
  };

  return (
    <section className="showcase" aria-labelledby="showcase-title" data-testid="showcase-panel">
      <div className="showcase__head">
        <h2 id="showcase-title">Right Shoulder Showcase cases</h2>
        <button className="btn btn--quiet" onClick={onClose}>
          Close
        </button>
      </div>
      {/*
        Stated once, at the top, because it is the thing that makes the cases safe
        to put in front of an audience: nothing here belongs to a real person, and
        nothing here is a diagnosis.
      */}
      <p className="small">
        Five invented complaints, written to be walked through end to end. Every
        case runs the ordinary path — words, body map, questions, review, save —
        and nothing here is a diagnosis or advice of any kind.
      </p>

      <ul className="showcase__cases">
        {SHOWCASE_CASES.map((item) => {
          const open = openId === item.id;
          const panelId = `showcase-case-${item.id}`;
          return (
            <li key={item.id} className="showcase__case">
              <h3>
                <button
                  className="showcase__toggle"
                  aria-expanded={open}
                  aria-controls={panelId}
                  data-testid={`showcase-toggle-${item.id}`}
                  onClick={() => setOpenId(open ? null : item.id)}
                >
                  {item.title}
                </button>
              </h3>
              {open && (
                <div id={panelId} className="showcase__body">
                  <p className="small">{item.shows}</p>
                  {/*
                    The order a case needs is a real constraint, not decoration:
                    the recurrence case reopens an episode the action case saved, so
                    following it out of order shows a demonstrator a history with one
                    entry instead of the point.
                  */}
                  {item.after && item.after.length > 0 && (
                    <p className="small showcase__order">
                      Run after:{" "}
                      {item.after
                        .map((id) => caseById(id)?.title ?? id)
                        .join(", ")}
                      .
                    </p>
                  )}
                  <blockquote className="showcase__words">{item.utterance}</blockquote>
                  <button
                    className="btn btn--primary"
                    data-testid={`showcase-start-${item.id}`}
                    onClick={() => start(item)}
                  >
                    Put these words in the box
                  </button>

                  {item.locate && item.locate.length > 0 && (
                    <>
                      <h4>At the body map</h4>
                      <ol className="showcase__steps">
                        {item.locate.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ol>
                    </>
                  )}

                  <h4>At the questions</h4>
                  <ol className="showcase__steps">
                    {item.steps.map((step) => (
                      <li key={step.questionId}>
                        <span className="showcase__question">
                          {promptFor(step.questionId)}
                        </span>
                        <span className="showcase__how">{step.how}</span>
                      </li>
                    ))}
                  </ol>

                  {item.notes && item.notes.length > 0 && (
                    <>
                      <h4>Afterwards</h4>
                      <ul className="showcase__steps">
                        {item.notes.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The question as the interviewer will see it.
 *
 * Read from the registry rather than written out again here, because a script that
 * quotes a prompt no longer being asked is worse than no script. A question id the
 * registry does not know falls back to the id, which is ugly on purpose: it should
 * be obvious in review rather than quietly absent.
 */
function promptFor(questionId: string): string {
  const question = INTERVIEW.shoulder?.find((q) => q.id === questionId);
  return question ? question.prompt : questionId;
}