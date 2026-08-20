<div class="co-prose chapter">
	<p class="lead">
		A conversation is a sitting. What you care about is not. The single most useful thing Colophon
		can know — which fields you follow, what can be assumed known, what question you have been
		turning over for a month — is exactly the thing that a per-conversation memory throws away every
		time you start a new one.
	</p>

	<p>
		So the working memory here is <strong>resource-scoped</strong> rather than thread-scoped. In Mastra
		those are the two settings, and the difference is a lifetime. Thread-scoped memory belongs to one
		conversation and dies with it. Resource-scoped memory belongs to the reader, and every thread that
		reader opens is handed it again. Colophon has exactly one reader, so there is exactly one profile,
		and it accumulates.
	</p>

	<p>
		That it outlives the thread is not a convenience. It is the feature. "What changed since I last
		looked at this" is unanswerable unless something remembers what you last looked at — and the
		question a research companion exists to answer is precisely that one.
	</p>

	<h2>A template, not a scratchpad</h2>

	<p>
		The memory is a markdown document with headings the system supplies: fields followed, and how
		closely to track each; background, so a review pitches at the right level rather than explaining
		attention from first principles every week; preferences about length and tone; and standing
		questions — open threads to watch for answers to.
	</p>

	<p>
		Headings matter more than they look. A freeform memo drifts into a transcript of the last
		conversation, which is both large and useless. A template makes updating it an act of filing:
		this new fact is a preference, or it is a standing question, or it is nothing and does not go
		in. The empty sections are also a prompt in themselves — a heading with nothing under it is a
		question the agent has not asked you yet.
	</p>

	<h2>What it costs, and where it shows up</h2>

	<p>
		Memory is not free and it is not invisible. It arrives in the outgoing request as a
		<em>second</em> system-role message, sitting alongside the agent's instructions — which was a surprise
		the first time the context panel was pointed at a fresh thread, because both rows claimed to be the
		system prompt and they were the two largest rows on screen. The panel now recognises the profile by
		its own heading and labels it as working memory, so you can see what remembering you is worth in tokens
		on every single call.
	</p>

	<p>
		The nightly sweep uses the same machinery from the other direction. Each subscription gets its
		own thread, and every one of those threads shares the reader's profile. That is what makes a
		digest able to say "this contradicts what the same group reported last month" — the thread
		remembers the topic, and the profile remembers you.
	</p>

	<p>
		Where there is no database configured, none of this happens, and the app says so rather than
		pretending: a memory that silently forgets is worse than one that is honestly absent.
	</p>

	<p class="live">
		See it live: <strong>the memory panel</strong>, whose second label reads
		<code>resource</code> — that word is the whole chapter. Open a new thread and read it again; it will
		still know you.
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
	/* Clay: what survives the thread. */
	.live strong {
		font-weight: 500;
		color: var(--co-memory);
	}
</style>
