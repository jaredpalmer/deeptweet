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
import { researchAgents } from './agents';
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
  const [allResults, initialEmbedding] = await Promise.all([
    Promise.all(queries.map(searchGoogle)),
    // Start embedding the topic early
    embedMany({
      model: openai.embedding('text-embedding-3-small'),
      values: [topic],
    })
  ]);

  const uniqueUrls = new Set(allResults.flat().map((r) => r.link));
  
  // Process in batches of 5 to avoid rate limits
  const urlBatches = chunk(Array.from(uniqueUrls), 5);
  const contents = [];
  
  for (const batch of urlBatches) {
    const batchResults = await Promise.all(batch.map(parseWeb));
    contents.push(...batchResults);
    process.stdout.write(`\r${kleur.dim(`Processed ${contents.length}/${uniqueUrls.size} sources...`)}`);
  }

  console.log(kleur.green(`✓ Found ${uniqueUrls.size} unique sources`));

  // Step 2.5: Find most relevant content using embeddings
  console.log(kleur.dim('\nPhase 2: Content Analysis'));
  console.log(kleur.dim('─'.repeat(30)));

  // Process chunks
  process.stdout.write(kleur.dim('Processing content chunks... '));
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
  process.stdout.write(kleur.green('✓\n'));
  console.log(kleur.dim(`Found ${allSentences.length} content chunks`));

  // Find most relevant content
  process.stdout.write(kleur.dim('Analyzing relevance with embeddings... '));
  const sentences = allSentences.map((s) => s.text);
  const topSentenceIndices = await findSimilarSentences(topic, sentences, {
    topK: 10,
  });
  process.stdout.write(kleur.green('✓\n'));

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
  const sourceList = contentSources.map((source) => source.url).filter(Boolean);

  // Write initial content to file
  const initialContentPath = path.join(
    'output',
    `${sanitizeFilename(topic)}-1-initial-content.md`
  );
  await fs.writeFile(initialContentPath, mostRelevantContent, 'utf-8');
  console.log(kleur.dim(`Wrote initial content to ${initialContentPath}`));

  // Show summary of findings
  console.log(kleur.dim('\nContent Analysis Summary:'));
  console.log(
    kleur.dim('• ') +
      `${relevantContent.length} most relevant passages selected`
  );
  console.log(
    kleur.dim('• ') + `${sourceList.length} unique sources identified`
  );

  // Show a preview of top content (first 100 chars of first 2 passages)
  console.log(kleur.dim('\nTop Passages Preview:'));
  relevantContent.slice(0, 2).forEach((content, i) => {
    const preview = content.text.slice(0, 100).trim() + '...';
    console.log(kleur.dim(`${i + 1}. `) + preview);
    console.log(
      kleur.dim(`   Source: ${content.source.hostname || 'unknown'}\n`)
    );
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
    `${sanitizeFilename(topic)}-2-outline.md`
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
  type ContentPart = 
    | { type: 'section'; title: string; content: string }
    | { type: 'title' | 'summary' | 'conclusion'; content: string };

  const contentParts: ContentPart[] = [
    { type: 'title', content: outline.title },
    { type: 'summary', content: summary },
    ...sections.map((s) => ({
      type: 'section',
      title: s.title,
      content: s.content,
    })),
    { type: 'conclusion', content: conclusion },
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

      // Check token count
      const tokenCount = estimateTokenCount(content);
      if (tokenCount > 30000) {
        console.log(kleur.yellow(`\nWarning: Content too large (${tokenCount} tokens), splitting...`));
        const chunks = splitForTokenLimit(content);
        console.log(kleur.dim(`Split into ${chunks.length} chunks`));

        // Process each chunk
        const improvedChunks = await Promise.all(chunks.map(async (chunk, i) => {
          process.stdout.write(
            `\r${kleur.dim(`Processing chunk ${i + 1}/${chunks.length}...`.padEnd(40))}`
          );
          
          const { object: improved } = await generateObject({
            model: openai('gpt-4o-mini'),
            schema: blogPostSchema,
            messages: [
              {
                role: 'system',
                content: `Improve this ${part.type} section chunk. Focus on:
1. Clear business value
2. Technical accuracy
3. Engaging style
4. Actionable insights
5. Add relevant citations using [^1] style footnotes where appropriate`,
              },
              {
                role: 'user',
                content: `${chunk}\n\nAvailable sources:\n${sourceList.join('\n')}`,
              },
            ],
          });
          return improved;
        }));

        // Combine chunks
        const { object: combinedImprovement } = await generateObject({
          model: openai('gpt-4o-mini'),
          schema: blogPostSchema,
          messages: [
            {
              role: 'system',
              content: 'Combine these improved chunks into a cohesive section, maintaining all improvements and citations.',
            },
            {
              role: 'user',
              content: JSON.stringify(improvedChunks),
            },
          ],
        });

        improvedParts.push(combinedImprovement);
      } else {
        // Process normally if within token limit
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

  // Write improved version to file
  const improvedPath = path.join(
    'output',
    `${sanitizeFilename(topic)}-3-improved.md`
  );
  await writeBlogPostMarkdown(improved, topic, improvedPath);
  console.log(kleur.dim(`Wrote improved version to ${improvedPath}`));

  // Step 7: Expert Review & Improvements
  console.log(kleur.dim('\nPhase 5: Expert Review'));
  console.log(kleur.dim('─'.repeat(30)));

  const agentAnalyses = await Promise.all(
    researchAgents.map(async (agent) => {
      process.stdout.write(kleur.dim(`${agent.name}... `));
      process.stdout.write(kleur.green('✓ '));
      const feedback = await agent.analyze(JSON.stringify(improved));
      return {
        agent: agent.name,
        feedback,
      };
    })
  );

  // Consolidate agent feedback
  const { text: consolidatedFeedback } = await generateText({
    model: openai('gpt-4o-mini'),
    messages: [
      {
        role: 'system',
        content: `You are a senior editor. Review the expert feedback and provide specific improvements needed. Focus on:
1. Business value improvements suggested by BusinessValueAnalyst
2. Technical accuracy issues found by FactChecker
3. Areas needing more depth from DepthAnalyst
4. Narrative improvements from Synthesizer`,
      },
      {
        role: 'user',
        content: `Expert feedback:\n${agentAnalyses
          .map((a) => `${a.agent}:\n${a.feedback}\n`)
          .join('\n')}`,
      },
    ],
  });

  // Apply improvements based on agent feedback
  console.log(kleur.dim('Applying expert suggestions...'));
  const { object: expertImproved } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: blogPostSchema,
    messages: [
      {
        role: 'system',
        content: `Improve this blog post based on expert feedback. Make sure to:
1. Strengthen business value and strategic insights
2. Fix any technical inaccuracies
3. Add depth where recommended
4. Improve narrative flow and connections
Keep all citations and maintain the overall structure.`,
      },
      {
        role: 'user',
        content: `Original post:\n${JSON.stringify(
          improved
        )}\n\nExpert feedback:\n${consolidatedFeedback}`,
      },
    ],
  });

  console.log(kleur.dim('\nPhase 6: Final Polish'));
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
        content: JSON.stringify(expertImproved),
      },
    ],
  });

  process.stdout.write(kleur.green('✓\n'));

  // Write expert improved version to file
  const expertPath = path.join(
    'output',
    `${sanitizeFilename(topic)}-4-expert-improved.md`
  );
  await writeBlogPostMarkdown(expertImproved, topic, expertPath);
  console.log(kleur.dim(`Wrote expert improved version to ${expertPath}`));

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
