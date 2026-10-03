/**
 * The PUBLISHED MCP contract, tested as a client would use it.
 *
 * A real MCP client reads `tools/list` and builds and validates tool calls from it. So
 * these tests read the payload the server actually emits — `handleRpc({method:'tools/list'})`
 * — and assert on the specific properties a client depends on.
 *
 * The previous converter read `node._def.typeName` once per field and understood a handful
 * of node names. That published `string` for `z.object({x,y}).nullish()` and for
 * `z.number().optional()`, and marked defaulted arguments required. Asserting
 * `inputSchema.type === 'object'` passed over all of it, which is why these tests name
 * concrete fields instead.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { handleRpc, describeTools, callTool } from '../src/server.ts';
import { TOOLS } from '../src/tools.ts';
import { zodToJsonSchema } from '../src/json-schema.ts';

/** The tool as a client sees it, through the real JSON-RPC response. */
async function published(name: string) {
  const response = (await handleRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  })) as { result: { tools: { name: string; inputSchema: Record<string, unknown> }[] } };
  const tool = response.result.tools.find((t) => t.name === name);
  assert.ok(tool, `tools/list does not publish ${name}`);
  return tool.inputSchema as {
    type: string;
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

const isRequired = (schema: { required?: string[] }, key: string) =>
  (schema.required ?? []).includes(key);

describe('tools/list publishes a schema a client can actually use', () => {
  test('the converter is recursive: wrappers do not hide the real type', async () => {
    const schema = await published('update_location');

    /*
     * `point` is `z.object({x, y}).nullish()`. The shallow converter saw the outer
     * `ZodOptional`, did not recognise it, and published `string` -- so a client
     * constructing a correct `{x, y}` pin was told to send a string.
     */
    const point = schema.properties['point']!;
    assert.notEqual(
      point.type,
      'string',
      'a nullish object is published as a string, so a client cannot build the argument',
    );

    /*
     * `.nullish()` means the key may be omitted AND may be present holding null, so the
     * published shape is `anyOf: [ <object>, null ]`.
     *
     * The shallow converter could not express that at all: it saw the outer wrapper,
     * recognised nothing, and fell back to `string`. Publishing only the object branch
     * would leave a client unable to CLEAR the pin, which is why null is asserted rather
     * than assumed.
     */
    const branches = (point.anyOf as Record<string, unknown>[] | undefined) ?? [];
    assert.ok(
      branches.some((b) => b['type'] === 'null'),
      'a .nullish() argument is not published as nullable',
    );
    const object = branches.find((b) => b['type'] === 'object');
    assert.ok(object, `the object branch is missing from ${JSON.stringify(point)}`);

    const pointProps = (object!['properties'] ?? {}) as Record<
      string,
      { type?: string; minimum?: number; maximum?: number }
    >;
    assert.equal(pointProps['x']?.type, 'number');
    assert.equal(pointProps['y']?.type, 'number');
    // 0..1, because the point is normalised on the schematic rather than measured.
    assert.equal(pointProps['x']?.minimum, 0);
    assert.equal(pointProps['x']?.maximum, 1);

    // And nothing anywhere in it claims to be a string.
    assert.equal(
      JSON.stringify(point).includes('"string"'),
      false,
      'a nullish coordinate object is advertised as a string somewhere',
    );
  });

  test('a plain optional number is a number, not a string', async () => {
    const schema = await published('get_region_history');
    const limit = schema.properties['limit']!;
    assert.notEqual(
      limit.type,
      'string',
      'an optional number is published as a string, so a client sends "10" and it is rejected',
    );
    // `.int()` is honoured, so the schema says integer rather than number.
    assert.equal(limit.type, 'integer');
    assert.equal(limit.minimum, 1, 'the minimum the handler enforces is not published');
    assert.equal(limit.maximum, 200);
    assert.equal(
      isRequired(schema, 'limit'),
      false,
      'limit has no default and may be omitted, so it must not be required',
    );
  });

  test('a DEFAULTED argument is not required, and advertises its default', async () => {
    // `z.string().default('local')` means the caller MAY omit it and the server fills it in.
    // The shallow converter checked the wrapper, found no `defaultValue`, and marked it
    // required -- so a conforming client had to send a value the server was going to
    // overwrite anyway.
    const schema = await published('get_region_history');
    assert.equal(isRequired(schema, 'personId'), false, 'a defaulted argument is published as required');
    const personId = schema.properties['personId']!;
    assert.equal(personId.type, 'string');
    assert.equal(personId.default, 'local', 'the default value is not published, so a client cannot show it');
  });

  test('every argument published WITH a default is not required', async () => {
    /*
     * A blanket check rather than a per-tool one, because the defect was in the CONVERTER and
     * would repeat identically for every schema.
     *
     * It reads the PUBLISHED schema, not the Zod tree. The first version walked `_def.shape()`,
     * which reached into private internals and broke the moment a tool schema carried a
     * refinement -- `answer_symptom_question` composes the shared presence rule, so its schema
     * is a `ZodEffects` and `shape` is not a function there. Reading the published output is
     * also the more honest assertion: a client never sees the Zod object, it sees this.
     */
    const { tools } = describeTools();
    const offenders: string[] = [];
    for (const tool of tools) {
      const schema = tool.inputSchema as {
        properties?: Record<string, { default?: unknown }>;
        required?: string[];
      };
      for (const [key, node] of Object.entries(schema.properties ?? {})) {
        if (node.default !== undefined && isRequired(schema, key))
          offenders.push(`${tool.name}.${key}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      'these arguments advertise a default yet are published as required, so a client must ' +
        'send a value the server is going to overwrite',
    );
  });

  test('a refined tool schema still publishes its shape, defaults and required set', async () => {
    /*
     * Regression guard for the presence-rule fix.
     *
     * `answer_symptom_question` composes the shared answer schema with the shared presence
     * rule, which wraps it in a `ZodEffects`. The converter reads the inner node of a
     * refinement from `_def.schema`, while optional/nullable/default wrappers keep theirs in
     * `_def.innerType` -- reading the wrong one yields `undefined` and throws
     * `Cannot read properties of undefined (reading 'typeName')`. So a converter that
     * understands only the three wrappers takes the whole `tools/list` response down, for
     * every tool, the first time one schema carries a refinement.
     *
     * Read through `tools/list` rather than the converter directly, because that is what a
     * client sees, and because the server has its own tool-level wrapper that the
     * schema-level function does not.
     */
    const schema = await published('answer_symptom_question');
    assert.equal(schema.type, 'object', 'a refined schema published no object at all');
    assert.equal(schema.additionalProperties, false);

    // `raw` is REQUIRED: it is the whole point of the presence rule, and `z.unknown()` would
    // otherwise make it optional.
    assert.ok(
      (schema.required ?? []).includes('raw'),
      'raw is not published as required, so a client cannot tell a value is mandatory',
    );
    assert.ok(
      (schema.required ?? []).includes('questionId'),
      'questionId is not published as required',
    );
    assert.ok((schema.required ?? []).includes('episodeId'));

    // `createdBy` keeps the tool's default, and a defaulted argument is optional.
    assert.equal(schema.properties['createdBy']!.type, 'string');
    assert.equal(schema.properties['createdBy']!.default, 'user');
    assert.equal(isRequired(schema, 'createdBy'), false);

    // `rawText` is genuinely optional.
    assert.equal(isRequired(schema, 'rawText'), false);

    // And the whole list still converts: one unconvertible tool must not take the response
    // down for every other tool.
    const { tools } = describeTools();
    assert.ok(tools.length >= 10, 'tools/list lost tools');
  });

  test('enums are published with their allowed values', async () => {
    const schema = await published('update_location');
    const side = schema.properties['side']!;
    assert.equal(side.type, 'string');
    assert.deepEqual(side.enum, ['left', 'right', 'midline', 'bilateral', 'unknown']);
    assert.equal(isRequired(schema, 'side'), false);

    const depth = schema.properties['depth']!;
    assert.equal(depth.type, 'string');
    assert.deepEqual(depth.enum, ['superficial', 'deep']);
  });

  test('an array argument is published as an array, with its element type', async () => {
    const schema = await published('select_structure');
    const ids = schema.properties['structureIds']!;
    assert.equal(ids.type, 'array', 'structureIds is not published as an array');
    const items = ids.items as { type?: string } | undefined;
    assert.equal(items?.type, 'string', 'the element type is not published, so a client cannot tell what to send');
    assert.equal(isRequired(schema, 'structureIds'), true, 'structureIds is mandatory');
    assert.equal(isRequired(schema, 'episodeId'), true);
  });

  test('a raw answer accepts anything, and is not narrowed to a string', async () => {
    // `raw` is `z.unknown()` on purpose: a multi-select answer is an ARRAY. Publishing it
    // as `string` would reject a correct answer for a multi-select question.
    const schema = await published('answer_symptom_question');
    const raw = schema.properties['raw']!;
    assert.notEqual(
      raw.type,
      'string',
      'raw is published as a string, which rejects an array answer for a multi-select question',
    );
    assert.equal(isRequired(schema, 'raw'), true, 'an answer must carry its raw value');
  });

  test('get_anatomy_region advertises the region filter it actually honours', async () => {
    // It was `z.object({})` while the handler read `input.region` anyway: an argument the
    // published contract forbade and no client could discover.
    const schema = await published('get_anatomy_region');
    const region = schema.properties['region'];
    assert.ok(region, 'the region filter is not advertised, though the handler honours it');
    assert.equal(region!.type, 'string');
    assert.deepEqual(region!.enum, ['shoulder', 'neck', 'lower_back', 'knee']);
    assert.equal(isRequired(schema, 'region'), false, 'omitting region returns all of them');

    // And the advertised filter is the one that works.
    const one = await callTool('get_anatomy_region', { region: 'shoulder' });
    assert.equal(one.ok, true);
    if (one.ok) assert.equal((one.data as { region: string }).region, 'shoulder');

    // An unknown region is refused by schema validation, which is now reachable and
    // documented rather than an undocumented behaviour.
    const bad = await callTool('get_anatomy_region', { region: 'pancreas' });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error.code, 'validation_failed');
  });

  test('a discriminated union is published with its branches', async () => {
    const schema = await published('start_symptom_episode');
    const grounding = schema.properties['grounding']!;
    assert.ok(
      Array.isArray(grounding.anyOf),
      'the grounding union is not published as anyOf, so a client cannot construct one',
    );
    const branches = (grounding.anyOf as Record<string, unknown>[]).map((b) => JSON.stringify(b));
    assert.equal(branches.length, 2, 'grounding should have exactly the grounded/unsupported branches');
    assert.ok(branches.some((b) => b.includes('unsupported')));
  });

  test('objects do not accept unknown keys', async () => {
    // Without this, a client may believe `additionalProperties: true` and send junk that
    // our Zod parse then rejects -- a disagreement between the contract and the handler.
    const schema = await published('update_location');
    assert.equal(schema.properties !== undefined, true);
    const episode = await published('get_episode');
    assert.equal((episode as Record<string, unknown>)['additionalProperties'], false);
  });
});

describe('the converter itself', () => {
  test('an unhandled node type FAILS rather than publishing a guess', async () => {
    // The previous fallback was `string`, on the reasoning that a wrong hint costs a round
    // trip. It costs more than that: a schema disagreeing with the handler makes the tool
    // unusable, and that is exactly how the original bug shipped.
    class Unsupported {
      readonly _def = { typeName: 'ZodSomethingNobodyHandled' };
      isOptional(): boolean {
        return false;
      }
    }
    assert.throws(
      () => zodToJsonSchema(new Unsupported() as never),
      /does not handle/,
      'an unsupported node type is silently published as a guess',
    );
  });

  test('every node type used by a real tool schema is handled', async () => {
    // A new tool using an unsupported node must fail HERE, not in production.
    const seen = new Set<string>();
    const walk = (node: { _def: { typeName: string } & Record<string, unknown> }) => {
      const typeName = node._def.typeName;
      seen.add(typeName);
      const def = node._def as unknown as Record<string, never>;
      if (typeName === 'ZodOptional' || typeName === 'ZodNullable' || typeName === 'ZodDefault')
        return walk(def['innerType'] as never);
      // `.superRefine(...)` produces ZodEffects; the shape lives underneath.
      if (typeName === 'ZodEffects') return walk(def['schema'] as never);
      if (typeName === 'ZodObject') {
        const shape = (def['shape'] as unknown as () => Record<string, never> | undefined)() ?? {};
        for (const child of Object.values(shape)) walk(child as never);
        return;
      }
      if (typeName === 'ZodArray') return walk(def['type'] as never);
      if (typeName === 'ZodUnion' || typeName === 'ZodDiscriminatedUnion')
        for (const option of (def['options'] as unknown as never[]) ?? []) walk(option as never);
      if (typeName === 'ZodRecord') walk(def['valueType'] as never);
    };
    for (const tool of Object.values(TOOLS))
      walk(tool.inputSchema as unknown as { _def: { typeName: string } & Record<string, unknown> });

    const handled = new Set([
      'ZodString',
      'ZodNumber',
      'ZodBoolean',
      'ZodEnum',
      'ZodLiteral',
      'ZodObject',
      'ZodArray',
      'ZodUnion',
      'ZodDiscriminatedUnion',
      'ZodRecord',
      'ZodOptional',
      'ZodNullable',
      'ZodDefault',
      'ZodUnknown',
      'ZodAny',
      'ZodNull',
      'ZodEffects',
    ]);
    const unhandled = [...seen].filter((t) => !handled.has(t));
    assert.deepEqual(unhandled, [], 'these node types are in use but not handled');
  });
});