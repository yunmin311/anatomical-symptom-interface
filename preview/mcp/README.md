# MCP against the preview

## What the MCP server actually is

**It is not an HTTP client of the preview API.** `packages/mcp` imports ASI Core in-process
and opens the same SQLite file the API opens:

```text
packages/mcp/src/tools.ts
  -> @asi/server/src/db/store.ts     <- the same applyMutations
  -> @asi/server/src/env.ts          <- the same ASI_DB_PATH
```

That is the point of the surface: one write path, one transaction, one implementation of the
field policy and the safety rules. A remote MCP client would need its own copy of those rules
and would be a second thing to keep in step.

The consequence for a preview is concrete and easy to get wrong:

> **`ASI_DB_PATH` is the only thing that decides which data MCP sees.**
> Set it to the preview database while `preview/preview.sh start` is running and MCP reads
> exactly what the browser is looking at. Set it elsewhere and MCP still works — it just
> works against a different, empty database.

Check `GET /api/health` before trusting anything MCP tells you.

## Running it

With the preview already up:

```bash
ASI_DB_PATH=./preview/.preview-data/preview.sqlite \
ASI_DEPLOY_KIND=preview \
ASI_RELEASE_PROFILE=development \
  pnpm --filter @asi/mcp start
```

`preview/mcp/asi-preview.mcp.json` is the same thing as a client config entry. It carries a
`$comment` explaining the above, so the reasoning travels with the config.

## What it must never be pointed at

**Real patient records.** The preview database is synthetic — `personId: "local"`,
`displayName: "Me"`, fictional episodes — and it is rebuilt on every start. That is the only
dataset this configuration is for.

## The ten tools

`docs/mcp.md` is the reference: schemas, semantics, the four-state answer rules, and the
refusal codes. The short version:

| tool | what it is for |
|---|---|
| `start_symptom_episode` | create an episode from a grounded region |
| `localise_symptom` | text → region, or an honest refusal |
| `get_anatomy_region` | the ontology, incl. regions with no 3D |
| `update_location` | side, depth, sub-region, schematic point |
| `select_structure` | "the user pointed at" — **not** a finding |
| `answer_symptom_question` | four-state answers; re-answering corrects and withdraws |
| `get_episode` / `get_episode_summary` | read back the record and the clinician view |
| `reopen_episode` | continue the **same** episode |
| `get_region_history` | where and how often — never severity or risk |

Two rules that are easy to get wrong from an assistant:

- **A visual selection is not a finding.** Describe `select_structure` as "pointed at" or
  "indicated". Never "confirmed". The word must not appear in a summary.
- **Yes, no, unknown and not-asked are four different things.** Never collapse an unclear
  answer into "no".

## Release state

`ASI_RELEASE_PROFILE=development` is deliberate. The `release` profile **refuses to start**
while safety rules are unreviewed, and all 10 are unreviewed — that refusal is the correct
behaviour and a preview does not get to bypass it. The server labels every unreviewed rule as
a prototype while it runs.