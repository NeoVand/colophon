<div class="co-prose chapter">
	<p class="lead">
		An agent that mails you something every morning whether or not it has anything to say is a
		newsletter you will mute inside a week. One that stays quiet for four days and then sends
		something genuinely worth reading is a tool you keep for years. The difference between those two
		products is a single component, and it is the most important behaviour in this application.
	</p>

	<p>
		Every digest the sweep writes is judged before it is sent. The judge is a small separate model
		call, not the writer reviewing itself, because an agent asked whether its own draft is good says
		yes. The judge sees the text and the rubric and nothing else — not the effort that went into
		producing it, which is exactly the sunk cost that should not count.
	</p>

	<p>
		The rubric is written as a list of things that are <em>not</em> enough, because the failure mode is
		a digest that is accurate and pointless. Not enough: a list of what was published, restated abstracts,
		"interest in this area continues to grow", a single incremental result with no consequence. Enough:
		a result that changes what a practitioner would do, a genuine disagreement between papers, or an answer
		to a question the reader is already holding. A thin week is a real outcome, and staying quiet is the
		correct response to one.
	</p>

	<h2>A scorer measures; a processor refuses</h2>

	<p>
		The obvious construction is a scorer — score the draft, send if it clears the bar. It does not
		work, and this is the most misread thing in the framework. <strong
			>Mastra scorers record a score; they do not block a result.</strong
		> They run after the fact, asynchronously, attach a number, and change nothing about what reaches
		the reader. The documentation reads as though attaching scorers to an agent gates its output. It does
		not, and that was established here by compiling the documentation's own examples against the installed
		package rather than by reading them.
	</p>

	<p>
		What actually stops a result is an output processor calling <code>abort()</code>. That raises a
		tripwire, which surfaces as an event the caller can see and act on. The refusal is structural
		rather than advisory — the same move the citation tool makes, in a different part of the
		pipeline.
	</p>

	<p>
		So both exist, doing different jobs. The gate is a processor and refuses. Alongside it sit
		scorers that attach numbers to every draft, sent or withheld, and change nothing at all. You
		need both, for a reason that is easy to miss: the gate is a model judging prose, so its verdicts
		are the one thing in the system you cannot check by reading the gate's own output. The scorers
		are deterministic text arithmetic — no judge, no model call, the same draft always scoring the
		same — which gives the verdicts something external to be plotted against. A week of withheld
		drafts that all scored well is a gate that has drifted strict. A week of sent drafts scoring
		badly is a bar set too low. Neither is visible from either mechanism alone.
	</p>

	<h2>Rejections are kept</h2>

	<p>
		A withheld digest is written to the database with the reason it was withheld, and the
		subscription is marked swept exactly as if it had been sent. Both of those are deliberate. A
		gate whose rejections vanish cannot be tuned — you cannot tell a quiet week from an over-strict
		judge without the rejected drafts and their reasons in front of you. And a period that was
		genuinely examined has been examined; not advancing the mark would make tomorrow re-read the
		same papers and reach the same verdict.
	</p>

	<p>
		The gate's colour in the legend is violet rather than red, on purpose. Red would say something
		went wrong. Nothing went wrong: the gate staying quiet on a thin week is the product working.
	</p>

	<p class="live">
		See it live: <strong>the vault's digest column</strong>, where a withheld digest is shown
		exactly as prominently as a sent one, with the judge's one-sentence reason underneath it.
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
	/* Violet: the gate withheld something. Not red — see the closing paragraph. */
	.live strong {
		font-weight: 500;
		color: var(--co-gate);
	}
</style>
