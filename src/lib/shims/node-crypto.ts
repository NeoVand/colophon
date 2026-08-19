/**
 * `node:crypto` for the browser.
 *
 * Two of these are free — `randomUUID` and `getRandomValues` are native Web
 * Crypto. The third is not, and it is the one that matters.
 *
 * ── Why a real SHA-256 and not a cheap hash ─────────────────────────────────
 * Mastra calls `createHash('sha256')` for *content identity*: cache keys,
 * dedup keys and content addresses, frequently truncated to 8, 16 or 32 hex
 * characters. A 32-bit non-cryptographic hash (FNV-1a, say) truncated to 8 hex
 * chars would collide across a few thousand items, and the failure mode is the
 * worst kind — the agent silently reads back the wrong cached content.
 *
 * `crypto.subtle.digest` is the browser's real answer, but it is *async* and
 * `createHash().digest()` is synchronous, so it cannot be used here. Hence
 * @noble/hashes: audited, ~3 KB, synchronous, and verified in this repo against
 * the NIST vector for "abc".
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const encoder = new TextEncoder();

function toBytes(data: string | Uint8Array | ArrayBuffer): Uint8Array {
	if (typeof data === 'string') return encoder.encode(data);
	if (data instanceof Uint8Array) return data;
	return new Uint8Array(data);
}

function concat(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Uint8Array(total);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.length;
	}
	return out;
}

function toBase64(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

class Hash {
	#chunks: Uint8Array[] = [];
	#algorithm: 'sha256' | 'sha512';

	constructor(algorithm: string) {
		const normalized = algorithm.toLowerCase().replace('-', '');
		if (normalized !== 'sha256' && normalized !== 'sha512') {
			throw new Error(
				`crypto.createHash('${algorithm}') is not supported in the browser build. ` +
					`Only sha256 and sha512 are shimmed (see src/lib/shims/node-crypto.ts).`
			);
		}
		this.#algorithm = normalized;
	}

	/** Chainable, and tolerant of the optional encoding argument Node accepts. */
	update(data: string | Uint8Array | ArrayBuffer, _encoding?: string): this {
		this.#chunks.push(toBytes(data));
		return this;
	}

	digest(encoding?: 'hex' | 'base64'): string | Uint8Array {
		const fn = this.#algorithm === 'sha256' ? sha256 : sha512;
		const out = fn(concat(this.#chunks));
		if (encoding === 'hex') return bytesToHex(out);
		if (encoding === 'base64') return toBase64(out);
		return out;
	}
}

export function createHash(algorithm: string): Hash {
	return new Hash(algorithm);
}

export function randomUUID(): string {
	return globalThis.crypto.randomUUID();
}

export function randomBytes(size: number): Uint8Array {
	return globalThis.crypto.getRandomValues(new Uint8Array(size));
}

export function getRandomValues<T extends ArrayBufferView>(array: T): T {
	return globalThis.crypto.getRandomValues(array);
}

export const webcrypto = globalThis.crypto;

export default { createHash, randomUUID, randomBytes, getRandomValues, webcrypto };
