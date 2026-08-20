<div class="co-prose chapter">
	<p class="lead">
		A token total tells you what a turn cost. It does not tell you what you bought. The context
		panel takes the outgoing request apart and answers the second question: how much of this window
		is the system prompt, how much is tool schemas nothing on this turn will use, and how much is
		one paper's excerpt sitting in the history being re-sent on every call for the rest of the
		conversation.
	</p>

	<p>
		That last one is the reason the panel exists. It is the most expensive mistake an agent can make
		and it is completely invisible from a chat window, where a turn that costs forty times what it
		should looks exactly like a turn that does not.
	</p>

	<h2>Read off the wire, not out of the documentation</h2>

	<p>
		The shape of a request is not documented anywhere useful: it depends on the SDK version, on the
		provider choosing one API surface over another, and on how the framework assembles instructions.
		So it was captured from a live run and read. Five kinds of item actually appear — the assembled
		system prompt as a developer message, what you typed, the model's function calls, the results
		that came back, and a reference to the model's reasoning.
	</p>

	<p>
		Anything unrecognised is reported as <code>other</code> rather than dropped, because an unknown item
		still occupies the window and silently omitting it would make the bands add up to less than the request.
		A panel that understates what was sent is worse than no panel.
	</p>

	<h2>Reasoning is sent by reference</h2>

	<p>
		The find that cost nothing and is worth knowing: the provider's reasoning is
		<strong>not re-sent</strong>. It stays server-side, and what travels in the next request is a
		fourteen-byte identifier standing in for the whole chain of thought. A long deliberation is not
		re-billed on every subsequent call the way the conversation is. An X-ray that drew reasoning as
		a fat band would be inventing a cost — so the reference is kept as its own row precisely so that
		its smallness is something you can see.
	</p>

	<h2>Schemas are a fixed tax</h2>

	<p>
		Tool schemas are listed first because they are constant across a turn and are the thing most
		often forgotten. Eight tools with rich descriptions is a fixed charge on every single call, paid
		whether or not any of them is used. It is the cheapest line in the bill to reduce and the one
		nobody looks at.
	</p>

	<p>
		The measured case that changed the code: one research turn made four searches on near-identical
		queries. The panel showed five search-result rows of about 14,000 tokens each — 48% of a
		138,000-token request — for 25 distinct papers spread across 32 result rows. Seven of those rows
		were the same papers described a second and third time, and every repeat stayed in the window
		for every remaining call of the turn. Caching softened it; that turn was 92% cached. But a
		cached token is not a free token, and 141 kilobytes on the wire at every step is latency nobody
		is caching away. Hence the rule from the retrieval chapter: a paper met before comes back
		without its abstract.
	</p>

	<p>
		One honest limitation. The provider bills a single number for the whole request, so each row's
		token figure is its share of that total by character count, not a measurement. A JSON schema
		tokenises differently from English prose, which overstates a schema-heavy row and understates a
		prose-heavy one. It is still the right trade: the question anyone actually has is which half of
		this bill is the conversation and which half is the tooling, and a proportional split answers
		that correctly even when a row is off by a fifth.
	</p>

	<p class="live">
		See it live: <strong>the context panel</strong>. The header names which call it is showing — one
		request, not the turn's running total, because apportioning a turn's cumulative tokens across a
		single request's bands inflates every row, and this panel shipped exactly that bug once.
	</p>
</div>

<style>
	.lead {
		font-size: 1.1875rem;
		line-height: 1.55;
	}

	.live {
		margin-top: 1.75rem;
		padding-top: 0.8rem;
		border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
		font-family: var(--font-mono);
		font-size: 0.75rem;
		line-height: 1.65;
		color: var(--muted-foreground);
	}
	/* Teal: the model speaking, and this chapter is what the model is sent. */
	.live strong {
		font-weight: 500;
		color: var(--co-model);
	}
</style>
