import { JSDOM, VirtualConsole } from 'jsdom';
import fetch from 'node-fetch';
import { cleanText } from '../utils/text';
import { WebContent } from '../types';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function parseWeb(url: string): Promise<WebContent> {
  try {
    // Fetch with timeout
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), 10000);

    const response = await fetch(url, { signal: abortController.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const htmlString = await response.text();
    if (!htmlString) return { url, content: '' };

    // Setup virtual console
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('error', () => {
      // No-op to skip console errors
    });

    // Create DOM
    const dom = new JSDOM(htmlString, { virtualConsole });
    const { document } = dom.window;

    // Primary content selectors in order of preference
    const contentSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.post-content',
      '.article-content',
      '.content',
      '.entry-content',
    ];

    // Text-containing elements to extract from
    const textSelectors = ['p', 'h1, h2, h3, h4, h5, h6', 'li', 'blockquote'];

    let content: Element[] = [];

    // Try to find main content container first
    for (const selector of contentSelectors) {
      const elements = Array.from(document.querySelectorAll(selector));
      if (elements.length > 0) {
        content = elements;
        break;
      }
    }

    // If no main content found, fall back to body
    if (!content.length) {
      content = [document.body];
    }

    // Extract text from content areas
    const textElements = content.flatMap((container) =>
      Array.from(container.querySelectorAll(textSelectors.join(',')))
    );

    // Filter and clean text content
    const rawContent = textElements
      .map((el) => el.textContent?.trim())
      .filter((text): text is string => {
        if (!text) return false;
        // Filter out short or low-information content
        if (text.length < 20) return false;
        // Filter out navigation/menu text
        if (
          text.toLowerCase().includes('menu') ||
          text.toLowerCase().includes('navigation')
        )
          return false;
        // Filter out common UI text
        if (/^(share|search|subscribe|follow|sign up|login)$/i.test(text))
          return false;
        return true;
      })
      .map(cleanText)
      .join(' ')
      .trim();

    if (!rawContent) {
      console.warn(`No text content found for ${url}`);
      return { url, content: '' };
    }

    // Process with GPT-4-mini to extract main content
    const { text: processedContent } = await generateText({
      model: openai('gpt-4o-mini'),
      messages: [
        {
          role: 'system',
          content:
            'Extract the main information from the text, removing unnecessary details, advertisements, and boilerplate content. Maintain the core message and important details while making the text more concise. Return only the processed content without any additional commentary.',
        },
        {
          role: 'user',
          content: rawContent,
        },
      ],
    });

    // Extract metadata
    const { hostname } = new URL(url);
    const title = document.title?.trim();

    return { url, content: processedContent.trim(), hostname, title };
  } catch (error) {
    console.error(`Error parsing ${url}:`, error);
    return { url, content: '' };
  }
}
