import { generateText, generateObject } from 'ai';
import { outlineSchema, blogPostSchema } from './schemas';
import { openai } from '@ai-sdk/openai';
import kleur from 'kleur';
import 'dotenv/config';
import { writeBlogPostMarkdown } from './utils/markdown';
import { parseWeb } from './web/scrape';
import { searchGoogle } from './web/search';
import { findSimilarSentences } from './find-similar-sentences';
import { generateQuery } from './generate-query';
import { chunk } from './utils';
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

const MAX_N_PAGES_EMBED = 5;

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

  const contents = await Promise.all(Array.from(uniqueUrls).map(parseWeb));

  // Step 2.5: Find most relevant content using embeddings
  console.log(kleur.dim('Analyzing relevance...'));
  const allSentences = contents.flatMap((content) => {
    return content.chunks
      .filter((s) => s.trim().length > 50) // Filter out short chunks
      .map((chunk) => ({
        text: chunk,
        source: {
          url: content.url,
          title: content.title,
          hostname: content.hostname,
        },
      }));
  });

  const sentences = allSentences.map((s) => s.text);

  const topSentenceIndices = await findSimilarSentences(topic, sentences, {
    topK: 10,
  });
  // Get the most relevant content with their sources
  const relevantContent = topSentenceIndices.map((i) => allSentences[i]);
  const mostRelevantContent = relevantContent.map((c) => c.text).join('\n\n');

  // Track which sources were used
  const usedSources = new Set<string>();
  const contentSources = relevantContent
    .map((c) => c.source)
    .filter((source) => {
      if (!source.url || usedSources.has(source.url)) return false;
      usedSources.add(source.url);
      return true;
    });

  // Get formatted source list for citations
  const sourceList = contentSources
    .map(source => source.url)
    .filter(Boolean);

  // Step 3: Generate blog post outline
  console.log(kleur.dim('Creating outline...'));
  const { object: outline } = await generateObject({
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
        sources: sourceList,
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
  const { object: improved } = await generateObject({
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
  // Calculate reading time (rough estimate: 200 words per minute)
  const wordCount = improved.sections
    .map(s => s.content.split(/\s+/).length)
    .reduce((a, b) => a + b, 0);
  const readingTime = Math.ceil(wordCount / 200);

  return {
    ...improved,
    sections: improved.sections.map((s) => ({
      ...s,
      sources: sourceList,
    })),
    metadata: {
      reading_time: readingTime,
      technical_level: Math.round(
        improved.sections.reduce((acc, s) => acc + s.technical_depth, 0) /
          improved.sections.length
      ),
      business_impact: Math.round(
        improved.sections.reduce((acc, s) => acc + s.business_value, 0) /
          improved.sections.length
      )
    }
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
  .then(async (blogPost) => {
    // Write markdown file
    const outputPath = await writeBlogPostMarkdown(blogPost, topic);
    console.log(kleur.green(`\n✓ Blog post written to: ${outputPath}\n`));

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
