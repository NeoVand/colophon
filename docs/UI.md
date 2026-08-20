# The house style

**Every component in this app follows this. Read it before writing one.**

Ported from harnessXray, whose visual language Neo iterated on hard. The
subsystems differ; the language does not.

## The one rule

**Separation comes from space and tone, not from boxes.** No cards, no shadows,
no borders around things that are already obviously separate. A panel is a small
uppercase mono label and its content sitting directly on the page. Eleven
bordered rectangles is a form, not an instrument panel.

When you need a line, it is a hairline: `1px solid color-mix(in oklab,
var(--border) 60%, transparent)`.

## Tokens — never a literal colour

Defined in `src/routes/layout.css`. Use them; do not invent hexes.

| Token | Means |
| --- | --- |
| `--background` `--foreground` `--muted` `--muted-foreground` `--border` | surfaces |
| `--co-user` | you speaking (plum) |
| `--co-model` | the model speaking (teal) |
| `--co-tool` | retrieval happening (ochre) |
| `--co-library` | papers, and how well they are known (sage) |
| `--co-memory` | what survives the thread (clay) |
| `--co-subagent` | a reader in its own window |
| `--co-approval` | the run is waiting on you (amber) |
| `--co-gate` | the delivery gate withheld something (violet) |
| `--co-error` | red |
| `--co-accent` | the app's own voice; per theme |
| `--co-tok-*` | the quantitative ramp, for stacked bars only |

The `--co-*` legend is a **legend**: ochre means retrieval in every panel or it
means nothing. Never reuse a legend colour for an unrelated idea.

`--co-gate` is violet, not red, on purpose: the gate staying quiet on a thin
week is the product working.

## Classes that already exist

- `.co-eyebrow` — uppercase mono micro-label. **The workhorse.** It is how a
  panel gets a title without a card or a heading weight.
- `.co-num` — mono, `tabular-nums`. Any number in a column.
- `.co-rule` — hairline border colour.
- `.co-frost` — frosted chrome for headers that sit over content.
- `.co-prose` — a document set to be read (serif, 34em measure).
- `.co-field` / `.co-bare` — focus-ring opt-in / opt-out.

## Type

- `--font-sans` Inter — chrome and UI.
- `--font-mono` JetBrains Mono — every readout, label, number, id.
- `--font-serif` Source Serif 4 — anything meant to be *read*: digests,
  reviews, notes, book prose.

Readouts are 0.625–0.6875rem. Labels 0.5–0.5625rem. This is an instrument
panel; it is meant to be dense.

## Icons

`src/lib/icons.ts` is the only place icon names are written. Hugeicons names are
not guessable — check `@hugeicons/core-free-icons` exports rather than assume.

```svelte
<HugeiconsIcon icon={ICON.settings} size={14} />
```

The icon is a **value** passed to `icon`, not a component. Size 12–16 in
chrome. Icons inherit `currentColor`.

## Motion

Sparing. 150–250ms ease on colour and opacity; `animate:flip` when a list
reorders so a promotion is something you *see happen*. Everything respects
`prefers-reduced-motion` via the global rule already in `layout.css`.

## Svelte 5

- Runes only. `$state`, `$derived`, `$props`, `$effect`.
- **Never** write a `$state` variable from inside an `$effect` that also reads
  it — that is `effect_update_depth_exceeded`, and this codebase has shipped it
  twice. Use a plain `let` for edge detection, or `onMount`.
- Anything reading `localStorage` or `document` goes in `onMount`.
- Keyed `{#each}` keys must be **unique**. A duplicate key throws and the throw
  *aborts the render*, leaving stale DOM on screen — it does not merely misdraw.
- Run the svelte MCP `svelte-autofixer` on every component before finishing.

## Writing

Comments explain **why**, especially where the code looks odd. If you fixed a
bug, say what the bug looked like from outside. Never write a comment that
restates the line beneath it.

Reader-facing copy: active voice, specific, no exclamation marks. Say what a
thing is, not how it was built.

## Reference components

Read one before starting:

- `src/lib/components/xray/LibraryPanel.svelte` — a panel with state and a list
- `src/lib/components/chat/ToolChip.svelte` — a small tone-carrying element
- `src/lib/components/Header.svelte` — chrome, menu, hover states
