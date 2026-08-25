<div class="co-prose chapter">
	<p class="lead">
		A chat agent is one loop that decides everything for itself. That is the right shape for a
		conversation and the wrong shape for a question worth an hour — one that should be answered the
		same way every time, with the expensive part parallelised and every stage open to inspection.
		For that, deep research is written out as a pipeline.
	</p>

	<p>Five steps, each handing the next a stated shape.</p>

	<ul>
		<li>
			<strong>Scope.</strong> Turn the question into one to four searches that are genuinely different
			angles — different subfields, different vocabulary — rather than the same query with the words moved
			around, which returns the same papers at the same price.
		</li>
		<li>
			<strong>Search.</strong> Run them concurrently, pool the results, and dedupe. Handing the next step
			the same paper three times invites it to conclude that three papers agree.
		</li>
		<li>
			<strong>Select.</strong> Choose the two or three worth a whole context window each, and prefer a
			paper that disagrees with the others over a fourth that agrees.
		</li>
		<li>
			<strong>Read.</strong> Dispatch one paper-reader per selection, all at once, and wait for them all.
		</li>
		<li>
			<strong>Write.</strong> Compose the answer from the notes, verifying every reference through the
			citation tool as it goes.
		</li>
	</ul>

	<h2>Three things a longer prompt cannot give you</h2>

	<p>
		<strong>Structure you can draw.</strong> A workflow has a step graph, and the engine publishes the
		serialised version of it. The graph in the X-ray is read from that — not a diagram anybody authored,
		but the topology that will actually execute. A picture you maintain by hand is a claim; this is a
		reading, and it cannot drift away from the code.
	</p>

	<p>
		<strong>Real parallelism.</strong> Four readers at once with a barrier after them is something the
		pipeline expresses, not something a model is asked nicely to attempt. And it fails well: a paper whose
		full-text edition is missing drops out on its own rather than taking the review down with it.
	</p>

	<p>
		<strong>A place to stop.</strong> Steps can suspend and resume, so a gate between "here is what I
		plan to read" and "go ahead" becomes a property of the pipeline instead of a special case bolted onto
		a chat turn. The graph marks which steps can do this, so you can see where a run is able to pause
		before it ever runs.
	</p>

	<h2>What is threaded through</h2>

	<p>
		One source registry is shared by every step, for exactly the reason the chat agent shares one
		with its subagent: the writing step must be able to cite a paper that only a reading step ever
		saw. Provenance crosses the step boundary; the text does not. That single object is what lets a
		five-stage pipeline still end with references that are provably the papers consulted.
	</p>

	<p>
		The writing step is given one tool and one only — the citation tool. The reading is finished by
		then, and handing it search would let it wander back out into retrieval, spending another window
		on papers nobody selected. Narrow tools are how a stage is kept to its job; it is the same
		discipline the paper-reader is held to, applied to a step instead of an agent.
	</p>

	<p>
		The step boundaries are also where the answers get their shapes. Scope returns queries and an
		angle; select returns identifiers and one sentence on why these and not the others. Those
		schemas are the contract between stages, and they are the reason a pipeline can be reasoned
		about at all while a single long prompt can only be re-read.
	</p>

	<p class="live">
		See it live: <strong>the graph panel</strong>, drawn from the engine's own step graph and lit as
		each stage commits. Change the pipeline and the drawing changes with it, because nobody drew it.
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
