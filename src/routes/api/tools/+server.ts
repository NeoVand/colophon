import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { createColophon } from '$lib/agent/colophon';

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
 * ── Asked of the agent, not assembled from its parts ────────────────────────
 * This used to call the tool factories directly and add up what they returned,
 * and it was wrong in two directions at once. It imported `createWritingTools`
 * and never called it, so `present_outline` and `stylize_figure` — long
 * descriptions, sent every call — were missing entirely. And it could not see
 * the tools Mastra *mints*: `agent-paperReader` for the subagent, and `skill` /
 * `skill_read` / `skill_search` once the agent has skills. The panel declared
 * the first of those uncountable and was silent about the rest.
 *
 * It builds the real agent and asks `getToolsForExecution()` now, which returns
 * the tools already converted to the shape that goes on the wire — `{ type,
 * description, parameters, strict }`. So the number below is no longer a
 * reconstruction that has to be kept in step with the sender; it is the sender's
 * own object, measured. Add a tool, a skill or a subagent and this changes with
 * no edit here.
 *
 * Building the agent is cheap and safe: factories and closures, nothing touching
 * the network or the provider until a tool actually executes. The source
 * registry it mints is thrown away with the request.
 *
 * No auth check: `hooks.server.ts` gates every route but the login page.
 */

/**
 * What one tool costs on every request.
 *
 * `getToolsForExecution()` hands back the converted tool, so the fields below
 * are the provider's own — `parameters` is the JSON Schema that will be sent,
 * not a second conversion of the zod type that might disagree with it. The
 * entry is rebuilt rather than stringified whole because the live object also
 * carries `execute`, hooks and internals that never leave the process.
 *
 * `context.ts` bills exactly this shape when it decomposes a captured request,
 * which is what lets this panel and the context panel agree. Where they still
 * disagree, the context panel is right: it reads the bytes.
 */
interface Sent {
	type?: string;
	description?: string;
	parameters?: unknown;
	strict?: boolean;
	requireApproval?: unknown;
	needsApprovalFn?: unknown;
}

function describe(id: string, tool: Sent) {
	const description = tool.description ?? '';
	const parameters = tool.parameters;
	const wire = {
		type: tool.type ?? 'function',
		name: id,
		description,
		parameters,
		strict: Boolean(tool.strict)
	};

	return {
		id,
		description,
		descriptionChars: description.length,
		schemaChars: parameters === undefined ? 0 : JSON.stringify(parameters).length,
		/** Name, description and schema together — the whole per-call charge. */
		chars: JSON.stringify(wire).length,
		/**
		 * Whether this one pauses for a human before it runs.
		 *
		 * Either a flag or a per-call predicate, so this reads "can pause", not
		 * "will pause every time" — which is the honest claim and the one the
		 * panel makes.
		 */
		approval: Boolean(tool.requireApproval) || Boolean(tool.needsApprovalFn)
	};
}

export const GET: RequestHandler = async () => {
	const { agent } = (await createColophon()) as unknown as {
		agent: {
			getToolsForExecution(c: object): Promise<Record<string, Sent>>;
			listAgents(): Promise<Record<string, unknown>>;
			listSkills(): Promise<unknown[]>;
		};
	};

	/*
	 * `getToolsForExecution` is Mastra's own send-time assembly. `listTools()`
	 * would return only what was *assigned* — the eight built-ins — and miss the
	 * four the framework adds, which are as real a charge as any of ours.
	 */
	const sent = await agent.getToolsForExecution({});

	const tools = Object.entries(sent)
		.map(([id, tool]) => describe(id, tool))
		.sort((a, b) => b.chars - a.chars);

	/*
	 * Counts for the opening screen, from the same object the table came from.
	 *
	 * They were three literals in `Preamble.svelte` with a comment promising
	 * "a wrong number on the opening screen is worse than no number at all" —
	 * and by the time anyone looked, it said five tools when there were twelve
	 * and two skills when the agent had none attached at all. Derived here, the
	 * promise is kept by construction rather than by remembering to grep.
	 *
	 * `tools` counts what the model is shown, minus the delegation, because that
	 * is counted on its own line as a subagent and counting it twice is exactly
	 * the sort of small dishonesty this endpoint exists to remove.
	 */
	const subagents = Object.keys(await agent.listAgents()).length;
	const skills = (await agent.listSkills()).length;

	return json({
		tools,
		/** The whole fixed tax, in characters, paid once per provider call. */
		chars: tools.reduce((sum, t) => sum + t.chars, 0),
		counts: {
			tools: tools.filter((t) => !t.id.startsWith('agent-')).length,
			subagents,
			skills
		}
	});
};
