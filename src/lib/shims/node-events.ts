/**
 * `node:events` for the browser — a real implementation, deliberately.
 *
 * This is the one Node builtin that a throwing stub will NOT survive. Mastra
 * constructs an `EventEmitterPubSub` at *module initialisation* time, so an
 * inert stub fails with `misc_default is not a constructor` before any of our
 * code runs — the bundle imports and immediately dies.
 *
 * Roughly forty lines buys the whole in-process pubsub, so it is worth writing
 * properly rather than polyfilling the entire `events` package.
 */

type Listener = (...args: unknown[]) => void;

export class EventEmitter {
	#listeners = new Map<string | symbol, Listener[]>();

	on(event: string | symbol, fn: Listener): this {
		const existing = this.#listeners.get(event);
		if (existing) existing.push(fn);
		else this.#listeners.set(event, [fn]);
		return this;
	}

	addListener(event: string | symbol, fn: Listener): this {
		return this.on(event, fn);
	}

	once(event: string | symbol, fn: Listener): this {
		const wrapped: Listener = (...args) => {
			this.off(event, wrapped);
			fn(...args);
		};
		return this.on(event, wrapped);
	}

	off(event: string | symbol, fn: Listener): this {
		const existing = this.#listeners.get(event);
		if (existing) {
			const i = existing.indexOf(fn);
			if (i >= 0) existing.splice(i, 1);
		}
		return this;
	}

	removeListener(event: string | symbol, fn: Listener): this {
		return this.off(event, fn);
	}

	removeAllListeners(event?: string | symbol): this {
		if (event === undefined) this.#listeners.clear();
		else this.#listeners.delete(event);
		return this;
	}

	/** A copy, so a listener removing itself mid-emit cannot skip a sibling. */
	emit(event: string | symbol, ...args: unknown[]): boolean {
		const existing = this.#listeners.get(event);
		if (!existing?.length) return false;
		for (const fn of [...existing]) fn(...args);
		return true;
	}

	listenerCount(event: string | symbol): number {
		return this.#listeners.get(event)?.length ?? 0;
	}

	listeners(event: string | symbol): Listener[] {
		return [...(this.#listeners.get(event) ?? [])];
	}

	eventNames(): (string | symbol)[] {
		return [...this.#listeners.keys()];
	}

	/** Node's backpressure warning has no meaning here. */
	setMaxListeners(): this {
		return this;
	}
	getMaxListeners(): number {
		return Infinity;
	}
}

export default EventEmitter;
