import { generateText, generateObject } from 'ai';
import { outlineSchema, blogPostSchema } from './schemas';
import { openai } from '@ai-sdk/openai';
import { JSDOM, VirtualConsole } from 'jsdom';
import fetch from 'node-fetch';
import kleur from 'kleur';
import 'dotenv/config';

interface BlogPost {
  title: string;
  summary: string;
  sections: {
    title: string;
    content: string;
    sources: string[];
  }[];
  conclusion: string;
}

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

const MAX_N_PAGES_SCRAPE = 10;
const MAX_N_PAGES_EMBED = 5;
const MAX_N_CHUNKS = 100;
const CHUNK_CHAR_LENGTH = 400;
const DOMAIN_BLOCKLIST = [
  'youtube.com',
  'facebook.com',
  'twitter.com',
  'instagram.com',
];

async function parseWeb(url: string): Promise<string[]> {
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

async function searchGoogle(query: string): Promise<SearchResult[]> {
  if (!process.env.SERPER_API_KEY) {
    throw new Error('SERPER_API_KEY environment variable is required');
  }

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      q: query,
      num: 5, // Get top 5 results
    }),
  });

  const data = (await response.json()) as { organic?: SearchResult[] };
  const results = (data.organic || []).map((result) => {
    try {
      const { hostname } = new URL(result.link);
      return { ...result, hostname };
    } catch {
      return result;
    }
  });

  return results
    .filter(
      (result) =>
        !DOMAIN_BLOCKLIST.some((domain) => result.hostname?.includes(domain))
    )
    .slice(0, MAX_N_PAGES_SCRAPE);
}


import { findSimilarSentences } from './find-similar-sentences';
import { generateQuery } from './generate-query';
import { chunk } from './utils';

async function research(topic: string): Promise<BlogPost> {
  // Step 1: Generate optimized search queries
  console.log(kleur.blue('🔍 Researching: ') + topic);

  // Generate multiple search queries for different aspects
  const queries = await Promise.all([
    generateQuery([
      {
        id: '1',
        role: 'user',
        content: `${topic} business impact and use cases`,
      },
    ]),
    generateQuery([
      {
        id: '2',
        role: 'user',
        content: `${topic} technical implementation details`,
      },
    ]),
    generateQuery([
      { id: '3', role: 'user', content: `${topic} market trends and analysis` },
    ]),
  ]);

  // Step 2: Search and extract content from multiple angles
  console.log(kleur.dim('Searching...'));
  const allResults = await Promise.all(queries.map(searchGoogle));
  const uniqueUrls = new Set(allResults.flat().map((r) => r.link));

  const contents = await Promise.all(
    Array.from(uniqueUrls).map(async (url) => ({
      chunks: await parseWeb(url),
      url,
    }))
  );

  // Step 2.5: Find most relevant content using embeddings
  console.log(kleur.dim('Analyzing relevance...'));
  const allSentences = contents
    .flatMap(c => c.chunks)
    .filter((s) => s.trim().length > 50); // Filter out short chunks

  const topSentenceIndices = await findSimilarSentences(topic, allSentences, {
    topK: 10,
  });
  const mostRelevantContent = topSentenceIndices
    .map((i) => allSentences[i])
    .join('\n\n');

  // Step 3: Generate blog post outline
  console.log(kleur.dim('Creating outline...'));
  const outline = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: outlineSchema,
    messages: [
      {
        role: 'system',
        content: `Create an outline for a technical blog post about ${topic}. Include a compelling title and key points to cover in each section.`,
      },
      {
        role: 'user',
        content: mostRelevantContent,
      },
    ],
  });

  // Step 4: Generate each section
  console.log(kleur.dim('Writing sections...'));
  const sections = await Promise.all(
    outline.sections.map(async (section: any) => {
      const { text: content } = await generateText({
        model: openai('gpt-4o-mini'),
        messages: [
          {
            role: 'system',
            content: `Write a section for a technical blog post. Focus on practical insights and business value.
            Include specific examples and technical details where relevant.
            Key points to cover: ${section.key_points.join(', ')}`,
          },
          {
            role: 'user',
            content: `Section title: ${section.title}\n\nReference content:\n${mostRelevantContent}`,
          },
        ],
      });

      return {
        title: section.title,
        content,
        sources: contents.map((c) => c.url),
      };
    })
  );

  // Step 5: Generate summary and conclusion
  console.log(kleur.dim('Finishing up...'));
  const { text: summary } = await generateText({
    model: openai('gpt-4o-mini'),
    messages: [
      {
        role: 'system',
        content:
          'Write a compelling executive summary for a technical blog post. Focus on the key takeaways and business value.',
      },
      {
        role: 'user',
        content: sections.map((s) => s.content).join('\n\n'),
      },
    ],
  });

  const { text: conclusion } = await generateText({
    model: openai('gpt-4o-mini'),
    messages: [
      {
        role: 'system',
        content:
          'Write a strong conclusion for a technical blog post. Summarize key points and provide clear next steps or recommendations.',
      },
      {
        role: 'user',
        content: sections.map((s) => s.content).join('\n\n'),
      },
    ],
  });

  // Step 6: Final quality check and improvements
  console.log(kleur.dim('Polishing content...'));
  const improved = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: blogPostSchema,
    messages: [
      {
        role: 'system',
        content: `Review and improve this blog post. Focus on:
1. Clear business value
2. Technical accuracy
3. Engaging style
4. Actionable insights`,
      },
      {
        role: 'user',
        content: `Title: ${outline.title}\n\nSummary: ${summary}\n\n${sections
          .map((s) => `${s.title}\n\n${s.content}`)
          .join('\n\n')}\n\n${conclusion}`,
      },
    ],
  });

  console.log(kleur.green('✓ Blog post generated!'));
  return {
    title: improved.title,
    summary: improved.summary,
    sections: improved.sections.map((s) => ({
      ...s,
      sources: contents.map((c) => c.url),
    })),
    conclusion: improved.conclusion,
  };
}

// CLI interface

if (!process.env.SERPER_API_KEY) {
  console.error(
    kleur.red('Error: SERPER_API_KEY environment variable is required')
  );
  process.exit(1);
}

const topic = process.argv[2];
if (!topic) {
  console.error(kleur.yellow('Usage: node research.js "your topic here"'));
  process.exit(1);
}

console.log(kleur.dim('Starting research...'));
research(topic)
  .then((blogPost) => {
    // Print the blog post
    console.log('\n' + kleur.bold().cyan('╭─────────────────────╮'));
    console.log(kleur.bold().cyan('│     Blog Post      │'));
    console.log(kleur.bold().cyan('╰─────────────────────╯\n'));

    console.log(kleur.bold().blue(blogPost.title));
    console.log(kleur.dim('═'.repeat(blogPost.title.length)) + '\n');

    console.log(kleur.bold('Summary'));
    console.log(kleur.dim('─'.repeat(40)));
    console.log(blogPost.summary + '\n');

    for (const section of blogPost.sections) {
      console.log(kleur.bold(section.title));
      console.log(kleur.dim('─'.repeat(40)));
      console.log(section.content + '\n');

      if (section.sources.length) {
        console.log(kleur.dim('Sources:'));
        section.sources.forEach((url) => {
          console.log(kleur.dim(`• ${url}`));
        });
        console.log();
      }
    }

    console.log(kleur.bold('Conclusion'));
    console.log(kleur.dim('─'.repeat(40)));
    console.log(blogPost.conclusion);
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
