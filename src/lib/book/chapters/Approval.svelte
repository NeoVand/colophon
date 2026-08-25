<div class="co-prose chapter">
	<p class="lead">
		Some tool calls spend real money or do something you cannot take back. Generating an
		illustration is both. So that call pauses and asks — and the interesting part is not the asking,
		it is that the pause has to survive the end of an HTTP request.
	</p>

	<p>
		The run that stopped was streaming into a browser from a serverless function. Your answer
		arrives minutes later in a completely different request, quite possibly on a different instance,
		with no memory of the first. A pause held as a promise in process memory cannot survive that. It
		would work perfectly in development, on one long-lived server, and fail the first time it was
		deployed.
	</p>

	<p>
		What makes it work is that the suspended run is a <strong>snapshot in storage</strong>, keyed by
		a run id. The agent is registered on a framework container that has a database attached, purely
		so that the snapshot has somewhere to live and can be found again from anywhere. Without that
		registration, approving a call fails with "snapshot not found" — a message that sounds like a
		missing file and is actually the whole architectural point.
	</p>

	<h2>The trap worth naming</h2>

	<p>
		Approving returns a <em>new</em> stream: the continuation of the run from the point it stopped. That
		stream must be consumed. If you approve and walk away without draining it, the tool never actually
		executes and the run silently stalls — which is a particularly confusing failure, because the approval
		itself appeared to succeed. Everything on screen says yes and nothing happens.
	</p>

	<p>
		Declining is a first-class path rather than an absence. It resumes the run too, carrying a
		reason the model can see and respond to, so a refused figure becomes something it works around
		instead of a hang.
	</p>

	<h2>Where the decision lives</h2>

	<p>
		The request appears inline, in the conversation, attached to the turn that raised it — not in a
		modal. A dialog covering the transcript would hide the very thing you need in order to judge:
		what was being written, and why this figure was proposed. The decision belongs beside the work
		that prompted it.
	</p>

	<p>
		The agent is also told that calling the tool <em>is</em> the asking. It must never request permission
		in prose first and wait, because that produces the worst of both — a question you have to answer twice,
		once in English and once with a button. The instructions say so explicitly.
	</p>

	<p>
		While a decision is outstanding the run is suspended rather than finished, and the composer
		stays disabled. Going idle would let you type a new message on top of a pending pause, which is
		how a suspended run gets orphaned.
	</p>

	<h2>An honest limitation</h2>

	<p>
		The source registry lives in memory for the duration of one request. A tool that needs the
		registry therefore cannot currently be approved across requests — the snapshot comes back and
		the registry does not. Today only image generation requires approval and it never touches the
		registry, so this is not yet a bug. It becomes one the moment a citation needs a gate, and it is
		written down here rather than discovered then.
	</p>

	<p class="live">
		See it live: <strong>the approval card</strong> in the conversation, in amber, showing the exact arguments
		the tool was called with before you decide. Read the brief, not the promise.
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
	/* Amber: the run is waiting on you. */
	.live strong {
		font-weight: 500;
		color: var(--co-approval);
	}
</style>
