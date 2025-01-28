export const getStringFromBuffer = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * Chunk array into arrays of length at most `chunkSize`
 *
 * @param chunkSize must be greater than or equal to 1
 *
 * Copied from Huggingface Chat
 * @see https://github.com/huggingface/chat-ui/blob/main/src/lib/utils/chunk.ts
 */
export function chunk<T extends unknown[] | string>(
  arr: T,
  chunkSize: number
): T[] {
  if (isNaN(chunkSize) || chunkSize < 1) {
    throw new RangeError('Invalid chunk size: ' + chunkSize);
  }

  if (!arr.length) {
    return [];
  }

  /// Small optimization to not chunk buffers unless needed
  if (arr.length <= chunkSize) {
    return [arr];
  }

  return range(Math.ceil(arr.length / chunkSize)).map((i) => {
    return arr.slice(i * chunkSize, (i + 1) * chunkSize);
  }) as T[];
}

function range(n: number, b?: number): number[] {
  return b
    ? Array(b - n)
        .fill(0)
        .map((_, i) => n + i)
    : Array(n)
        .fill(0)
        .map((_, i) => i);
}

/**
 * Calculates the dot product of two arrays.
 * @param {number[]} arr1 The first array.
 * @param {number[]} arr2 The second array.
 * @returns {number} The dot product of arr1 and arr2.
 *
 * Copied from @xenova/transformers / Huggingface Chat
 * @see https://github.com/xenova/transformers.js/blob/main/src/utils/maths.js
 */
export function dot(arr1: number[], arr2: number[]) {
  return arr1.reduce((acc, val, i) => acc + val * arr2[i], 0);
}
