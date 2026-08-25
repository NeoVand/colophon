import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';
import { SourceRegistry } from '$lib/agent/sources';
import { createResearchWorkflow } from '$lib/agent/research-workflow';

/**
 * The workflow's own topology, as the engine holds it.
 *
 * Same discipline as `/lab/capture`: the shape of `serializedStepGraph` is not
 * documented, so this prints it rather than letting a graph renderer be written
 * against a guess. Free — building a workflow makes no network call and runs no
 * step.
 *
 * A throwaway workflow using `.parallel()` and `.branch()` lived here briefly,
 * purely to find out what those serialise to — the linear pipeline cannot show
 * it. It did its job and left: the three entry shapes it revealed are now
 * fixtures in `topology.spec.ts`, which is where a one-time instrument's
 * findings belong once they are known.
 *
 * Dev only, purely to keep the lab surface out of production.
 */
export const GET: RequestHandler = async () => {
	if (!dev) error(404, 'Not found.');

	const workflow = createResearchWorkflow({ registry: new SourceRegistry() });

	return json({
		id: workflow.id,
		description: workflow.description,
		stepIds: Object.keys(workflow.steps ?? {}),
		serializedStepGraph: workflow.serializedStepGraph
	});
};
