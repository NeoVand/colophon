import type { RequestHandler } from './$types';
import { createColophon } from '$lib/agent/colophon';
import type { Outline } from '$lib/agent/writing-tools';
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

	const { runId, toolCallId, approve, reason, edited } = (await request.json()) as {
		runId?: string;
		toolCallId?: string;
		approve?: boolean;
		reason?: string;
		edited?: Outline;
	};
	if (!runId || !toolCallId) error(400, 'runId and toolCallId are required.');

	/*
	 * The edited outline is handed to the agent at construction, not to
	 * `approveToolCall()`.
	 *
	 * That is not a preference — `approveToolCall({ runId, toolCallId })` accepts
	 * no argument override, so a resumed call executes with whatever the model
	 * originally wrote. The only place a reader's rewrite can win is inside the
	 * tool, which reads it from the closure this builds.
	 */
	const { agent } = createColophon({ editedOutline: edited });
	const encoder = new TextEncoder();

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			let open = true;
			/*
			 * Same guard as the two sibling stream routes, for a smaller reason.
			 *
			 * There is no heartbeat here, so no timer can throw into an empty stack
			 * and kill the process. But a reader who navigates away mid-approval
			 * still closes the controller under a running `for await`, and the
			 * throw from the next `send` would land in the `catch` below, whose
			 * first act is another `send` that throws again. That is a broken
			 * response dressed as an error report. Latching `open` on the first
			 * failure ends it quietly instead.
			 */
			const send = (event: string, data: unknown) => {
				if (!open) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					open = false;
				}
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
				try {
					controller.close();
				} catch {
					// Already torn down by the reader leaving. Nothing to close.
				}
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
