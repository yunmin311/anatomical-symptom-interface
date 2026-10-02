/**
 * The MCP transport. A thin JSON-RPC 2.0 shell over `tools.ts`.
 *
 * ## Why this is hand-rolled
 *
 * An MCP SDK would be a dependency whose version decides whether a client can talk to us,
 * for a protocol surface that is three messages: `initialize`, `tools/list`, `tools/call`.
 * The tool SEMANTICS are the part that matters and they are all in `tools.ts`, where they
 * are ordinary functions with ordinary tests. This file is transport, and it is
 * deliberately dumb: it looks a name up in the table, calls the handler, and serialises
 * the result.
 *
 * ## Provider independence
 *
 * Nothing here names a vendor, and no tool calls a model. `localise_symptom` goes through
 * the `Orchestrator` interface, which without an API key is the deterministic
 * implementation. A machine with no key and no network gets identical behaviour, which is
 * why the test suite needs no external service and CI cannot become flaky because of one.
 *
 * ## What it does NOT do
 *
 * It does not open the database. Every write goes through the same `applyMutations` the
 * HTTP route calls, inside the server package, in one transaction. This process is a
 * CLIENT of ASI Core. It is not a second path into the store, and it cannot become one:
 * it has no SQL and no store handle beyond the shared functions.
 */
import { createInterface } from 'node:readline';
import { TOOLS, type ToolName, type ToolResult } from './tools.ts';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'asi-symptom-interface', version: '1.0.0' };

/** Wire input schema for a tool, derived from its Zod schema. */
function inputSchemaFor(tool: (typeof TOOLS)[ToolName]): Record<string, unknown> {
  const shape =
    'shape' in tool.inputSchema
      ? (tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape
      : {};
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const [key, raw] of Object.entries(shape)) {
    // `shape` values are heterogeneous Zod nodes; the only two facts needed here are the
    // type name and the description, so narrow once rather than casting four times.
    const def = raw as { description?: string; _def?: { typeName?: string }; defaultValue?: unknown };
    properties[key] = { type: jsonTypeFor(def._def?.typeName) };
    if (typeof def.description === 'string') properties[key].description = def.description;
    // A Zod default means the caller may omit it. Reporting it as required would make a
    // conforming client fail validation for no reason.
    if (def.defaultValue === undefined && def._def?.typeName !== 'ZodOptional')
      required.push(key);
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

/**
 * Zod's internal type name to JSON Schema's type.
 *
 * Reading `_def.typeName` is reaching into an internal. It is done in ONE place, with a
 * fallback, rather than scattered -- and anything unrecognised becomes `string`, which is
 * the conservative choice: a client sending a string for something else is rejected by our
 * Zod validation anyway, so a wrong hint costs a round trip and a wrong "no constraints"
 * hint costs correctness.
 */
function jsonTypeFor(typeName: string | undefined): string {
  switch (typeName) {
    case 'ZodString':
      return 'string';
    case 'ZodNumber':
      return 'number';
    case 'ZodBoolean':
      return 'boolean';
    case 'ZodArray':
      return 'array';
    case 'ZodObject':
      return 'object';
    default:
      return 'string';
  }
}

export function describeTools(): {
  tools: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }[];
} {
  return {
    tools: (Object.keys(TOOLS) as ToolName[]).map((name) => ({
      name,
      description: TOOLS[name].description,
      inputSchema: inputSchemaFor(TOOLS[name]),
    })),
  };
}

/** Run one tool by name. Exported so tests can call the dispatcher without a socket. */
export async function callTool(name: string, args: unknown): Promise<ToolResult> {
  const tool = (TOOLS as Record<string, (typeof TOOLS)[ToolName] | undefined>)[name];
  if (!tool)
    return {
      ok: false,
      error: { code: 'validation_failed', message: `No such tool: ${name}.` },
    };
  try {
    // The handlers are declared with differing input types in the union, so `handler` is
    // not directly callable with `unknown`. The runtime check above has already
    // established the name is real, and each handler validates its own input with Zod.
    const call = tool.handler as (args: unknown) => ToolResult | Promise<ToolResult>;
    return await call(args);
  } catch (e) {
    // A tool that throws is a bug, not a refusal. Say so, rather than letting the process
    // die and taking every other tool with it.
    return {
      ok: false,
      error: { code: 'internal_error', message: e instanceof Error ? e.message : String(e) },
    };
  }
}

/** One JSON-RPC request to one JSON-RPC response. `null` when the id is absent (a notification). */
export async function handleRpc(request: unknown): Promise<unknown | null> {
  const req = request as {
    jsonrpc?: string;
    id?: string | number | null;
    method?: string;
    params?: { name?: string; arguments?: unknown };
  };
  const id = req.id ?? null;

  if (req.jsonrpc !== '2.0')
    return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Expected JSON-RPC 2.0.' } };
  if (typeof req.method !== 'string')
    return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Missing method.' } };

  switch (req.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          // Said out loud, because a client that cannot see our refusal behaviour will
          // happily narrate a refusal as a result.
          instructions:
            'ASI records anatomical symptom episodes. It does not diagnose. Localise before ' +
            'starting an episode; a complaint that does not localise is refused, not guessed. ' +
            'A structure selection is a place the user pointed at, never a finding. Safety ' +
            'notes mean "get this assessed", never a diagnosis. The 2D map is a placeholder, ' +
            'not medical artwork. Clinical rules are NOT clinically reviewed.',
        },
      };
    case 'notifications/initialized':
      return null;
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: describeTools() };
    case 'tools/call': {
      const name = req.params?.name;
      if (typeof name !== 'string')
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'tools/call needs a name.' } };
      const result = await callTool(name, req.params?.arguments ?? {});
      // A refusal is a RESULT with `isError`, not a JSON-RPC error. The call succeeded;
      // the domain declined. Collapsing the two makes a client treat "this region has no
      // midline geometry" as a transport failure and retry it forever.
      return {
        jsonrpc: '2.0',
        id,
        result: result.ok
          ? { content: [{ type: 'text', text: JSON.stringify(result.data, null, 2) }] }
          : { isError: true, content: [{ type: 'text', text: JSON.stringify(result.error) }] },
      };
    }
    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown method: ${req.method}` },
      };
  }
}

/** Read newline-delimited JSON-RPC from stdin and write responses to stdout. */
export function serveStdio(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): void {
  // MCP stdio framing is one JSON object per line. stderr is for logs ONLY: a stray line
  // on stdout is a protocol violation, and a client that reads it as a response hangs.
  const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  rl.on('line', (line) => {
    const text = line.trim();
    if (!text) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } })}\n`);
      return;
    }
    void handleRpc(parsed).then((response) => {
      if (response !== null) output.write(`${JSON.stringify(response)}\n`);
    });
  });
}

// Started directly rather than imported.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  serveStdio();
  console.error(
    `[asi-mcp] ${SERVER_INFO.name} ${SERVER_INFO.version} on stdio -- ${Object.keys(TOOLS).length} tools. ` +
      `Deterministic: no model is called. Clinical rules are NOT clinically reviewed.`,
  );
}