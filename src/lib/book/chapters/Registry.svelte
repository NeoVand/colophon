<div class="co-prose chapter">
	<p class="lead">
		A language model asked to write a review with references will produce plausible ones whether or
		not it read anything. No amount of stern prompting reliably stops this. So Colophon does not ask
		it to behave — it makes the alternative unavailable.
	</p>

	<p>
		Every run holds a <em>source registry</em>. A paper enters it by one route only: arriving over
		the network, from a search or a fetch. The <code>cite</code> tool resolves against that registry and
		refuses anything it does not find. There is no path from "the model believes this paper exists" to
		"a citation appears in the document", and the refusal is a thrown error rather than a warning — it
		comes back as a tool failure the model has to answer, not as advice it can decline.
	</p>

	<p>
		The registry is per run, deliberately not global. Two conversations happening at once must not
		be able to cite each other's papers, and a fresh run has to start out unable to cite anything at
		all. Building it inside the tool factory rather than at module scope is what makes that
		structural instead of a convention someone has to remember.
	</p>

	<h2>Listed is not read</h2>

	<p>
		The registry also draws a line the model cannot see for itself. A search returns titles and
		abstracts. That is enough to decide what to open, and it is not enough to make a claim about
		what a paper contains. So every source carries a depth — <code>listed</code> or
		<code>read</code> — and depth only ever increases. A paper that was read and later reappears in a
		search result has not become less known.
	</p>

	<p>
		<code>cite</code> can be asked to insist on <code>read</code>, and by default it does. That is
		what turns "I saw this in a result list" from a footnote into a refusal.
	</p>

	<h2>Two refusals, and why they differ</h2>

	<p>
		They are separate errors with separate messages, because they are separate mistakes and they
		deserve different corrections.
	</p>

	<ul>
		<li>
			<strong>Never entered this run.</strong> The model is about to invent a reference. The message says
			so, lists what has actually been retrieved, and tells it to search first. This is hallucination
			caught at the door.
		</li>
		<li>
			<strong>Seen in a search but never opened.</strong> The model retrieved something real and is now
			describing contents it has only met as an abstract. The message asks it to fetch the paper, or to
			attribute the claim to the abstract in so many words. This is overreach, not fabrication, and telling
			a writer to "search first" here would be wrong advice.
		</li>
	</ul>

	<p>
		Against that strictness sits one deliberate looseness. Matching an identifier is generous —
		versioned arXiv ids, bare ids, full URLs, DOIs, any casing — because being strict about
		<em>identity</em> produces refusals that read as the tool malfunctioning, and a model that concludes
		the citation tool is broken stops citing rather than starts citing honestly. Generous about which
		paper you mean; unmoved about whether it exists.
	</p>

	<h2>The reference list is not written by the model</h2>

	<p>
		A bibliography is a pure function of what was cited, and the registry already knows exactly what
		was cited, in order. So the model writes the argument and the system appends the references.
		They cannot then disagree, duplicate each other, or leak internal bookkeeping into the prose —
		all three of which happened in a real digest before this existed, which ended with the model's
		own hand-written reference list followed by a second one carrying fields like "(read) via
		search_papers" for the reader to puzzle over.
	</p>

	<p>
		The list is built from what was <em>cited</em>, not from what was read. Built from what was read
		it silently omitted a paper the prose had attributed to Lee et al. from its abstract — correctly
		attributed, honestly qualified, and missing from the references underneath.
	</p>

	<p class="live">
		See it live: <strong>the library panel</strong>. Three states of one mark — seen, read, cited —
		and a promotion rises to the top of the list as it happens. Twenty seen and one read is a run
		that was properly selective; twenty read and one cited is a run that spent a great deal to say
		very little.
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
	/* Sage: papers, and how well they are known. */
	.live strong {
		font-weight: 500;
		color: var(--co-library);
	}
</style>
