import { JSDOM, VirtualConsole } from 'jsdom';
import fetch from 'node-fetch';
import { chunk } from '../utils';

const MAX_N_CHUNKS = 100;
const CHUNK_CHAR_LENGTH = 400;

export async function parseWeb(url: string): Promise<string[]> {
  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 10000);
  const htmlString = await fetch(url, { signal: abortController.signal })
    .then((response) => response.text())
    .catch(() => null);

  if (!htmlString) return [];

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', () => {
    // No-op to skip console errors.
  });

  // put the html string into a DOM
  const dom = new JSDOM(htmlString, {
    virtualConsole,
  });

  const { document } = dom.window;
  // Try multiple selectors to find text content
  const selectors = [
    'p',                           // Standard paragraphs
    'article',                     // Article content
    '.content',                    // Common content class
    '[role="main"]',              // Main content area
    'div > p',                    // Paragraphs in divs
    '.post-content',              // Blog post content
    'main',                       // Main content
    'div:not(:empty)',           // Any non-empty div as fallback
  ];

  let textElements: Element[] = [];
  
  // Try each selector until we find content
  for (const selector of selectors) {
    textElements = Array.from(document.querySelectorAll(selector));
    if (textElements.length > 0) break;
  }

  // If we still don't have content, try getting all text nodes
  if (!textElements.length) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    textElements = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent?.trim()) {
        textElements.push(node);
      }
    }
  }

  // Extract and clean text content
  const textContents = textElements
    .map(el => el.textContent?.trim())
    .filter(Boolean)
    .map(text => 
      text
        .replace(/\s+/g, ' ')           // Normalize whitespace
        .replace(/[^\S\r\n]+/g, ' ')    // Convert multiple spaces to single
        .replace(/\n{2,}/g, '\n')       // Normalize line breaks
        .trim()
    );

  // Combine all text
  const text = textContents.join(' ').trim();

  // Return empty array if no meaningful content found
  if (!text) {
    console.warn(`No text content found for ${url}`);
    return [];
  }

  return chunk(text, CHUNK_CHAR_LENGTH).slice(0, MAX_N_CHUNKS);
}
