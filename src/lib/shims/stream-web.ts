/**
 * `node:stream/web` for the browser — a re-export, not a polyfill.
 *
 * Mastra's agent, loop, stream, tools and workflow modules all import
 * `ReadableStream` and friends from `node:stream/web`. Those are WHATWG streams:
 * the browser has had them natively for years, and they are the *same* types.
 * Node only namespaces them because it also has its own older stream API.
 *
 * So this file adds nothing and costs nothing. It exists purely so the bundler
 * can resolve the specifier.
 */

export const ReadableStream = globalThis.ReadableStream;
export const WritableStream = globalThis.WritableStream;
export const TransformStream = globalThis.TransformStream;
export const ByteLengthQueuingStrategy = globalThis.ByteLengthQueuingStrategy;
export const CountQueuingStrategy = globalThis.CountQueuingStrategy;
export const ReadableStreamDefaultReader = globalThis.ReadableStreamDefaultReader;
export const WritableStreamDefaultWriter = globalThis.WritableStreamDefaultWriter;

export default {
	ReadableStream,
	WritableStream,
	TransformStream,
	ByteLengthQueuingStrategy,
	CountQueuingStrategy
};
