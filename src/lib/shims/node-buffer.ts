/**
 * `node:buffer` for the browser — minimal, but real.
 *
 * Left unmapped, Vite externalises this and `Buffer` silently becomes
 * `undefined`, so the failure surfaces much later as "cannot read property from
 * of undefined" somewhere unrelated. A throwing stub would be honest but too
 * blunt: `Buffer` in Mastra's graph is used for ordinary byte handling that a
 * browser can do perfectly well.
 *
 * So this is a genuine implementation over `Uint8Array`, which is what Node's
 * Buffer is a subclass of anyway. Only the statics that actually get called are
 * here; anything else is absent and will fail loudly, which is the intent.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toHex(bytes: Uint8Array): string {
	let out = '';
	for (const b of bytes) out += b.toString(16).padStart(2, '0');
	return out;
}

function fromHex(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length >> 1);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
	return out;
}

function toBase64(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
	const s = atob(b64);
	const out = new Uint8Array(s.length);
	for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
	return out;
}

class BufferBase extends Uint8Array {
	toString(encoding: 'utf8' | 'utf-8' | 'hex' | 'base64' = 'utf8'): string {
		if (encoding === 'hex') return toHex(this);
		if (encoding === 'base64') return toBase64(this);
		return decoder.decode(this);
	}
}

/**
 * The statics are merged rather than declared inside the class: `Uint8Array`
 * already has a static `from` with an incompatible signature, and TypeScript
 * rejects a subclass that narrows it. Merging produces an overload instead,
 * which is exactly the relationship Node's Buffer has with its base.
 */
const statics = {
	from(
		value: string | ArrayLike<number> | ArrayBuffer,
		encoding: 'utf8' | 'utf-8' | 'hex' | 'base64' = 'utf8'
	): BufferBase {
		if (typeof value === 'string') {
			const bytes =
				encoding === 'hex'
					? fromHex(value)
					: encoding === 'base64'
						? fromBase64(value)
						: encoder.encode(value);
			return new BufferBase(bytes);
		}
		return new BufferBase(
			value instanceof ArrayBuffer ? new Uint8Array(value) : Uint8Array.from(value)
		);
	},

	alloc(size: number, fill = 0): BufferBase {
		const b = new BufferBase(size);
		if (fill) b.fill(fill);
		return b;
	},

	isBuffer(value: unknown): boolean {
		return value instanceof Uint8Array;
	},

	concat(list: Uint8Array[]): BufferBase {
		const total = list.reduce((n, b) => n + b.length, 0);
		const out = new BufferBase(total);
		let at = 0;
		for (const b of list) {
			out.set(b, at);
			at += b.length;
		}
		return out;
	},

	byteLength(value: string): number {
		return encoder.encode(value).length;
	}
};

export const Buffer = Object.assign(BufferBase, statics);

export default { Buffer };
