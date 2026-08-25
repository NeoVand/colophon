/**
 * The icon vocabulary.
 *
 * One place, for two reasons. Hugeicons exports 5,439 symbols and the names are
 * not guessable — `Robot01Icon` not `RobotIcon`, `Layers01Icon` not
 * `LayersIcon`, `WorkflowCircle01Icon` not `WorkflowIcon` — so every name below
 * was checked against the package's own exports rather than assumed. And
 * routing every icon through one module means a semantic rename is one edit
 * instead of a grep.
 *
 * These are the free **stroke** set: each is authored with
 * `stroke: currentColor` and `strokeWidth: 1.5`, so they inherit text colour
 * and sit correctly beside type at small sizes.
 *
 * Usage — the icon is a *value* passed to the `icon` prop, never a component:
 *
 *     <HugeiconsIcon icon={ICON.settings} size={14} />
 *
 * Keys are named for **what the thing means here**, not for what the picture
 * shows. `ICON.library` may one day stop being a book; nothing that uses it
 * should have to care.
 */
import {
	Activity01Icon,
	Alert01Icon,
	ArrowDown01Icon,
	ArrowRight01Icon,
	ArrowUpRight01Icon,
	Book02Icon,
	BookOpen01Icon,
	Brain01Icon,
	BrainCircuitIcon,
	Cancel01Icon,
	CheckIcon,
	Clock01Icon,
	CodeSimpleIcon,
	Copy01Icon,
	Database01Icon,
	Delete02Icon,
	Download01Icon,
	EyeIcon,
	File01Icon,
	FilterHorizontalIcon,
	FlashIcon,
	Image01Icon,
	InformationCircleIcon,
	Key01Icon,
	Layers01Icon,
	Link01Icon,
	Mail01Icon,
	MagicWand01Icon,
	Menu01Icon,
	Message01Icon,
	Moon02Icon,
	Pdf01Icon,
	PlusSignIcon,
	SentIcon,
	StopIcon,
	PauseIcon,
	PlayIcon,
	Plug01Icon,
	PuzzleIcon,
	QuoteDownIcon,
	Refresh01Icon,
	Robot01Icon,
	Search01Icon,
	Settings01Icon,
	Shield01Icon,
	SidebarRight01Icon,
	SparklesIcon,
	Sun02Icon,
	TerminalIcon,
	TextAlignLeftIcon,
	UserIcon,
	WorkflowCircle01Icon
} from '@hugeicons/core-free-icons';

export const ICON = {
	/* ── the legend, one icon per subsystem ─────────────────────────────────
	   These pair with the `--co-*` colours in layout.css. An icon and a colour
	   that disagree about what a thing is are worse than neither. */
	user: UserIcon,
	model: BrainCircuitIcon,
	tool: FlashIcon,
	library: Book02Icon,
	memory: Brain01Icon,
	subagent: Robot01Icon,
	approval: Shield01Icon,
	gate: PauseIcon,
	error: Alert01Icon,

	/* ── the X-ray ──────────────────────────────────────────────────────── */
	events: Activity01Icon,
	context: Layers01Icon,
	spend: Database01Icon,
	graph: WorkflowCircle01Icon,
	workflow: WorkflowCircle01Icon,
	mcp: Plug01Icon,
	skills: PuzzleIcon,
	scorer: SparklesIcon,
	trace: Clock01Icon,
	inspect: EyeIcon,
	raw: CodeSimpleIcon,
	filter: FilterHorizontalIcon,

	/* ── research ───────────────────────────────────────────────────────── */
	search: Search01Icon,
	paper: File01Icon,
	pdf: Pdf01Icon,
	cite: QuoteDownIcon,
	figure: Image01Icon,
	generate: MagicWand01Icon,
	digest: Mail01Icon,
	prose: TextAlignLeftIcon,

	/* ── chrome ─────────────────────────────────────────────────────────── */
	settings: Settings01Icon,
	about: InformationCircleIcon,
	book: BookOpen01Icon,
	thread: Message01Icon,
	menu: Menu01Icon,
	panel: SidebarRight01Icon,
	close: Cancel01Icon,
	check: CheckIcon,
	copy: Copy01Icon,
	download: Download01Icon,
	link: Link01Icon,
	external: ArrowUpRight01Icon,
	expand: ArrowDown01Icon,
	collapse: ArrowRight01Icon,
	refresh: Refresh01Icon,
	trash: Delete02Icon,
	run: PlayIcon,
	key: Key01Icon,
	terminal: TerminalIcon,
	add: PlusSignIcon,
	send: SentIcon,
	stop: StopIcon,
	light: Sun02Icon,
	dark: Moon02Icon
} as const;

export type IconName = keyof typeof ICON;
