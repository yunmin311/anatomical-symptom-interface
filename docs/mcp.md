# The MCP surface

A Model Context Protocol server over ASI Core. Provider-independent, deterministic, and a
**client** of the domain rather than a second path into it.

---

## Run it

```bash
# from the repo root, with the local database
pnpm --filter @asi/mcp start
```

It speaks newline-delimited JSON-RPC 2.0 on stdio, which is the MCP stdio framing.
Diagnostics go to **stderr only** — a stray line on stdout is a protocol violation and a
client that reads it as a response will hang.

Client configuration, minimal:

```json
{
  "mcpServers": {
    "asi": {
      "command": "node",
      "args": ["--experimental-strip-types", "packages/mcp/src/server.ts"],
      "cwd": "/absolute/path/to/anatomical-symptom-interface",
      "env": { "ASI_DB_PATH": "data/asi.sqlite" }
    }
  }
}
```

If `tsc` is preferred over type stripping, build first and point `command` at the built
entry instead.

No API key is required and none is used. Without a key, localisation runs the
deterministic orchestrator, so behaviour is identical on a machine with no network — which
is why the test suite needs no external service and CI cannot become flaky because of one.

---

## The tools

| tool | what it does |
| --- | --- |
| `get_anatomy_region` | What can actually be rendered, per region and side, including refusals and why |
| `localise_symptom` | Localise a description, or refuse explicitly |
| `start_symptom_episode` | Create an episode; requires a real grounding outcome |
| `update_location` | Record side, depth, sub-region, approximate pin |
| `select_structure` | Record structures the user **pointed at** |
| `answer_symptom_question` | Record an answer; **correcting** an existing one is this tool |
| `get_episode` | Read the episode with grounding, answers and safety |
| `reopen_episode` | Resume: record, answers, next question, progress, outstanding |
| `get_episode_summary` | The deterministic pre-visit summary |
| `get_region_history` | Where this person's body has been sore, as places |

`nextQuestionFor`, `listFor`, `interviewFor` and `priorFor` are exported helpers rather than
tools: a client that wants to drive the interview question by question uses `reopen_episode`,
which returns the next question and the outstanding set computed server-side. Re-deriving
them client-side is how two surfaces end up disagreeing about both.

---

## What it cannot do

**It does not open the database.** Every write goes through `applyMutations` — the same
function `POST /api/episodes/:id/mutations` calls — inside one transaction, in the server
package. There is no SQL in `packages/mcp`, no store handle beyond the shared functions, and
no way to write a field the HTTP API could not write.

**It cannot bypass the field policy.** A write to a `requiresUserSource` field from an
inference source is refused by the registry, inside the transaction, identically for both
surfaces. There is a test that sends the *same* forbidden request through both and asserts
both refuse.

**It cannot bypass provenance.** Clients state `sourceType`, `verificationStatus` and
`createdBy`; the server decides whether that source may write that field. The client is
never believed about the fact that a correction happened either — the store derives
`user_edited` from the row.

**It cannot bypass canonicalisation.** `asi:neck.upper-trapezius` is accepted, stored as
`asi:shoulder.trapezius-upper`, and the caller is **told** what changed. Silently rewriting
an id leaves the caller holding one that will never match again.

**It cannot bypass safety.** Safety is a rule engine over typed signals, evaluated inside
the mutation transaction. No tool calls a model.

**It does not diagnose, and does not invite a diagnosis.** The `initialize` instructions
say so, and every tool description that mentions diagnosis negates it. A test enforces
that: a client model reads the tool text and does not read the rest of the repository.

**It does not treat a visual selection as a finding.** The tool is `select_structure`, not
`confirm`, and its description says so twice.

**It does not present location history as risk.** `get_region_history` returns places and
counts; a test asserts the payload contains no word that would invite reading frequency as
severity.

---

## One implementation, two surfaces

`answer_symptom_question` had a real defect when it was first written: it stored the answer
and nothing else, so "the user says it wakes them at night" became a stored answer that
changed nothing a clinician reads.

It now derives the field mutations from the question's own `applyTo`, using the **same**
`applyAnswer` and `mutationsForAnswer` the browser uses — moved into `@asi/shared` precisely
so both surfaces answer "what does this answer write?" identically. Both the answer and its
fields go into one `applyMutations` call, which is what lets the safety re-evaluation see the
new signal: an answer and its fields in separate transactions would let the rules run against
a record the answer has not reached.

Building that also surfaced a domain bug rather than an MCP bug: `shoulder.night_pain`
returned early for a definite "no", so correcting "yes" to "no" kept the night trigger the
record still claimed the user reported. The correction was accepted and marked
`user_edited`, and had no effect on anything a clinician reads — which makes the whole
correction feature cosmetic for that question. Uncertainty still never changes the record;
a definite denial now withdraws.

---

## The crossing test

`packages/mcp/test/mcp.test.ts`, `one episode crosses every surface`: an assistant records
a shoulder complaint over MCP — location, two pointed structures (one of them a retired id),
an answer — and the same episode is then read over HTTP. Same side, same depth, same
sub-region, same canonical ids **in the order they were pointed**, same answers. Then it
runs the other way: a write over HTTP is visible over MCP, with the right provenance. Then
one record, not two. Then the summary is byte-identical across surfaces once the generation
timestamp is normalised.

This is the test that makes "MCP is not a second product" a claim rather than a hope.

---

## Adding a tool

1. Add it to `TOOLS` in `packages/mcp/src/tools.ts` with a description that says what it
   does *and what it does not claim*.
2. Reuse `@asi/shared` schemas. Do not declare a new payload shape.
3. Write through `write()`, or another ASI Core function. Never SQL.
4. Add a test that the same request through the HTTP route behaves identically.

A tool that re-implements field policy, provenance, canonicalisation or safety has two
answers to one question, and the permissive one is the one that ships.