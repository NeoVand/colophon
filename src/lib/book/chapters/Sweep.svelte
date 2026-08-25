<div class="co-prose chapter">
	<p class="lead">
		The sweep is what Colophon does while you are asleep. You name a topic, say in your own words
		why you follow it, and how often you want looking at. Overnight, one run happens per
		subscription: search by recency since the last sweep, read the two or three papers that matter,
		write, and submit the result to the gate. One subscription, one run, one verdict.
	</p>

	<p>
		The verdict is not the same fact as delivery, and keeping them in separate columns took a
		correction. A digest can pass the gate and fail to send because a mail provider was down. That
		is not a failed sweep — the research happened, the writing exists, and calling it a failure
		would un-advance the mark and re-read the whole period tomorrow to produce a digest that already
		exists. So delivery is attempted only after the digest is safely stored, and a provider outage
		costs the email and never the work.
	</p>

	<p>
		Where no mail is configured, delivery is not attempted at all, and the record says so precisely:
		no delivery timestamp and no delivery error is the pair's way of saying "never tried", as
		distinct from "tried and was refused".
	</p>

	<h2>Platform cron, not the framework's scheduler</h2>

	<p>
		Mastra ships a scheduler. It is not used here, and the reason is worth stating because it
		generalises. The scheduler needs a long-lived host — a process that stays up holding timers —
		and serverless does not have one. The framework's durable-agent path wants a separate workflow
		engine alongside it. Neither is available on the free tier this runs on.
	</p>

	<p>
		So the shape is deliberately dull: the platform's cron fires an HTTP route on a schedule, and
		the route runs the sweep. The scheduling lives where the infrastructure already is, and the
		application keeps one less thing that can be running or not running without anybody noticing. If
		a sweep ever outgrows the platform's 300-second function limit, the answer is a workflow whose
		steps each make one bounded call — not a durability layer inside the agent framework.
	</p>

	<p>
		Subscriptions due at the same time are swept one after another rather than together. Three
		concurrent research runs would contend for the same 300 seconds and two gigabytes while making
		provider rate limits considerably more likely. Sequential also degrades better: a run that dies
		halfway leaves the earlier subscriptions correctly swept, rather than all of them half-done.
	</p>

	<h2>Three counts, and one tool withheld</h2>

	<p>
		At the end of a sweep the registry is asked three different questions, and conflating any two of
		them produces a wrong document. What was <em>cited</em> becomes the reference list. What was
		<em>read</em> becomes the honest "four papers read" in the email footer. <em>Everything</em>
		retrieved goes to the library — whether or not the digest ships, because the reading happened and
		forgetting it would mean paying to read the same papers again tomorrow.
	</p>

	<p>
		The sweep agent is also given one tool fewer than the interactive one: it cannot call
		<code>bibliography</code>. References are appended by the system afterwards, so a tool that
		produces a second, differently formatted list has nothing to contribute and one obvious way to
		do harm. Telling a model not to call a tool it has is advice. Not giving it the tool is the same
		kind of guarantee the citation refusal makes, and this codebase prefers that kind.
	</p>

	<p>
		A real overnight sweep takes about seventy-five seconds end to end, which is the whole point:
		nobody is waiting on it.
	</p>

	<p class="live">
		See it live: <strong>the vault's subscription column</strong> — what is being followed, when each
		was last swept, and the run of verdicts underneath. Four withheld digests in a row is either a quiet
		field or a query that needs rewriting, and you cannot tell which from either column alone.
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
	.live strong {
		font-weight: 500;
		color: var(--co-accent);
	}
</style>
