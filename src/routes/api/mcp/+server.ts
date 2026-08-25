import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { isMcpConfigured, listTools, mcpConfigError } from '$lib/server/mcp';

/**
 * What the agent can reach that this repository does not contain.
 *
 * Answered on request rather than folded into the run stream, because the
 * answer is a property of the deployment and not of any conversation: the same
 * servers are there before the first message and after the last one. The panel
 * asks on mount and when the reader asks it to recheck — a connection can drop,
 * and a list that cannot be refreshed is a screenshot.
 *
 * Three states, kept distinct on the wire because they mean different things:
 *
 *   configured: false, no error   nothing is set up. The normal state.
 *   configured: false, error      MCP_SERVERS is set and unreadable.
 *   configured: true              servers were named; each says for itself
 *                                 whether it answered.
 *
 * Collapsing the middle one into the first is the tempting bug: a typo in an
 * environment variable would then look exactly like a deliberate choice not to
 * use MCP, and nobody would ever find it.
 *
 * No auth check here: `hooks.server.ts` gates every route but the login page,
 * so anything reaching this handler is already signed in.
 */
export const GET: RequestHandler = async () => {
	const error = mcpConfigError();

	if (!isMcpConfigured()) {
		return json({ configured: false, error: error ?? null, servers: [] });
	}

	// `listTools` never throws — an unreachable server comes back as a row with
	// an error on it. That is deliberate: one dead server must not turn the
	// whole panel into a stack trace, and it must not vanish either.
	const servers = await listTools();

	return json({ configured: true, error: error ?? null, servers });
};
