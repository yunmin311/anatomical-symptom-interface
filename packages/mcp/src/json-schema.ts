/**
 * Zod -> JSON Schema, for the MCP `tools/list` payload.
 *
 * ## WHY THIS EXISTS AT ALL
 *
 * A real MCP client builds and validates tool calls against `tools/list`'s
 * `inputSchema`. If that schema disagrees with the handler, the server is not usable
 * through its published contract: the client sends a string where an object was
 * declared, or omits an argument the schema calls required, and gets a rejection for a
 * call that was in fact correct.
 *
 * The first version of this file read `node._def.typeName` ONCE per field and mapped a
 * handful of names. That is wrong for every WRAPPED schema, and wrappers are most of a
 * schema:
 *
 *   - `update_location.point` is `z.object({x, y}).nullish()`. The outer node is
 *     `ZodOptional`, which the shallow switch did not understand, so it published
 *     `string`.
 *   - `z.number().optional()` published `string` for the same reason.
 *   - a `.default(...)` argument was marked REQUIRED, because the check inspected the
 *     wrapper instead of unwrapping to the inner node.
 *
 * None of those would have been caught by asserting `inputSchema.type === 'object'`.
 *
 * ## WHY NOT `zod-to-json-schema` OR `z.toJSONSchema`
 *
 * This project is on zod 3.25, whose classic entrypoint does NOT expose
 * `toJSONSchema` -- only the `zod/v4` subpath does, and the domain's schemas are built with
 * the classic API. Adding a conversion dependency for the one place this is needed would
 * put a package in front of every MCP consumer's install to save 200 lines of well-specified
 * work, and a converter we own can be tested against the schemas that actually ship here.
 *
 * ## THE CONTRACT
 *
 * Recursive, wrapper-transparent, and it handles every node type that appears in this
 * repository's tool schemas -- asserted by a test that walks all of them, so a new tool
 * using a node this does not understand FAILS rather than publishing a guess.
 */
import type { ZodTypeAny } from 'zod';

/** A JSON Schema fragment. Deliberately loose: this is a transport shape, not a domain type. */
type JsonSchema = Record<string, unknown>;

/**
 * Does this node accept `undefined`?
 *
 * Two different things are checked and they are not the same. `ZodDefault` means the caller
 * MAY omit the key -- the value is filled in. `ZodOptional` means the key may be absent.
 * Both mean "not required" in JSON Schema, and conflating them is what made defaulted
 * arguments mandatory in the previous version.
 */
function isOptional(node: ZodTypeAny): boolean {
  const typeName = node._def.typeName;
  if (typeName === 'ZodOptional' || typeName === 'ZodDefault') return true;

  // A refinement does not change whether a key may be omitted -- `superRefine` only adds
  // issues -- so optionality is the inner node's. Without this, a refined `z.object()`
  // published EVERY key as required, which is the opposite of what it accepts.
  if (typeName === 'ZodEffects') {
    const inner = innerOf(node);
    return inner !== undefined && isOptional(inner);
  }

  // A union is optional when one of its branches accepts `undefined` -- `z.union([...,
  // z.undefined()])` and friends.
  if (typeName === 'ZodUnion' || typeName === 'ZodDiscriminatedUnion') {
    return (node._def.options as ZodTypeAny[]).some((option) => isOptional(option));
  }

  /*
   * Everything else is REQUIRED, and this is the subtle part.
   *
   * Zod's own `node.isOptional()` answers "would `undefined` parse?" -- and for
   * `z.unknown()` the answer is YES, because `unknown` accepts everything. That made
   * `answer_symptom_question.raw` publish as an OPTIONAL key, so a client could omit the
   * answer entirely and the schema would have said that was fine.
   *
   * Those are different questions. "The key may be omitted" is about the wrapper.
   * "The value may be anything" is about the type. `raw` MUST be present -- the handler
   * needs an answer -- while its VALUE is unconstrained.
   */
  return false;
}

/**
 * The node that carries the real shape, past every wrapper.
 *
 * A LOOP, not a single step. `.nullish()` is `ZodOptional(ZodNullable(ZodObject))`, so
 * unwrapping once lands on `ZodNullable` — which then hit the "unhandled node" throw. That
 * is precisely the wrapper-stacking the shallow converter got wrong, reappearing one level
 * down.
 */
/**
 * The node this one wraps, or `undefined` if it wraps nothing.
 *
 * ONE accessor, because the wrappers do not agree on where the inner node lives:
 * `ZodOptional`/`ZodNullable`/`ZodDefault` keep it in `_def.innerType`, and `ZodEffects` keeps
 * it in `_def.schema`. Reading `_def.innerType` from a `ZodEffects` yields `undefined`, which
 * is what made `isNullable` recurse into `undefined` and throw
 * `Cannot read properties of undefined (reading 'typeName')` the moment a tool schema
 * carried a refinement.
 *
 * `ZodEffects` is not an edge case here: `answer_symptom_question` composes the shared
 * presence rule, so its schema is a refinement, and a converter that cannot see through one
 * publishes no usable schema for it at all.
 */
function innerOf(node: ZodTypeAny): ZodTypeAny | undefined {
  const def = node._def as { innerType?: unknown; schema?: unknown };
  if (def.innerType !== undefined) return def.innerType as ZodTypeAny;
  if (def.schema !== undefined) return def.schema as ZodTypeAny;
  return undefined;
}

/** True for a wrapper that only decorates the node it wraps. */
function isWrapper(node: ZodTypeAny): boolean {
  const typeName = node._def.typeName;
  return (
    typeName === 'ZodOptional' ||
    typeName === 'ZodNullable' ||
    typeName === 'ZodDefault' ||
    typeName === 'ZodEffects'
  );
}

function unwrap(node: ZodTypeAny): ZodTypeAny {
  let current = node;
  // Bounded so a cyclic `_def` cannot hang the server at startup.
  for (let depth = 0; depth < 32; depth += 1) {
    if (!isWrapper(current)) return current;
    const next = innerOf(current);
    if (next === undefined)
      throw new Error(`a ${current._def.typeName} wrapper carried no inner schema`);
    current = next;
  }
  throw new Error('a Zod schema nested more than 32 wrappers deep, which is almost certainly a cycle');
}

/**
 * The default value for a `ZodDefault`, or `undefined` when the node has none.
 *
 * `_def.defaultValue` is a FUNCTION on zod 3, so calling it is required: reading the
 * property yields a function, and publishing that would put `[Function]` in the schema.
 */
function defaultOf(node: ZodTypeAny): unknown {
  // Look THROUGH a refinement: a defaulted key stays omittable when the object carrying it
  // is refined, and publishing the default is what tells a client it may leave it out.
  if (node._def.typeName === 'ZodEffects') {
    const inner = innerOf(node);
    return inner === undefined ? undefined : defaultOf(inner);
  }
  if (node._def.typeName !== 'ZodDefault') return undefined;
  const value = node._def.defaultValue;
  return typeof value === 'function' ? value() : value;
}

/** Numeric/string/list constraints, so a client can validate before calling. */
function constraintsOf(node: ZodTypeAny): JsonSchema {
  const typeName = node._def.typeName;
  const out: JsonSchema = {};
  if (typeName === 'ZodNumber') {
    for (const check of node._def.checks ?? []) {
      if (check.kind === 'min') out.minimum = check.value;
      else if (check.kind === 'max') out.maximum = check.value;
      else if (check.kind === 'int') out.type = 'integer';
    }
  }
  if (typeName === 'ZodString') {
    for (const check of node._def.checks ?? []) {
      if (check.kind === 'min') out.minLength = check.value;
      else if (check.kind === 'max') out.maxLength = check.value;
    }
  }
  if (typeName === 'ZodArray') {
    const min = (node._def.minLength as { value: number } | null)?.value;
    const max = (node._def.maxLength as { value: number } | null)?.value;
    if (min !== null && min !== undefined) out.minItems = min;
    if (max !== null && max !== undefined) out.maxItems = max;
  }
  return out;
}

/** Every string an enum or literal accepts, or undefined when it is not one of those. */
function allowedValues(node: ZodTypeAny): string[] | undefined {
  const typeName = node._def.typeName;
  if (typeName === 'ZodEnum') return [...(node._def.values as string[])];
  if (typeName === 'ZodLiteral') {
    const value = node._def.value;
    return typeof value === 'string' ? [value] : [String(value)];
  }
  return undefined;
}

/**
 * One node -> one JSON Schema.
 *
 * RECURSIVE, and that is the whole point: wrappers are unwrapped before the type is
 * decided, and objects/arrays/unions recurse into their children rather than being
 * flattened to a bare `type`.
 */
export function zodToJsonSchema(node: ZodTypeAny): JsonSchema {
  // Nullability is read BEFORE unwrapping, because unwrapping steps over `ZodNullable`
  // and a key that may hold null has to stay published as such. A `nullish` point is
  // optional AND nullable, and a client that is told only "optional" will not send null.
  const nullable = isNullable(node);
  const schema = zodInnerToJsonSchema(unwrap(node));
  return nullable ? nullableOf(schema) : schema;
}

/** Does this node accept `null`? `z.nullish()` and `z.string().nullable()` both do. */
function isNullable(node: ZodTypeAny): boolean {
  if (node._def.typeName === 'ZodNullable') return true;
  // A refinement cannot make a value nullable, and cannot stop one being nullable either, so
  // `ZodEffects` is transparent here -- which is only true because `innerOf` knows where a
  // refinement keeps its inner node.
  if (node._def.typeName === 'ZodEffects') {
    const inner = innerOf(node);
    return inner !== undefined && isNullable(inner);
  }
  const inner = innerOf(node);
  return node._def.typeName !== 'ZodObject' && inner !== undefined && isNullable(inner);
}

/**
 * Widen a schema to also accept `null`.
 *
 * Uses `anyOf` rather than a type array, because the property may already BE a union
 * (`anyOf`) or carry an `enum`, and merging those shapes correctly is where a naive
 * `type: ['object','null']` goes wrong.
 */
function nullableOf(schema: JsonSchema): JsonSchema {
  if (schema.enum) return { enum: [...(schema.enum as unknown[]), null] };
  return { anyOf: [schema, { type: 'null' }] };
}

/** The unwrapped node's schema, with no nullability applied. */
function zodInnerToJsonSchema(target: ZodTypeAny): JsonSchema {
  /*
   * `unwrap` normally strips wrappers before this is reached. `ZodEffects` is handled here
   * as well as in `unwrap`, because a refinement may sit on a node that is not itself a
   * wrapper -- `z.string().superRefine(...)`, for instance -- and reaching the type dispatch
   * with an unhandled `ZodEffects` would throw on a schema that is perfectly ordinary.
   */
  if (target._def.typeName === 'ZodEffects') {
    const inner = innerOf(target);
    if (inner === undefined) throw new Error('a ZodEffects carried no inner schema');
    return zodInnerToJsonSchema(inner);
  }

  const typeName = target._def.typeName;

  // Objects, including their per-key optionality and descriptions.
  if (typeName === 'ZodObject') {
    const shape = target._def.shape() as Record<string, ZodTypeAny>;
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, child] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(child);
      const description = child.description;
      if (typeof description === 'string') properties[key].description = description;
      const fallback = defaultOf(child);
      if (fallback !== undefined) properties[key].default = fallback;
      // Required only when the key may NOT be omitted.
      //
      // `isOptional` already covers `ZodOptional` ("you may leave it out") and
      // `ZodDefault` ("you may leave it out and I will fill it in"). The previous version
      // added `|| defaultOf(child) !== undefined`, which inverted exactly that: a key WITH
      // a default was published as REQUIRED, so a conforming client had to send a value
      // the server was about to overwrite. A default is the strongest possible evidence that
      // the key can be omitted.
      if (!isOptional(child)) required.push(key);
    }
    const out: JsonSchema = { type: 'object', properties, additionalProperties: false };
    if (required.length) out.required = required;
    return out;
  }

  if (typeName === 'ZodArray') {
    const out: JsonSchema = {
      type: 'array',
      items: zodToJsonSchema(target._def.type as ZodTypeAny),
    };
    return { ...out, ...constraintsOf(target) };
  }

  // A discriminated union is an object with a fixed `status`; a plain union is `anyOf`.
  if (typeName === 'ZodDiscriminatedUnion') {
    return {
      anyOf: (target._def.options as ZodTypeAny[]).map((o) => zodToJsonSchema(o)),
      // A discriminated union is always an object at the top, and saying so helps a
      // client that builds a form from the schema.
      type: 'object',
    };
  }
  if (typeName === 'ZodUnion') {
    return { anyOf: (target._def.options as ZodTypeAny[]).map((o) => zodToJsonSchema(o)) };
  }

  if (typeName === 'ZodEnum' || typeName === 'ZodLiteral') {
    const values = allowedValues(target)!;
    return { type: 'string', enum: values };
  }

  if (typeName === 'ZodNumber') return { type: 'number', ...constraintsOf(target) };
  if (typeName === 'ZodBoolean') return { type: 'boolean' };
  if (typeName === 'ZodString') return { type: 'string', ...constraintsOf(target) };

  // `z.unknown()` accepts anything INCLUDING null, so it must not be published as a
  // concrete type. Claiming `string` would reject a perfectly valid `raw: ['a','b']`.
  if (typeName === 'ZodUnknown' || typeName === 'ZodAny') return {};
  if (typeName === 'ZodNull') return { type: 'null' };

  /*
   * `ZodEffects` is what `.superRefine(...)` produces.
   *
   * It appears in this repository because `FieldMutationInputSchema` and
   * `AnswerInputSchema` gained a refinement: they must REJECT a mutation or answer with no
   * `value`/`raw` key at all, which is the whole point of issue 2 -- both surfaces now
   * return `validation_failed` for a missing value instead of disagreeing about what a
   * generic error means.
   *
   * A refinement cannot be expressed in JSON Schema, so the effect is unwrapped to the type
   * it constrains. That is honest: the published schema describes the SHAPE, and the shape
   * is what a client constructs. The refinement is still enforced on every call, by the
   * handler's own `safeParse`, so nothing is lost -- a client that sends a malformed value
   * still gets `validation_failed` at call time.
   */
  if (typeName === 'ZodEffects') return zodInnerToJsonSchema(target._def.schema as ZodTypeAny);

  /*
   * Anything else is a node this converter does not understand.
   *
   * It THROWS. The previous behaviour was to fall back to `string`, on the reasoning that a
   * wrong hint costs a round trip -- which is true, and misses the point: the point is that
   * a schema disagreeing with the handler makes the server unusable, and a silent fallback
   * is how that disagreement got shipped the first time. Failing here means a new tool
   * using an unsupported node cannot be published at all until the converter handles it.
   */
  throw new Error(
    `zodToJsonSchema does not handle ${typeName}. Add it rather than publishing a guess: a ` +
      `schema that disagrees with the handler makes the tool unusable through MCP, and that ` +
      `is a worse failure than a server that refuses to start.`,
  );
}

/** The object schema for a tool's arguments. */
export function inputSchemaFor(schema: ZodTypeAny): JsonSchema {
  return zodToJsonSchema(schema);
}