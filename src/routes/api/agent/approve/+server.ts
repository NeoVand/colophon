import type { RequestHandler } from './$types';
import { createColophon } from '$lib/agent/colophon';
import { isModelConfigured } from '$lib/server/model';
import { project } from '$lib/agent/events';
import { error } from '@sveltejs/kit';

/**
 * Approving — or declining — a paused tool call.
 *
 * The pause happened in an earlier request, on a serverless instance that no
 * longer exists. What makes this possible at all is that the suspended run is
 * a *snapshot in storage*, keyed by `runId`, rather than a promise held in
 * memory: the agent registered on a Mastra instance with storage can find it
 * again from anywhere. See CLAUDE.md.
 *
 * ── The stream you must consume ─────────────────────────────────────────────
 * `approveToolCall()` returns a NEW stream — the continuation of the run from
 * the point it paused. Not consuming it means the tool never actually executes
 * and the run silently stalls, which is a particularly confusing failure
 * because the approval itself appeared to succeed.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!isModelConfigured()) error(503, 'OPENAI_API_KEY is not configured on the server.');

	const { runId, toolCallId, approve, reason } = (await request.json()) as {
		runId?: string;
		toolCallId?: string;
		approve?: boolean;
		reason?: string;
	};
	if (!runId || !toolCallId) error(400, 'runId and toolCallId are required.');

	const { agent } = createColophon({});
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let open = true;
			const send = (event: string, data: unknown) => {
				if (!open) return;
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			};

			try {
				send('ready', { at: Date.now() });

				if (approve === false) {
					await agent.declineToolCall({
						runId,
						toolCallId,
						reason: reason ?? 'The reader declined.'
					});
					send('event', { k: 'declined', id: toolCallId });
					send('done', { at: Date.now() });
					return;
				}

				const continuation = await agent.approveToolCall({ runId, toolCallId });

				// The continuation must be drained, or the approved tool never runs.
				for await (const chunk of continuation.fullStream) {
					const projected = project(chunk);
					if (projected) send('event', projected);
				}

				send('done', { at: Date.now() });
			} catch (cause) {
				send('failed', {
					message: cause instanceof Error ? cause.message : String(cause)
				});
			} finally {
				open = false;
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
