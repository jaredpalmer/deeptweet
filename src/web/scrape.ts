import { JSDOM, VirtualConsole } from 'jsdom';
import fetch from 'node-fetch';
import { chunkText, cleanText, ChunkOptions } from '../utils/text';

import { WebContent } from '../types';

export async function parseWeb(url: string): Promise<WebContent> {
  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 10000);
  const htmlString = await fetch(url, { signal: abortController.signal })
    .then((response) => response.text())
    .catch(() => null);

  if (!htmlString) return { url, chunks: [] };

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
        textElements.push(node.parentElement || document.createElement('div'));
      }
    }
  }

  // Extract and clean text content
  const textContents = textElements
    .map(el => el.textContent?.trim())
    .filter(Boolean)
    .map(text => text ? cleanText(text) : '');

  // Combine all text
  const text = textContents.join(' ').trim();

  // Return empty array if no meaningful content found
  if (!text) {
    console.warn(`No text content found for ${url}`);
    return { url, chunks: [] };
  }

  // Create semantic chunks with overlap
  const chunks = chunkText(text, {
    chunkSize: 2000,   // Much larger chunks to capture more context
    overlap: 200,      // Larger overlap to maintain coherence
    minLength: 100,    // Increased min length for more meaningful chunks
    maxChunks: 50      // Fewer but larger chunks
  });
  
  try {
    const { hostname } = new URL(url);
    const title = document.title;
    return { url, chunks, hostname, title };
  } catch (e) {
    return { url, chunks };
  }
}
