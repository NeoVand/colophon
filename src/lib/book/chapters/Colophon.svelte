<div class="co-prose chapter">
	<p class="lead">
		A colophon is the note at the end of a book that says how the book was made — which press, which
		typeface, which paper, whose hands. It is the one page where a printed object stops pretending
		to be a text and admits to being a manufactured thing.
	</p>

	<p>
		The word is Greek: <em>kolophōn</em>, a finishing stroke. Scribes wrote them long before
		printing existed — who copied this, where, in what year, and often a line about how tired they
		were by the end. Printers inherited the habit and added a device: the mark that said this came
		from our shop, and we will answer for it. A modern colophon is quieter. "Set in Bembo. Printed
		on acid-free paper." The same claim with fewer flourishes.
	</p>

	<p>
		This application is named for that note because it is built to be one. An agent that reads the
		literature and writes you a digest is a manufactured object too, and it arrives with none of its
		making visible. You get prose. You do not get: which papers it opened as opposed to glanced at,
		what it refused to invent, what the reading cost, what it remembered about you from a
		conversation last month. Colophon prints all of that in the margin.
	</p>

	<h2>The rule the X-ray keeps</h2>

	<p>
		Open the flank and there is a second reading of the same run — spend, memory, the outgoing
		request taken apart, every paper met, every event in order. Those panels are built under one
		rule that is worth stating first, because it is what makes them worth believing: <em
			>nothing is passed into the agent to make the X-ray work</em
		>. The library panel is reconstructed from the tool results the run already publishes, not from
		a side channel the agent was asked to fill in.
	</p>

	<p>
		That constraint pays twice. A readout of what did happen teaches more than a diagram of what
		should — a diagram is a claim, and this is a reading. And every panel keeps working when the
		agent changes, because none of them depends on the agent's cooperation. If the model stopped
		cooperating tomorrow, the library would carry on counting.
	</p>

	<h2>The other half of the mark</h2>

	<p>
		A colophon is also a warranty. "Printed by us" means somebody stands behind the errors. The
		equivalent here is that a citation in a Colophon document cannot be invented. Nothing can be
		cited that did not arrive over the network during this run, and the reference list at the foot
		of a digest is written by the system from its own record of what was retrieved, rather than by
		the model from memory. Most of the chapters that follow are about the machinery of that one
		guarantee, and about what it costs to keep.
	</p>

	<p>
		The rest of the surface is honest about being an instrument panel. The colours are a legend —
		ochre is retrieval wherever it appears, sage is papers, violet is the gate withholding something
		— and a colour that means two things means nothing. Numbers are set in mono with tabular figures
		so a column can be read down. Almost nothing is in a box, because eleven boxes is a form and not
		an instrument; separation comes from space and tone instead.
	</p>

	<p>
		None of this makes the agent better at research. It makes the research checkable, which is a
		different and more durable property — and it is the only kind of trust a manufactured object has
		ever been able to offer.
	</p>

	<p class="live">
		See it live: <strong>the X-ray flank</strong>, which the header toggles. Everything the rest of
		this book describes is somewhere in there, and none of it needed the agent's permission to
		appear.
	</p>
</div>

<style>
	/* The lead is set slightly larger than the body and never coloured: it is the
	   paragraph a reader skimming the book will actually read, so it carries the
	   idea in plain words before any jargon arrives. */
	.lead {
		font-size: 1.1875rem;
		line-height: 1.55;
	}

	/* The closing pointer is chrome, not prose — mono, small, and above a
	   hairline, so it reads as the book stepping out to point at the app. */
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
