import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { SourceRegistry } from '$lib/agent/sources';
import { createResearchWorkflow } from '$lib/agent/research-workflow';

/**
 * The research pipeline's own topology, for the X-ray to draw.
 *
 * This is the seam that makes the graph panel a *reading* rather than a
 * drawing. `serializedStepGraph` is what the engine will execute, so a step
 * added to `research-workflow.ts` appears in the panel with no second edit —
 * and, more to the point, a step *removed* disappears from it. A hand-kept
 * diagram cannot make that promise, and a diagram that is wrong about the
 * pipeline is worse than no diagram at all.
 *
 * Building the workflow is free and, importantly, key-free: `createStep` only
 * records its `execute` closure, and every `model()` call in that file lives
 * inside one. Nothing here makes a network call, spends a token, or needs
 * `OPENAI_API_KEY` to be set — so the graph is legible on a machine that could
 * not run the workflow at all.
 *
 * The registry is fresh per request even though nothing will register into it,
 * because `createResearchWorkflow` takes one and a shared instance across
 * requests is precisely the leak `SourceRegistry` exists to prevent. Handing it
 * a throwaway keeps that rule from acquiring an exception.
 *
 * Gating is `hooks.server.ts`'s job: everything but `/api/cron/` sits behind the
 * session cookie, and an unauthenticated call to this path gets a 401 before
 * the handler runs.
 */
export const GET: RequestHandler = async () => {
	try {
		const workflow = createResearchWorkflow({ registry: new SourceRegistry() });

		return json({
			id: workflow.id,
			description: workflow.description,
			serializedStepGraph: workflow.serializedStepGraph
		});
	} catch (cause) {
		/*
		 * 200 with an `error`, not a 500.
		 *
		 * Same reasoning as `/api/memory`: the panel that shows this must be able
		 * to say *why* it is empty. A 500 gives the client a status and no
		 * sentence, and an empty `serializedStepGraph` with no explanation would
		 * render as "this workflow has no steps" — a confident and wrong claim
		 * about the pipeline, which is the one failure this panel must not have.
		 */
		return json({
			id: null,
			description: null,
			serializedStepGraph: [],
			error: cause instanceof Error ? cause.message : String(cause)
		});
	}
};
