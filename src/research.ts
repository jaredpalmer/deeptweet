import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { JSDOM } from 'jsdom';
import fetch from 'node-fetch';
import kleur from 'kleur';

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
    body: JSON.stringify({ q: query, num: 3 }), // Only get top 3 results
  });

  const data = await response.json();
  return data.organic || [];
}

async function extractContent(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    const html = await response.text();
    const dom = new JSDOM(html);
    const paragraphs = dom.window.document.querySelectorAll('p');
    return Array.from(paragraphs)
      .map(p => p.textContent)
      .filter(Boolean)
      .join('\n');
  } catch (error) {
    console.error(`Failed to extract content from ${url}`);
    return '';
  }
}

import { findSimilarSentences } from './find-similar-sentences';
import { generateQuery } from './generate-query';
import { chunk } from './utils';

async function research(topic: string): Promise<BlogPost> {
  // Step 1: Generate optimized search queries
  console.log(kleur.blue('🔍 Researching: ') + topic);
  
  // Generate multiple search queries for different aspects
  const queries = await Promise.all([
    generateQuery([{ id: '1', role: 'user', content: `${topic} business impact and use cases` }]),
    generateQuery([{ id: '2', role: 'user', content: `${topic} technical implementation details` }]),
    generateQuery([{ id: '3', role: 'user', content: `${topic} market trends and analysis` }])
  ]);

  // Step 2: Search and extract content from multiple angles
  console.log(kleur.dim('Searching...'));
  const allResults = await Promise.all(queries.map(searchGoogle));
  const uniqueUrls = new Set(allResults.flat().map(r => r.link));
  
  const contents = await Promise.all(
    Array.from(uniqueUrls).map(async url => ({
      content: await extractContent(url),
      url
    }))
  );

  // Step 2.5: Find most relevant content using embeddings
  console.log(kleur.dim('Analyzing relevance...'));
  const allSentences = contents
    .map(c => c.content.split(/[.!?]+/))
    .flat()
    .filter(s => s.trim().length > 50); // Filter out short sentences

  const topSentenceIndices = await findSimilarSentences(topic, allSentences, { topK: 10 });
  const mostRelevantContent = topSentenceIndices
    .map(i => allSentences[i])
    .join('\n\n');

  // Step 3: Generate blog post outline
  console.log(kleur.dim('Creating outline...'));
  const { text: outlineJson } = await generateText({
    model: openai('gpt-4o-mini'),
    messages: [
      {
        role: 'system',
        content: `Create an outline for a technical blog post about ${topic}. 
        Return as JSON with format:
        {
          "title": "engaging title",
          "sections": [
            { "title": "section title", "key_points": ["point 1", "point 2"] }
          ]
        }`
      },
      {
        role: 'user',
        content: mostRelevantContent
      }
    ]
  });

  const outline = JSON.parse(outlineJson);

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
            Key points to cover: ${section.key_points.join(', ')}`
          },
          {
            role: 'user',
            content: `Section title: ${section.title}\n\nReference content:\n${mostRelevantContent}`
          }
        ]
      });

      return {
        title: section.title,
        content,
        sources: contents.map(c => c.url)
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
        content: 'Write a compelling executive summary for a technical blog post. Focus on the key takeaways and business value.'
      },
      {
        role: 'user',
        content: sections.map(s => s.content).join('\n\n')
      }
    ]
  });

  const { text: conclusion } = await generateText({
    model: openai('gpt-4o-mini'),
    messages: [
      {
        role: 'system',
        content: 'Write a strong conclusion for a technical blog post. Summarize key points and provide clear next steps or recommendations.'
      },
      {
        role: 'user',
        content: sections.map(s => s.content).join('\n\n')
      }
    ]
  });

  // Step 6: Final quality check and improvements
  console.log(kleur.dim('Polishing content...'));
  const { text: improvedContent } = await generateText({
    model: openai('gpt-4o-mini'),
    messages: [
      {
        role: 'system',
        content: `Review and improve this blog post. Focus on:
        1. Clear business value
        2. Technical accuracy
        3. Engaging style
        4. Actionable insights
        Return the improved version.`
      },
      {
        role: 'user',
        content: `Title: ${outline.title}\n\nSummary: ${summary}\n\n${sections.map(s => `${s.title}\n\n${s.content}`).join('\n\n')}\n\n${conclusion}`
      }
    ]
  });

  console.log(kleur.green('✓ Blog post generated!'));

  return {
    title: outline.title,
    summary,
    sections,
    conclusion
  };
}

// CLI interface
if (require.main === module) {
  const topic = process.argv[2];
  if (!topic) {
    console.error('Please provide a topic');
    process.exit(1);
  }

  research(topic)
    .then(blogPost => {
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
          section.sources.forEach(url => {
            console.log(kleur.dim(`• ${url}`));
          });
          console.log();
        }
      }

      console.log(kleur.bold('Conclusion'));
      console.log(kleur.dim('─'.repeat(40)));
      console.log(blogPost.conclusion);
    })
    .catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
}

export { research };
