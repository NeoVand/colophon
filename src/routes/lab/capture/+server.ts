import type { RequestHandler } from './$types';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { model } from '$lib/server/model';
import { createCapture } from '$lib/agent/capture';
import { error, json } from '@sveltejs/kit';
import { dev } from '$app/environment';

/**
 * What actually goes on the wire.
 *
 * Written to be read once and then referred to: the context panel has to
 * decompose a provider request body, and the shape of that body is not
 * documented anywhere — it depends on the AI SDK version, on whether the
 * provider uses the Responses or Chat Completions API, and on how Mastra
 * assembles instructions and tools. Guessing it produced a silently empty
 * library panel earlier in this project, so this exists to make guessing
 * unnecessary.
 *
 * One tiny call with one tiny tool, so the answer costs a fraction of a cent.
 * `?full` returns the whole body; the default returns its skeleton — keys, types
 * and lengths — which is what you actually need to write a decomposer.
 *
 * Dev only. It sends a real request and would otherwise be an open, if very
 * cheap, way to spend someone else's money.
 */

export const GET: RequestHandler = async ({ url }) => {
	if (!dev) error(404, 'Not found.');

	const capture = createCapture();

	const agent = new Agent({
		id: 'capture-probe',
		name: 'Probe',
		instructions: 'You are a probe. Answer in one word.',
		model: model(undefined, capture.fetch),
		tools: {
			ping: createTool({
				id: 'ping',
				description: 'A tool that exists only so a tool schema appears on the wire.',
				inputSchema: z.object({ note: z.string().describe('Anything.') }),
				execute: async () => ({ pong: true })
			})
		}
	});

	// `?tool` forces a second round trip, so the captured body contains the
	// function_call and function_call_output items a real research turn is full
	// of — the item types a decomposer has to handle and cannot see otherwise.
	await agent.generate(
		url.searchParams.has('tool')
			? 'Call the ping tool with note "hi", then say done.'
			: 'Say the word blue.'
	);

	const latest = capture.latest();
	if (!latest?.body) error(500, 'Nothing was captured — the fetch seam is not wired.');

	if (url.searchParams.has('full')) return json(latest);

	return json({
		url: latest.url,
		bytes: latest.bytes,
		status: latest.status,
		ms: latest.ms,
		calls: capture.requests.length,
		skeleton: skeleton(latest.body)
	});
};

/**
 * Keys, types and sizes — never values.
 *
 * A full request body is mostly prose and JSON schemas; printed whole it is
 * thousands of lines you have to read to find out that `tools` is an array of
 * objects with four keys. This shows the structure at a glance and elides
 * anything long, so the answer fits on a screen.
 */
function skeleton(value: unknown, depth = 0): unknown {
	if (value === null) return null;
	if (typeof value === 'string') {
		return value.length > 60 ? `<string ${value.length}>` : value;
	}
	if (typeof value !== 'object') return typeof value === 'number' ? value : typeof value;

	if (Array.isArray(value)) {
		if (!value.length) return [];
		/*
		 * One representative per *distinct* shape, not just the first element.
		 *
		 * Showing element zero is the obvious version and it is blind in the one
		 * case that matters: a Responses-API `input` array is a developer message
		 * followed by user messages, function_call items and function_call_output
		 * items, and the first element tells you about none of them. This groups
		 * by the keys present (plus `type`/`role` when there is one) so every kind
		 * of item in the array appears exactly once.
		 */
		const shapes = new Map<string, unknown>();
		for (const item of value) {
			const o = item as Record<string, unknown> | null;
			const key =
				o && typeof o === 'object'
					? `${o.type ?? o.role ?? ''}|${Object.keys(o).sort().join(',')}`
					: typeof item;
			if (!shapes.has(key)) shapes.set(key, skeleton(item, depth + 1));
		}
		return [...shapes.values(), `…${value.length} items, ${shapes.size} distinct shapes`];
	}

	if (depth > 4) return '<object>';
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, skeleton(v, depth + 1)])
	);
}
