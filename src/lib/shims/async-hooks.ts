/**
 * `node:async_hooks` for the browser.
 *
 * Mastra's observability module builds its tracing context on
 * `AsyncLocalStorage`. The browser has no async-context primitive, so this is a
 * stand-in with exactly one slot.
 *
 * ── Why this never unwinds ──────────────────────────────────────────────────
 * Real ALS gives each async context its own store. One slot means any unwinding
 * strategy amounts to guessing which of several interleaved callers currently
 * owns it. harnessXray measured two strategies against a live LangGraph run and
 * both failed the same way:
 *
 *   restore in `finally`             → context gone after the first `await`
 *   restore when the promise settles → a sibling's completion tore down the
 *                                      active context; empty on ~40% of calls
 *
 * So: last-writer-wins, and never unwind. The store persists until the next
 * `run()` replaces it. Context is then always *present*; the residual risk is
 * that it is *stale* rather than missing.
 *
 * That trade is right here for the same reason it was there: the browser runs
 * one agent at a time, and this shim backs *tracing* — a stale span parent
 * mis-nests a row in the X-ray, where a missing context would throw. Prefer the
 * cosmetic failure.
 */

export class AsyncLocalStorage<T> {
	#store: T | undefined = undefined;

	getStore(): T | undefined {
		return this.#store;
	}

	run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
		this.#store = store;
		return callback(...args);
	}

	enterWith(store: T): void {
		this.#store = store;
	}

	exit<R>(callback: (...args: unknown[]) => R, ...args: unknown[]): R {
		return callback(...args);
	}

	disable(): void {
		this.#store = undefined;
	}
}

export class AsyncResource {
	runInAsyncScope<R>(fn: (...args: unknown[]) => R, thisArg?: unknown, ...args: unknown[]): R {
		return fn.apply(thisArg, args) as R;
	}
	emitDestroy(): this {
		return this;
	}
}

export function executionAsyncId(): number {
	return 0;
}
export function triggerAsyncId(): number {
	return 0;
}

export default { AsyncLocalStorage, AsyncResource, executionAsyncId, triggerAsyncId };
