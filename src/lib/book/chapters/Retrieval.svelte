<div class="co-prose chapter">
	<p class="lead">
		A search tells you what exists. Only reading tells you what a paper found. Colophon keeps those
		two facts apart everywhere, and the shape of its retrieval falls out of the split: search
		broadly, cheaply, from several angles at once — then open the two or three papers that would
		change the answer.
	</p>

	<p>Searching means two services, because they know different things.</p>

	<ul>
		<li>
			<strong>arXiv</strong> knows what appeared this morning. Its API has real category and date filtering,
			and its listings go live within hours of posting, which is exactly what a daily sweep needs.
		</li>
		<li>
			<strong>OpenAlex</strong> knows what matters. Citation counts, resolved author names, DOIs, and
			an index reaching far beyond preprints — but it lags days to weeks on new arXiv postings, which
			makes it the wrong first stop for "what is new" and the right one for "what is important".
		</li>
	</ul>

	<p>
		Neither is a superset of the other, and asking one of them the other's question produces answers
		that look fine and are quietly wrong. The citation count of a paper posted three days ago is
		zero. A "most recent" list from an index that lags is last month's news with today's date on it.
	</p>

	<h2>The bug in the middle of it</h2>

	<p>
		arXiv's API defaults a multi-term query to <strong>OR</strong>. Ask it for
		<code>all:mechanistic interpretability</code> and it returns papers about mechanics
		<em>or</em> about interpretability — which in practice means neither, because the union is dominated
		by whichever term is commoner in the corpus. Nothing in the response announces this. The results are
		plausible, vaguely on topic, and useless.
	</p>

	<p>
		It was caught by running a live query and reading the reply rather than trusting the request.
		arXiv echoes its own interpretation in the Atom feed's title, and the title came back saying
		<code>all:mechanistic OR all:interpretability</code>. That is the kind of bug that survives
		review forever: the code looks right, the results look like results, and the only witness is a
		field nobody reads.
	</p>

	<p>
		So every term is ANDed before the query leaves — unless the query already carries a field prefix
		like <code>ti:</code> or <code>au:</code>, or a boolean of its own, in which case whoever wrote
		it meant it and it passes through untouched. The deep-research pipeline's scoping step is told
		the same fact in its own instructions: arXiv ANDs the terms, so keep each query to the three or
		four words that matter. A long query plus an AND is a query that returns nothing at all.
	</p>

	<h2>Server-side, which was half the point</h2>

	<p>
		The sibling project could only ever use OpenAlex, because arXiv's API sends no CORS header and
		the browser refuses the response. Moving retrieval to the server removed the limit entirely —
		the first dividend of the move, and a standing reminder that "the API does not support this" is
		often "the API does not support this <em>from a browser</em>".
	</p>

	<p>
		One economy lives here too. A paper that an earlier search in the same run already returned
		comes back marked <code>seen</code>, carrying its title and no abstract. That is not
		concealment: the full abstract is sitting earlier in the very same context window, which is
		precisely why sending it a second time buys nothing. The ranking of the new search stays
		readable, and the window is several thousand tokens lighter for the rest of the turn.
	</p>

	<p>
		Everything found is registered on the way past, whether or not it is ever opened or mentioned.
		Searching is how a paper becomes citable at all; the next chapter is about why that matters more
		than it sounds.
	</p>

	<p class="live">
		See it live: <strong>the events panel</strong>, where every
		<code>search_papers</code> call shows the query it actually sent and the count that came back — and
		the library panel below it, filling as the results land.
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
	/* Ochre: the legend colour for retrieval, and this chapter is retrieval. */
	.live strong {
		font-weight: 500;
		color: var(--co-tool);
	}
</style>
