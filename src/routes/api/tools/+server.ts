import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { standardSchemaToJSONSchema } from '@mastra/core/schema';
import { createResearchTools } from '$lib/agent/tools';
import { createImageTools } from '$lib/agent/image-tools';

/**
 * What the agent *has*, as opposed to what it did.
 *
 * Every other X-ray endpoint reports on a run. This one reports on the agent
 * standing still, because the most expensive thing about a tool is not calling
 * it. A tool's name, description and JSON Schema are re-sent on **every**
 * provider call whether or not the model reaches for it — five tools with
 * carefully written descriptions is a fixed charge levied twelve times across a
 * twelve-step research turn, before a single paper is retrieved.
 *
 * The context panel already measures that charge, off the real outgoing
 * request. What it cannot say is *which tool is worth it*: a 2 KB description
 * that stops the model inventing citations is a bargain, and a 2 KB
 * description nobody has re-read since it was written is rent. Answering that
 * needs the schemas laid out side by side, which is what this is.
 *
 * ── Why the tools are built here rather than described ──────────────────────
 * The alternative — a hand-kept list of tool names and sizes — would be wrong
 * within a week and would be wrong *silently*, which is the failure mode the
 * whole X-ray exists to refuse. So the real factories are called and the real
 * schemas serialised. If a tool is added, renamed or its description grows, the
 * panel changes without anyone touching it.
 *
 * Building them is cheap and safe: `createResearchTools` mints a source
 * registry and closures, and nothing in either factory touches the network or
 * the provider until a tool is actually executed. The registry made here is
 * thrown away with the request.
 *
 * No auth check: `hooks.server.ts` gates every route but the login page.
 */

/**
 * How the provider is told about a tool, reconstructed.
 *
 * The AI SDK sends the OpenAI Responses shape — `{ type, name, description,
 * parameters, strict }` — and `context.ts` bills exactly that object when it
 * decomposes the captured request. Counting the same shape here is what makes
 * the two panels agree; counting the schema alone would understate every row by
 * however long its description is, which for these tools is most of the weight.
 *
 * This is still a *reconstruction*. The measured number is the one in the
 * context panel, and where they disagree the context panel is right.
 */
function wireEntry(id: string, description: string, parameters: unknown) {
	return { type: 'function', name: id, description, parameters, strict: false };
}

/**
 * A tool's input schema as JSON Schema, via Mastra's own converter.
 *
 * Mastra's, not `z.toJSONSchema`, because Mastra is what performs this
 * conversion on the way to the provider — using a second converter would
 * produce a number that is defensible and not the one being charged for.
 *
 * A tool with no input schema is legal and yields no parameters rather than an
 * empty object, so its row reports what it is: description and nothing else.
 */
function schemaOf(schema: unknown): unknown {
	if (!schema) return undefined;
	try {
		return standardSchemaToJSONSchema(schema as Parameters<typeof standardSchemaToJSONSchema>[0]);
	} catch {
		// A schema that will not serialise is a fact worth surviving rather than a
		// 500: the other four rows are still true and still worth showing.
		return undefined;
	}
}

interface Described {
	id: string;
	description?: string;
	inputSchema?: unknown;
	requireApproval?: unknown;
}

function describe(tool: unknown) {
	const t = tool as Described;
	const description = t.description ?? '';
	const parameters = schemaOf(t.inputSchema);
	const schemaChars = parameters === undefined ? 0 : JSON.stringify(parameters).length;

	return {
		id: t.id,
		description,
		descriptionChars: description.length,
		schemaChars,
		/** Name, description and schema together — the whole per-call charge. */
		chars: JSON.stringify(wireEntry(t.id, description, parameters)).length,
		/**
		 * Whether this one pauses for a human before it runs.
		 *
		 * `requireApproval` may be a per-call predicate rather than a flag, so
		 * this reads "can pause", not "will pause every time" — which is the
		 * honest claim and the one the panel makes.
		 */
		approval: Boolean(t.requireApproval)
	};
}

export const GET: RequestHandler = async () => {
	const { tools: research } = createResearchTools();
	const { tools: images } = createImageTools();

	const tools = [...Object.values(research), ...Object.values(images)].map(describe);

	return json({
		tools,
		/** The whole fixed tax, in characters, paid once per provider call. */
		chars: tools.reduce((sum, t) => sum + t.chars, 0),
		/**
		 * The paper-reader subagent is exposed to the model as a tool too, under
		 * `agent-paperReader`, and it is deliberately absent: Mastra mints that
		 * tool's schema at run time from the agent's own description, so it does
		 * not exist to be measured until a run is under way. Saying so in the
		 * payload keeps the omission from reading as an oversight in the panel.
		 */
		delegationCounted: false
	});
};
