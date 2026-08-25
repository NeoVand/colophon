<div class="co-prose chapter">
	<p class="lead">
		Some jobs are expensive to read and cheap to summarise. A paper is 40 to 200 kilobytes — ten to
		fifty thousand tokens — and what anybody actually needs from it is a page of notes. Read it in
		the main conversation and you pay for the whole thing again on every turn that follows, because
		a tool result stays in the transcript forever.
	</p>

	<p>
		The fix is a second agent. The <em>paper-reader</em> runs its own loop, in its own context window,
		with its own instructions, and returns only its final reply. Everything it read, every section it
		skimmed past, every dead end, stays in that window and is discarded along with it. The parent pays
		once, for the notes.
	</p>

	<p>
		That asymmetry is the entire justification, and the code states it in two numbers. The parent's
		<code>fetch_paper</code> is capped at 24,000 characters of a paper — roughly six thousand tokens —
		because whatever it reads is re-sent on every subsequent call of the turn. The reader's is capped
		at 200,000, because its window is thrown away. The reader can afford a whole paper precisely because
		nobody will ever pay for it twice.
	</p>

	<h2>The reply contract</h2>

	<p>
		A subagent is only worth having if what comes back is small, and "small" has to be stated rather
		than hoped for. The reader is given a shape and a hard ceiling of 250 words: what the paper
		claims, how it was tested, the numbers that matter, the limitations the authors flag plus any
		they do not, and one sentence on whether a practitioner should care. No preamble, no restating
		the title, no announcing that it read the paper.
	</p>

	<p>
		Without that, delegation is theatre. A subagent that answers "here is everything I found" has
		<em>moved</em> the cost, not removed it — the parent now pays for the same tokens under a different
		heading, and has lost the ability to see where they went.
	</p>

	<p>
		Its tools are cut to the contract as well: <code>fetch_paper</code> and nothing else. No search,
		because it is handed an identifier. No <code>cite</code>, because it reports notes and not
		references. An agent whose job is "notes on one paper" should not be able to wander off into
		retrieval, and the reliable way to prevent that is not to give it the map.
	</p>

	<h2>What crosses the boundary</h2>

	<p>
		The interesting part is what the reader is <em>not</em> given: its own registry. It shares the
		run's one. So when it fetches a paper, that paper is promoted to depth <code>read</code> in the registry
		the parent is holding — and the parent can afterwards cite it for a claim about its contents, despite
		never having seen a word of the text.
	</p>

	<p>
		Provenance survives the delegation; the tokens do not. That sentence is the whole design. The
		expensive thing stays on the far side of the boundary and the fact worth keeping comes back
		across it, and the guarantee from the previous chapter is not weakened by the saving.
	</p>

	<p>
		Several readers can run at once, because they share nothing but that registry and each one is
		mostly waiting on a network fetch. In the deep-research pipeline they are dispatched together
		and joined afterwards, so reading four papers costs about as long as reading the slowest one. A
		paper whose full-text edition is missing fails alone rather than taking the review down with it.
	</p>

	<p class="live">
		See it live: <strong>the events panel</strong>, where a delegation appears under the subagent's
		own name rather than as the tool call that carried it — what happened is "a paper was read in
		its own window", not "a function was invoked".
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
	/* A reader in its own window. */
	.live strong {
		font-weight: 500;
		color: var(--co-subagent);
	}
</style>
