import type { Component } from 'svelte';
import Colophon from './chapters/Colophon.svelte';
import Retrieval from './chapters/Retrieval.svelte';
import Registry from './chapters/Registry.svelte';
import Delegation from './chapters/Delegation.svelte';
import Memory from './chapters/Memory.svelte';
import Window from './chapters/Window.svelte';
import Gate from './chapters/Gate.svelte';
import Sweep from './chapters/Sweep.svelte';
import Approval from './chapters/Approval.svelte';
import Workflow from './chapters/Workflow.svelte';

/**
 * The book's spine.
 *
 * Chapters are components rather than markdown files, so the lead paragraph,
 * the subheads and the closing pointer at the app are structure the page can
 * style directly instead of output from a renderer. Each one carries its own
 * `.co-prose` wrapper, so a chapter renders correctly wherever it is mounted.
 *
 * The prose is about *this* application. Every tool name, cap, refusal and
 * measured number in it was read from the code it describes, which means the
 * chapters go stale when the code changes — deliberately. A book that cannot
 * be wrong about the program is not telling you anything about the program.
 *
 * The voice is load-bearing and easy to lose. A chapter opens with a `.lead`
 * stating the idea in plain words before any jargon, keeps a paragraph to one
 * thought, puts anything enumerable in a list rather than a sentence full of
 * semicolons, and names the failure where we learned something the hard way —
 * the bugs teach faster than the descriptions do. Density is not rigour.
 */
export interface Chapter {
	/** Stable slug; used for the URL fragment and as an `{#each}` key. */
	id: string;
	/** 1-based position, printed as the chapter number. */
	number: number;
	/** A claim, not a keyword. */
	title: string;
	/** One sentence for the contents page. */
	blurb: string;
	component: Component;
}

export const CHAPTERS: Chapter[] = [
	{
		id: 'colophon',
		number: 1,
		title: 'The mark that says how it was made',
		blurb:
			'What a colophon is, and why an app that shows its own making is named for the printer’s note.',
		component: Colophon
	},
	{
		id: 'retrieval',
		number: 2,
		title: 'Search broadly, read narrowly',
		blurb:
			'arXiv for what is new, OpenAlex for what matters — and the OR that made every query mean nothing.',
		component: Retrieval
	},
	{
		id: 'registry',
		number: 3,
		title: 'A citation you cannot invent',
		blurb: 'Listed is not read. Two refusals, two different mistakes, two different corrections.',
		component: Registry
	},
	{
		id: 'delegation',
		number: 4,
		title: 'A reader with its own window',
		blurb:
			'The paper-reader subagent: fifty thousand tokens in, a page of notes back, provenance intact.',
		component: Delegation
	},
	{
		id: 'memory',
		number: 5,
		title: 'Memory that outlives the thread',
		blurb:
			'Resource-scoped working memory, and why surviving the conversation is the entire point.',
		component: Memory
	},
	{
		id: 'window',
		number: 6,
		title: 'What you actually pay for',
		blurb:
			'The outgoing request taken apart: schemas as a fixed tax, reasoning sent by reference, one measured 138,000-token turn.',
		component: Window
	},
	{
		id: 'gate',
		number: 7,
		title: 'Silence is the product',
		blurb: 'A scorer measures and a processor refuses, and only one of those stops an email.',
		component: Gate
	},
	{
		id: 'sweep',
		number: 8,
		title: 'What it does while you sleep',
		blurb:
			'One subscription, one run, one verdict — on platform cron, and why not the framework’s.',
		component: Sweep
	},
	{
		id: 'approval',
		number: 9,
		title: 'A pause that survives the request',
		blurb:
			'Stopping to ask a human, when the human answers in a different HTTP request on a different machine.',
		component: Approval
	},
	{
		id: 'workflow',
		number: 10,
		title: 'Research as a pipeline you can draw',
		blurb:
			'Scope, search, select, read in parallel, write — a step graph the X-ray reads rather than illustrates.',
		component: Workflow
	}
];
