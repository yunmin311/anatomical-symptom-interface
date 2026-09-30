import { INTERVIEW } from "@asi/shared";
import type { PreVisitSummary } from "@asi/shared";

export function readable(value: string | null | undefined): string {
  if (!value || value === "unknown") return "Not recorded";
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

/** Copy the same full content displayed, including the rule engine's action steps. */
export function summaryText(summary: PreVisitSummary): string {
  return [
    "PRE-VISIT SYMPTOM SUMMARY",
    `Generated ${summary.generatedAt}`,
    summary.chiefComplaint,
    ...groupSummaryRows(summary.history).flatMap((section) => [
      "",
      section.title,
      ...section.rows.map((row) => `${row.label}: ${row.value}`),
    ]),
    ...(summary.visualSelections.length
      ? [
          "",
          "Areas you pointed to (location, not a finding)",
          ...summary.visualSelections,
        ]
      : []),
    ...(summary.safetyGateBlocked
      ? ["", "SAFETY GATE BLOCKED. This record has NOT been safely assessed."]
      : []),
    ...summary.withheldNotes.map(
      (note) => `Withheld [${note.severity}]: ${note.reason}`,
    ),
    ...(summary.unselectedSuggestions.length
      ? [
          "",
          "Suggested, not acted on — not findings",
          ...summary.unselectedSuggestions,
        ]
      : []),
    ...(summary.priorEpisodes.length
      ? [
          "",
          "Earlier episodes in this area",
          ...summary.priorEpisodes.map(
            (episode) =>
              `${episode.startedAt}: ${episode.title} (${episode.status})`,
          ),
        ]
      : []),
    ...(summary.safetyNotes.length
      ? [
          "",
          "Safety information",
          ...summary.safetyNotes.flatMap((note) => [
            `[${note.severity}] ${note.title}`,
            note.message,
            ...note.steps,
          ]),
        ]
      : []),
    ...(summary.outstandingFields.length
      ? ["", "Not established", ...summary.outstandingFields]
      : []),
    "",
    "Data sources",
    ...summary.dataSources.map(
      (source) => `${source.sourceType}: ${source.count} field(s)`,
    ),
    "",
    "This summary was produced by a patient self-report tool. It is not a diagnosis.",
  ].join("\n");
}

/** Group raw answers for review without treating record defaults as answers. */
export function answerSections(
  record: import("@asi/shared").SymptomRecord,
  answers: import("@asi/shared").AnswerMap,
) {
  const groups = new Map<string, { label: string; value: string }[]>();
  for (const question of INTERVIEW[record.location.region]) {
    const title = question.safetyRuleId
      ? "Safety questions"
      : question.field.startsWith("temporal.")
        ? "Timeline"
        : question.field.startsWith("function.")
          ? "Functional impact"
          : question.field.startsWith("location.")
            ? "Location details"
            : question.field.startsWith("context.")
              ? "Additional context"
              : "Symptom characteristics";
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
