import { INTERVIEW } from "@asi/shared";
import type { PreVisitSummary } from "@asi/shared";

/**
 * Render a stored record value without collapsing uncertainty into missing
 * information.
 *
 * 'unknown' is the record saying the user explicitly could not establish this
 * (they answered "I am not sure"). An absent value means the question was never
 * asked. Those are different facts and the domain keeps them apart, so the view
 * must too: reporting either as "Not recorded" makes an unanswered question and
 * a stated uncertainty indistinguishable to whoever reads the record.
 */
export function readable(value: string | null | undefined): string {
  if (value === "unknown") return "Not established — user is not sure";
  if (!value) return "Not asked";
  return value.replaceAll("_", " ");
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
}

const SECTIONS = [
  { title: "Your own words", labels: ["Patient's own words"] },
  {
    title: "Anatomical location",
    labels: [
      "Location",
      "Side",
      "Depth (patient report)",
      "Areas pointed to on the body map",
    ],
  },
  {
    title: "Symptom characteristics",
    labels: [
      "Quality",
      "Triggers",
      "Trigger detail",
      "Radiation",
      "Tenderness on palpation",
    ],
  },
  {
    title: "Timeline",
    labels: ["Onset", "Duration", "Frequency", "Trend", "Recurrence"],
  },
  {
    title: "Functional impact",
    labels: [
      "Patient intensity (0-10)",
      "Functional impact",
      "Sleep affected",
      "Analgesia",
      "Weight bearing",
    ],
  },
  {
    title: "Additional context",
    labels: [
      "Systemic symptoms",
      "Recent injury",
      "Recent activity",
      "Current medication",
      "Prior conditions",
    ],
  },
];

/** Preserve new API labels in an explicit fallback section rather than losing them. */
export function groupSummaryRows(rows: PreVisitSummary["history"]) {
  const known = new Set(SECTIONS.flatMap((section) => section.labels));
  return [
    ...SECTIONS.map((section) => ({
      title: section.title,
      rows: rows.filter((row) => section.labels.includes(row.label)),
    })),
    {
      title: "Other details",
      rows: rows.filter((row) => !known.has(row.label)),
    },
  ].filter((section) => section.rows.length > 0);
}

/** Group raw answers for review without treating record defaults as answers. */
export function answerSections(
  record: import("@asi/shared").SymptomRecord,
  answers: import("@asi/shared").AnswerMap,
) {
  const groups = new Map<string, { label: string; value: string }[]>();
  for (const question of INTERVIEW[record.location.region]) {
      const title = sectionTitleFor(question.field, question.safetyRuleId);
    const answer = answers[question.id];
    const raw = answer
      ? Array.isArray(answer.raw)
        ? answer.raw
        : [answer.raw]
      : [];
    const value = !answer
      ? "Not asked"
      : question.type === "boolean"
        ? answer.triState === "unknown"
          ? "Not established — I am not sure"
          : answer.triState
        : raw
            .map(
              (value) =>
                question.options?.find((option) => option.value === value)
                  ?.label || String(value),
            )
            .join(", ");
    groups.set(title, [
      ...(groups.get(title) || []),
      { label: question.prompt, value },
    ]);
  }
  return [...groups].map(([title, rows]) => ({ title, rows }));
}

/**
 * Which section a question is grouped under.
 *
 * Exported because the grouping drives BOTH the rendered rows and the edit controls in
 * RecordDetails. Duplicating this rule in the two places is how "Safety questions" ends
 * up with rows but no edit links: both copies look right right up to the day one changes.
 */
export function sectionTitleFor(field: string, safetyRuleId?: string): string {
  return safetyRuleId
    ? "Safety questions"
    : field.startsWith("temporal.")
      ? "Timeline"
      : field.startsWith("function.")
        ? "Functional impact"
        : field.startsWith("location.")
          ? "Location details"
          : field.startsWith("context.")
            ? "Additional context"
            : "Symptom characteristics";
}

/**
 * The answers belonging to one section, in question order.
 *
 * The edit controls are driven from this rather than from the row labels, because the
 * rows are strings built for reading while an edit needs the question id.
 */
export function answersInSection(
  record: import("@asi/shared").SymptomRecord,
  answers: import("@asi/shared").AnswerMap,
  title: string,
): import("@asi/shared").QuestionAnswer[] {
  return INTERVIEW[record.location.region]
    .filter(
      (q) =>
        sectionTitleFor(q.field, q.safetyRuleId) === title && answers[q.id] !== undefined,
    )
    .map((q) => answers[q.id])
    .filter((a): a is NonNullable<typeof a> => a !== undefined);
}
