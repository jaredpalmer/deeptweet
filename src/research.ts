import { generateText, generateObject } from 'ai';
import { outlineSchema, blogPostSchema } from './schemas';
import { openai } from '@ai-sdk/openai';
import kleur from 'kleur';
import path from 'path';
import 'dotenv/config';
import { writeBlogPostMarkdown } from './utils/markdown';
import { parseWeb } from './web/scrape';
import { searchGoogle } from './web/search';
import { findSimilarSentences } from './find-similar-sentences';
import { generateQuery } from './generate-query';
import { chunk } from './utils';
import { BlogPost } from './schemas';
import fs from 'fs/promises';
import { sanitizeFilename } from './utils/filename';

const MAX_N_PAGES_EMBED = 5;

async function research(topic: string): Promise<BlogPost> {
  console.log(
    kleur.bold().blue('\n🔍 Starting Research: ') + kleur.bold(topic)
  );
  console.log(kleur.dim('═'.repeat(50)));

  // Step 1: Generate optimized search queries
  const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const spinnerInterval = setInterval(() => {
    process.stdout.write(
      `\r${kleur.cyan(
        spinner[i++ % spinner.length]
      )} Generating search queries...`
    );
  }, 80);

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

  clearInterval(spinnerInterval);
  process.stdout.write('\r✓ Search queries generated\n');

  // Step 2: Search and extract content in parallel
  console.log(kleur.dim('\nPhase 1: Content Discovery'));
  console.log(kleur.dim('─'.repeat(30)));
  
  // Run searches and web parsing concurrently
  process.stdout.write(kleur.dim('Searching Google... '));
  const allResults = await Promise.all(
    queries.map(async (query, i) => {
      const results = await searchGoogle(query);
      process.stdout.write(`${kleur.green('✓')}${i < queries.length - 1 ? ', ' : '\n'}`);
      return results;
    })
  );
  const uniqueUrls = new Set(allResults.flat().map((result) => result.link));
  console.log(kleur.dim(`Found ${uniqueUrls.size} unique sources to analyze`));
  
  // Process in batches of 5 to avoid rate limits
  const urlBatches = chunk(Array.from(uniqueUrls), 5);
  const contents = [];
  let successCount = 0;
  let failCount = 0;
  
  console.log(kleur.dim('Processing sources:'));
  for (const batch of urlBatches) {
    const batchResults = await Promise.all(
      batch.map(async (url: string) => {
        process.stdout.write(kleur.dim(`  ${url.slice(0, 60)}... `));
        try {
          const result = await parseWeb(url);
          if (result.chunks.length > 0) {
            process.stdout.write(kleur.green('✓\n'));
            successCount++;
          } else {
            process.stdout.write(kleur.yellow('empty\n'));
            failCount++;
          }
          return result;
        } catch (error) {
          process.stdout.write(kleur.red('failed\n'));
          failCount++;
          return { url, chunks: [] };
        }
      })
    );
    contents.push(...batchResults);
  }

  console.log(kleur.dim('\nSource processing complete:'));
  console.log(kleur.dim(`• ${successCount} sources processed successfully`));
  console.log(kleur.dim(`• ${failCount} sources failed or were empty`));

  // Step 2.5: Process content
  console.log(kleur.dim('\nPhase 2: Content Analysis'));
  console.log(kleur.dim('─'.repeat(30)));

  // Combine all content
  const allContent = contents.map(content => ({
    text: content.chunks.join('\n\n'),
    source: {
      url: content.url,
      title: content.title || 'Untitled',
      hostname: content.hostname || new URL(content.url).hostname,
    }
  }));

  // Track sources
  const sourceList = allContent
    .map(content => content.source.url)
    .filter(Boolean);

  // Combine all content into one string
  const mostRelevantContent = allContent
    .map(content => content.text)
    .join('\n\n');

  console.log(kleur.dim(`Processing ${allContent.length} sources...`));

  // Write initial content to file
  const initialContentPath = path.join(
    'output',
    `${sanitizeFilename(topic)}-1-initial-content.md`
  );
  await fs.writeFile(initialContentPath, mostRelevantContent, 'utf-8');
  console.log(kleur.dim(`Wrote initial content to ${initialContentPath}`));

  // Show summary
  console.log(kleur.dim('\nContent Analysis Summary:'));
  console.log(kleur.dim('• ') + `${sourceList.length} sources processed`);
  
  // Show preview of first 2 sources
  console.log(kleur.dim('\nSource Preview:'));
  allContent.slice(0, 2).forEach((content, i) => {
    console.log(kleur.dim(`${i + 1}. ${content.source.hostname || 'unknown'}`));
    console.log(kleur.dim(`   ${content.source.url}\n`));
  });

  // Step 3: Generate blog post outline
  console.log(kleur.dim('\nPhase 3: Content Generation'));
  console.log(kleur.dim('─'.repeat(30)));
  process.stdout.write(kleur.dim('Creating outline... '));
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

  process.stdout.write(kleur.green('✓\n'));

  // Write outline to file
  const outlinePath = path.join(
    'output',
    `${sanitizeFilename(topic)}-2-outline.json`
  );
  await fs.writeFile(outlinePath, JSON.stringify(outline, null, 2), 'utf-8');
  console.log(kleur.dim(`Wrote outline to ${outlinePath}`));

  // Step 4: Generate sections in parallel batches
  process.stdout.write(kleur.dim('Writing sections... '));
  
  // Process sections in batches of 3 to avoid rate limits
  const sectionBatches = chunk(outline.sections, 3);
  const sections = [];
  
  for (const batch of sectionBatches) {
    const batchResults = await Promise.all(
      batch.map(async (section: any) => {
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
    sections.push(...batchResults);
    process.stdout.write(`\r${kleur.dim(`Generated ${sections.length}/${outline.sections.length} sections...`)}`);
  }

  process.stdout.write(kleur.green('✓\n'));

  // Step 5: Generate summary and conclusion in parallel
  process.stdout.write(kleur.dim('Generating summary and conclusion... '));
  const [{ text: summary }, { text: conclusion }] = await Promise.all([
    generateText({
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
    }),
    generateText({
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
    })
  ]);

  process.stdout.write(kleur.green('✓\n'));

  // Step 6: Quality Improvement
  console.log(kleur.dim('\nPhase 4: Quality Enhancement'));
  console.log(kleur.dim('─'.repeat(30)));

  process.stdout.write(kleur.dim('Starting initial polish... '));

  // Break down the content for more manageable processing
  type ContentPartType = 'section' | 'title' | 'summary' | 'conclusion';
  
  interface BaseContentPart {
    type: ContentPartType;
    content: string;
  }

  interface SectionContentPart extends BaseContentPart {
    type: 'section';
    title: string;
  }

  type ContentPart = SectionContentPart | (BaseContentPart & { type: Exclude<ContentPartType, 'section'> });

  const contentParts: ContentPart[] = [
    { type: 'title' as const, content: outline.title },
    { type: 'summary' as const, content: summary },
    ...sections.map((s) => ({
      type: 'section' as const,
      title: s.title,
      content: s.content,
    })),
    { type: 'conclusion' as const, content: conclusion },
  ];

  // Process parts in parallel batches with error handling
  const improvedParts: any[] = [];
  const partBatches = chunk(contentParts, 2); // Process 2 parts at a time
  
  for (const batch of partBatches) {
    const batchResults = await Promise.all(
      batch.map(async (part) => {
        try {
          process.stdout.write(
            `\r${kleur.dim(`Polishing ${part.type}...`.padEnd(40))}`
          );

      // Prepare content
      const content = part.type === 'section'
        ? `${(part as { title: string }).title}\n\n${part.content}`
        : part.content;

        // Process content
        const { object: improvedPart } = await generateObject({
          model: openai('gpt-4o-mini'),
          schema: blogPostSchema,
          messages: [
            {
              role: 'system',
              content: `Improve this ${part.type} section. Focus on:
1. Clear business value
2. Technical accuracy
3. Engaging style
4. Actionable insights
5. Add relevant citations using [^1] style footnotes where appropriate`,
            },
            {
              role: 'user',
              content: `${content}\n\nAvailable sources:\n${sourceList.join('\n')}`,
            },
          ],
        });

          return improvedPart;
        } catch (error) {
          console.error(kleur.red(`\nError processing ${part.type}:`), error);
          return null; // Return null for failed parts
        }
      })
    );
    
    improvedParts.push(...batchResults.filter(Boolean)); // Filter out failed parts
    process.stdout.write(`\r${kleur.dim(`Processed ${improvedParts.length}/${contentParts.length} parts...`)}`);
  }

  // Combine improved parts
  process.stdout.write(
    `\r${kleur.dim('Combining improved content...'.padEnd(40))}`
  );
  const { object: improved } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: blogPostSchema,
    messages: [
      {
        role: 'system',
        content:
          'Combine these improved sections into a cohesive blog post, maintaining all improvements and citations.',
      },
      {
        role: 'user',
        content: JSON.stringify(improvedParts),
      },
    ],
  });

  process.stdout.write(
    `\r${kleur.dim('Initial polish complete!'.padEnd(40))}${kleur.green('✓\n')}`
  );

  // Write improved version to files
  const improvedJsonPath = path.join(
    'output',
    `${sanitizeFilename(topic)}-3-improved.json`
  );
  await fs.writeFile(improvedJsonPath, JSON.stringify(improved, null, 2), 'utf-8');
  console.log(kleur.dim(`Wrote improved JSON to ${improvedJsonPath}`));

  const improvedMdPath = path.join(
    'output',
    `${sanitizeFilename(topic)}-3-improved.md`
  );
  await writeBlogPostMarkdown(improved, topic, improvedMdPath);
  console.log(kleur.dim(`Wrote improved markdown to ${improvedMdPath}`));

  console.log(kleur.dim('\nPhase 5: Final Polish'));
  console.log(kleur.dim('─'.repeat(30)));
  process.stdout.write(kleur.dim('Improving flow... '));
  const { object: final } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: blogPostSchema,
    messages: [
      {
        role: 'system',
        content: `Review this blog post and improve its flow and readability. Make sure:
1. Sections transition smoothly
2. Ideas build on each other logically
3. The narrative is compelling
4. Citations are properly placed
Keep all technical content and citations intact.`,
      },
      {
        role: 'user',
        content: JSON.stringify(improved),
      },
    ],
  });

  process.stdout.write(kleur.green('✓\n'));


  console.log(kleur.bold().green('\n✨ Blog Post Generated Successfully! ✨'));
  console.log(kleur.dim('═'.repeat(50)));
  // Calculate reading time (rough estimate: 200 words per minute)
  const wordCount = improved.content
    .map((block) => block.text.split(/\s+/).length)
    .reduce((a: number, b: number) => a + b, 0);
  const readingTime = Math.ceil(wordCount / 200);

  return {
    ...final,
    content: final.content,
    subtitle: final.subtitle,
    metadata: {
      reading_time: readingTime,
      technical_level: final.metadata.technical_level,
      business_impact: final.metadata.business_impact,
    },
    references: sourceList.map((url) => ({
      url,
      title: 'Reference',
      site: new URL(url).hostname,
    })),
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

    // Create output directory if it doesn't exist
    await fs.mkdir('output', { recursive: true });

    // Print the blog post
    console.log('\n' + kleur.bold().cyan('╭─────────────────────╮'));
    console.log(kleur.bold().cyan('│     Blog Post      │'));
    console.log(kleur.bold().cyan('╰─────────────────────╯\n'));

    console.log(kleur.bold().blue(blogPost.title));
    console.log(kleur.dim('═'.repeat(blogPost.title.length)) + '\n');

    console.log(kleur.bold('Summary'));
    console.log(kleur.dim('─'.repeat(40)));
    console.log(blogPost.summary + '\n');

    for (const block of blogPost.content) {
      if (block.type === 'heading') {
        console.log(kleur.bold(block.text));
        console.log(kleur.dim('─'.repeat(40)));
      } else {
        console.log(block.text + '\n');

        if (block.citations?.length) {
          console.log(kleur.dim('Citations:'));
          block.citations.forEach(({ url }) => {
            console.log(kleur.dim(`• ${url}`));
          });
          console.log();
        }
      }
    }
  })
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
