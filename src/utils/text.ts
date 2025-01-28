import { chunk } from '../utils';

export interface ChunkOptions {
  maxChunks?: number;
  chunkSize?: number;
  minLength?: number;
  overlap?: number;
}

const DEFAULT_OPTIONS: Required<ChunkOptions> = {
  maxChunks: 100,
  chunkSize: 400,
  minLength: 50,
  overlap: 100,
};

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // First, split into sentences/paragraphs
  const segments = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= opts.minLength);

  // Create overlapping chunks
  let chunks: string[] = [];
  let currentChunk = '';

  for (const segment of segments) {
    if (currentChunk.length + segment.length > opts.chunkSize) {
      chunks.push(currentChunk.trim());
      // Keep last part for overlap
      const words = currentChunk.split(' ');
      currentChunk = words.slice(-Math.floor(opts.overlap / 10)).join(' ');
    }
    currentChunk += ' ' + segment;
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // Ensure chunks aren't too small
  chunks = chunks
    .filter(c => c.length >= opts.minLength)
    .slice(0, opts.maxChunks);

  return chunks;
}

export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .replace(/[^\S\r\n]+/g, ' ')    // Convert multiple spaces to single
    .replace(/\n{2,}/g, '\n')       // Normalize line breaks
    .trim();
}

// Rough token count estimation - GPT models typically use ~4 chars per token
export function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

// Split text if it exceeds token limit
export function splitForTokenLimit(text: string, maxTokens: number = 30000): string[] {
  const chunks: string[] = [];
  let currentChunk = '';
  const sentences = text.split(/(?<=[.!?])\s+/);

  for (const sentence of sentences) {
    const potentialChunk = currentChunk + sentence + ' ';
    if (estimateTokenCount(potentialChunk) > maxTokens) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence + ' ';
    } else {
      currentChunk = potentialChunk;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
