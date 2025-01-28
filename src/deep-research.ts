import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { JSDOM, VirtualConsole } from 'jsdom';
import fetch from 'node-fetch';
import 'dotenv/config';
import kleur from 'kleur';
import PQueue from 'p-queue';
import Table from 'cli-table3';
import readline from 'readline';
import { generateQuery } from './generate-query.js';
import { chunk } from './utils.js';
import { findSimilarSentences } from './find-similar-sentences.js';
import { critiquePaper, improveSection } from './agents.js';

interface State {
  events: Array<{
    type: 'info' | 'success' | 'error';
    message: string;
    timestamp: number;
  }>;
  startTime: number | null;
  isComplete: boolean;
  costs: {
    tokens: number;
    cost: number;
  };
}

interface SearchResult {
  link: string;
  title?: string;
  snippet?: string;
  text?: string;
  hostname?: string;
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

interface BlogPost {
  title: string;
  content: string;
  source: string;
  businessValue: string;
  technicalInsights: string[];
}

interface ContentContext {
  url: string;
  content: string;
  businessValue: string;
  technicalInsights: string[];
  marketContext: string[];
  relevanceScore: number;
}

type TaskId = string;

// State management
const state: State = {
  events: [],
  topics: new Set<string>(),
  insights: [],
  currentTasks: new Map<string, string>(),
  tweetThread: null,
  startTime: null,
  isComplete: false,
};

enum EventType {
  INFO = 'info',
  SUCCESS = 'success',
  ERROR = 'error',
  TASK_START = 'task_start',
  TASK_END = 'task_end',
  INSIGHT_ADDED = 'insight_added',
  TOPIC_ADDED = 'topic_added',
}

function addEvent(
  type: EventType,
  message: string,
  data: Record<string, any> = {}
) {
  state.events.push({
    type,
    message,
    timestamp: Date.now(),
    data,
  });
  render();
}

function clearScreen() {
  process.stdout.write('\x1Bc');
}

function render() {
  clearScreen();

  // Print compact header
  console.log(kleur.bold().cyan('╭── DeepTweet Research ──╮'));

  // Show stats
  const stats = [
    `Topics: ${state.topics.size}`,
    `Tasks: ${state.currentTasks.size}`,
    `Events: ${state.events.length}`,
  ].join(' │ ');
  console.log(kleur.dim(`${stats}\n`));

  // Print active tasks (max 3)
  if (state.currentTasks.size > 0) {
    const tasks = Array.from(state.currentTasks.values()).slice(-3);
    console.log(kleur.yellow('⚡ Active:'));
    tasks.forEach((task) => {
      console.log(kleur.dim(`› ${task}`));
    });
    console.log();
  }

  // Print recent events (last 6)
  console.log(kleur.yellow('📝 Recent:'));
  state.events.slice(-6).forEach((event) => {
    const icons = {
      [EventType.INFO]: '→',
      [EventType.SUCCESS]: '✓',
      [EventType.ERROR]: '✗',
      [EventType.TASK_START]: '▶',
      [EventType.TASK_END]: '■',
      [EventType.INSIGHT_ADDED]: '✧',
      [EventType.TOPIC_ADDED]: '+',
    };

    const colors = {
      [EventType.INFO]: kleur.blue,
      [EventType.SUCCESS]: kleur.green,
      [EventType.ERROR]: kleur.red,
      [EventType.TASK_START]: kleur.yellow,
      [EventType.TASK_END]: kleur.green,
      [EventType.INSIGHT_ADDED]: kleur.magenta,
      [EventType.TOPIC_ADDED]: kleur.cyan,
    };

    const icon = icons[event.type];
    const colorFn = colors[event.type];
    console.log(colorFn(`${icon} ${event.message}`));
  });

  // Print completion status
  if (state.isComplete) {
    const duration = (
      (Date.now() - (state.startTime ?? Date.now())) /
      1000
    ).toFixed(1);
    console.log(kleur.dim(`\n⏱️  Done in ${duration}s`));
  }
}

// Logger class to manage state events
class Logger {
  private taskId: number;

  constructor() {
    this.taskId = 0;
  }

  startTask(message: string): TaskId {
    const id = `task-${++this.taskId}`;
    state.currentTasks.set(id, message);
    addEvent(EventType.TASK_START, message);
    return id;
  }

  endTask(id: TaskId, message: string): void {
    state.currentTasks.delete(id);
    addEvent(EventType.TASK_END, message);
  }

  log(message: string): void {
    addEvent(EventType.INFO, message);
  }

  success(message: string): void {
    addEvent(EventType.SUCCESS, message);
  }

  error(message: string): void {
    addEvent(EventType.ERROR, message);
  }

  info(message: string): void {
    addEvent(EventType.INFO, message);
  }

  addInsight(insight: Insight): void {
    state.insights.push(insight);
    addEvent(EventType.INSIGHT_ADDED, `New insight for ${insight.topic}`);
  }

  addTopic(topic: string): void {
    state.topics.add(topic);
    addEvent(EventType.TOPIC_ADDED, `New topic: ${topic}`);
  }
}

const logger = new Logger();

function printBanner(topic: string): void {
  console.log('\n' + kleur.bold().cyan('╭─────────────────────────────────╮'));
  console.log(kleur.bold().cyan('│      DeepTweet Research Tool      │'));
  console.log(kleur.bold().cyan('╰─────────────────────────────────╯\n'));
  console.log(kleur.bold().yellow(`🎯 Researching: "${topic}"\n`));
}

function logError(message: string, details: string = ''): void {
  console.log(kleur.red().bold('\n╭─ ERROR ────────────────────╮'));
  console.log(kleur.red().bold('│ ') + message);
  if (details) {
    console.log(kleur.red().dim('│ ' + details));
  }
  console.log(kleur.red().bold('╰────────────────────────────╯\n'));
}

function displayInsightsTable(insights: Insight[]): void {
  // Group insights by topic
  const byTopic = insights.reduce<Record<string, Insight[]>>((acc, insight) => {
    if (!acc[insight.topic]) acc[insight.topic] = [];
    acc[insight.topic].push(insight);
    return acc;
  }, {});

  Object.entries(byTopic).forEach(([topic, topicInsights]) => {
    console.log(kleur.bold().cyan(`\n${topic}`));

    // Sort by score and take top 3
    topicInsights
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .forEach(({ score, summary }) => {
        const scoreStr = '★'.repeat(Math.round(score / 2));
        console.log(
          kleur.yellow(scoreStr) +
            kleur.dim('☆'.repeat(5 - Math.round(score / 2)))
        );
        console.log(kleur.dim(summary.slice(0, 120) + '...\n'));
      });
  });
}

function setupKeyboardControls() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  process.stdin.on('keypress', (str, key) => {
    if (key.ctrl && key.name === 'c') {
      process.exit();
    } else if (key.name === 'q') {
      console.log(kleur.yellow('\n🛑 Research cancelled by user\n'));
      process.exit();
    }
  });

  console.log(kleur.dim('\n📋 Controls: Ctrl+C to exit, Q to cancel\n'));
}

// Topic discovery and research state
const researchQueue = new PQueue({ concurrency: 1 }); // Reduce concurrency for clearer output
const discoveredTopics = new Set();
const researchInsights: Insight[] = [];
const MAX_TOPICS = 3;

async function discoverNewTopics(
  content: string,
  originalTopic: string
): Promise<string[]> {
  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    messages: [
      {
        role: 'system',
        content:
          'You are a research assistant. Analyze the content and identify 2-3 related subtopics that would be valuable to research further. Topics should be specific and focused. Format as a numbered list.',
      },
      {
        role: 'user',
        content: `Original topic: ${originalTopic}\n\nContent to analyze:\n${content}`,
      },
    ],
  });

  // Parse numbered list format
  return text
    .split('\n')
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

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
  const textElTags = 'p';
  const paragraphs = document.querySelectorAll(textElTags);
  if (!paragraphs.length) {
    throw new Error(`webpage doesn't have any "${textElTags}" element`);
  }
  const paragraphTexts = Array.from(paragraphs).map((p) => p.textContent);

  // combine text contents from paragraphs and then remove newlines and multiple spaces
  const text = paragraphTexts.join(' ').replace(/ {2}|\r\n|\n|\r/gm, '');

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

interface ContentContext {
  url: string;
  content: string;
  businessValue: string;
  technicalInsights: string[];
  marketContext: string[];
  relevanceScore: number;
}

async function fetchAndExtractContent(url: string, topic: string, plan: any): Promise<ContentContext | null> {
  try {
    logger.info(`📥 Processing: ${url}`);
    const rawContent = await parseWeb(url);
    
    // Evaluate content relevance and extract insights
    const { text: analysisText } = await withCosts(state.costs, generateText({
      model: openai('gpt-4o-mini'),
      messages: [
        {
          role: 'system',
          content: `Analyze this content for a blog post about ${topic}.
          Focus on:
          ${plan.keyQuestions.map(q => `- ${q}`).join('\n')}
          
          Return JSON format: {
            "relevanceScore": number 0-10,
            "businessValue": "key business insight",
            "technicalInsights": string[],
            "marketContext": string[],
            "relevantContent": "extracted relevant text"
          }`
        },
        { role: 'user', content: rawContent.join('\n') }
      ]
    }));

    const analysis = JSON.parse(analysisText);
    
    if (analysis.relevanceScore < 6) {
      return null;
    }

    return {
      url,
      content: analysis.relevantContent,
      businessValue: analysis.businessValue,
      technicalInsights: analysis.technicalInsights,
      marketContext: analysis.marketContext,
      relevanceScore: analysis.relevanceScore
    };
  } catch (error) {
    logger.error(
      `⚠️ Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    return null;
  }
}

async function summarizeContent(content: string): Promise<string> {
  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    prompt: content,
    system:
      'You are a research assistant. Summarize the provided content into 2-3 key insights. Focus on factual information and interesting findings.',
  });
  return text;
}

async function generateResearchPaper(
  topic: string,
  insights: Insight[],
  sources: Source[],
  logger: Logger
): Promise<ResearchPaper> {
  const MAX_IMPROVEMENT_ITERATIONS = 2;
  logger.info('📝 Generating paper outline...');

  // Generate outline, abstract, and introduction in parallel
  const [outlineResult, abstractResult] = await Promise.all([
    generateText({
      model: openai('gpt-4o-mini'),
      messages: [
        {
          role: 'system',
          content:
            'You are a research paper outline generator. Create a detailed outline for an academic paper on the given topic. Include main sections and subsections. Format as a hierarchical list.',
        },
        {
          role: 'user',
          content: `Topic: ${topic}\n\nKey insights:\n${insights
            .map((i) => `- ${i.summary}`)
            .join('\n')}`,
        },
      ],
    }),
    generateText({
      model: openai('gpt-4o-mini'),
      messages: [
        {
          role: 'system',
          content:
            'You are a research paper abstract writer. Write a compelling abstract that summarizes the key findings and importance of this research.',
        },
        {
          role: 'user',
          content: `Topic: ${topic}\n\nKey insights:\n${insights
            .map((i) => `- ${i.summary}`)
            .join('\n')}`,
        },
      ],
    }),
  ]);

  const outlineText = outlineResult.text;
  const abstract = abstractResult.text;

  logger.info('📝 Generating introduction...');
  const { text: introduction } = await generateText({
    model: openai('gpt-4o-mini'),
    messages: [
      {
        role: 'system',
        content:
          'You are a research paper introduction writer. Write an engaging introduction that sets up the topic, provides background, and outlines the paper structure.',
      },
      {
        role: 'user',
        content: `Topic: ${topic}\n\nOutline:\n${outlineText}\n\nAbstract:\n${abstract}`,
      },
    ],
  });

  logger.info('📝 Generating paper sections...');
  const sections = await generateSections(
    outlineText,
    insights,
    sources,
    logger
  );

  logger.info('📝 Generating conclusion...');
  const { text: conclusion } = await generateText({
    model: openai('gpt-4o-mini'),
    messages: [
      {
        role: 'system',
        content:
          'You are a research paper conclusion writer. Summarize the key findings, implications, and future directions.',
      },
      {
        role: 'user',
        content: `Topic: ${topic}\n\nIntroduction:\n${introduction}\n\nKey sections:\n${sections
          .map((s) => s.title)
          .join('\n')}`,
      },
    ],
  });

  // Initial paper generation
  const initialPaper = {
    title: `${topic}: A Comprehensive Analysis`,
    abstract,
    introduction,
    sections,
    conclusion,
    references: sources,
  };

  // Iterative improvement process
  let currentPaper = initialPaper;
  for (let i = 0; i < MAX_IMPROVEMENT_ITERATIONS; i++) {
    logger.info(
      `📋 Running critique iteration ${i + 1}/${MAX_IMPROVEMENT_ITERATIONS}...`
    );

    // Critique current version
    const paperContent = [
      currentPaper.abstract,
      currentPaper.introduction,
      ...currentPaper.sections.map((s) => s.content),
      currentPaper.conclusion,
    ].join('\n\n');

    const critique = await critiquePaper(paperContent);
    logger.info(`📊 Paper quality score: ${critique.score}/10`);

    if (critique.score >= 8) {
      logger.success('✨ Paper meets quality threshold');
      break;
    }

    // Improve sections based on critique
    logger.info('📝 Implementing improvements...');
    const [improvedAbstract, improvedIntro, improvedConclusion] =
      await Promise.all([
        improveSection(currentPaper.abstract, critique),
        improveSection(currentPaper.introduction, critique),
        improveSection(currentPaper.conclusion, critique),
      ]);

    const improvedSections = await Promise.all(
      currentPaper.sections.map(async (section) => ({
        ...section,
        content: await improveSection(section.content, critique),
      }))
    );

    currentPaper = {
      ...currentPaper,
      abstract: improvedAbstract,
      introduction: improvedIntro,
      sections: improvedSections,
      conclusion: improvedConclusion,
    };
  }

  logger.success('✨ Paper structure complete');
  return currentPaper;
}

async function generateSections(
  outline: string,
  insights: Insight[],
  sources: Source[],
  logger: Logger
): Promise<Section[]> {
  const sections: Section[] = [];
  const outlineLines = outline.split('\n').filter(Boolean);
  const mainSections = outlineLines.filter((line) => !line.startsWith('  '));

  logger.info(`📑 Processing ${mainSections.length} main sections...`);

  // Process sections in parallel with a concurrency limit
  const sectionQueue = new PQueue({ concurrency: 2 });

  const generateSection = async (
    line: string,
    index: number
  ): Promise<Section> => {
    logger.info(
      `📄 Generating section ${index + 1}/${
        mainSections.length
      }: ${line.replace(/^\d+\.\s*/, '')}`
    );

    const { text: sectionContent } = await generateText({
      model: openai('gpt-4o-mini'),
      messages: [
        {
          role: 'system',
          content:
            'You are a research paper section writer. Write a detailed section incorporating relevant insights and citing sources.',
        },
        {
          role: 'user',
          content: `Section title: ${line}\n\nRelevant insights:\n${insights
            .filter((i) => i.summary.toLowerCase().includes(line.toLowerCase()))
            .map((i) => `- ${i.summary} (${i.url})`)
            .join('\n')}`,
        },
      ],
    });

    const section: Section = {
      title: line.replace(/^\d+\.\s*/, ''),
      content: sectionContent,
      sources: sources.filter((s) => sectionContent.includes(s.url)),
      subsections: [],
    };

    logger.success(`✓ Completed section: ${section.title}`);
    return section;
  };

  const sectionPromises = mainSections.map((line, index) =>
    sectionQueue.add(() => generateSection(line, index))
  ) as Promise<Section>[];

  const completedSections = await Promise.all(sectionPromises);
  sections.push(...completedSections.filter(Boolean));

  return sections;
}

async function prioritizeInsight(insight: string): Promise<number> {
  const { text } = await generateText({
    model: openai('gpt-4o-mini'),
    messages: [
      {
        role: 'system',
        content:
          'You are a research assistant. Rate the following insight from 1-10 based on: novelty, factual content, and potential interest to readers. Return only the number.',
      },
      {
        role: 'user',
        content: insight,
      },
    ],
  });
  const score = parseInt(text.trim(), 10) || 5;
  return score;
}

async function researchTopic(
  topic: string,
  isSubTopic: boolean = false,
  parentTopic?: string
): Promise<{ tweetThread: string; insights: Insight[] } | void> {
  const startTime = Date.now();

  if (!isSubTopic) {
    printBanner(topic);
    setupKeyboardControls();
  }
  if (discoveredTopics.has(topic) || discoveredTopics.size >= MAX_TOPICS) {
    return;
  }
  discoveredTopics.add(topic);

  let searchResults, urls, tweetThread;
  const summaries = [];

  const taskId = logger.startTask(`🔬 Researching: ${topic}`);
  logger.log(''); // Add spacing

  logger.info('🔍 Generating optimized search query...');
  try {
    const messages = [
      {
        id: `msg-${Date.now()}`,
        role: 'user' as const,
        content: parentTopic
          ? `This is related to "${parentTopic}". I want to learn about: ${topic}`
          : topic,
      },
    ];
    const searchQuery = await generateQuery(messages);
    logger.info(`🔍 Searching for: ${searchQuery}`);
    searchResults = await searchGoogle(searchQuery);
    urls = [
      ...new Set(
        searchResults
          .map((result) => result.link)
          .filter((url) => url && url.startsWith('http'))
      ),
    ].slice(0, 4);
    logger.success('🔍 Found ' + urls.length + ' relevant sources');
    urls.forEach((url) => logger.log(kleur.dim(`└─ ${url}`)));
  } catch (error) {
    logger.error(
      `Search failed: ${error instanceof Error ? error.message : String(error)}`
    );
    logger.error(`Research failed for: ${topic}`);
    logger.endTask(taskId, `❌ Research failed for: ${topic}`);
    return;
  }

  logger.log(''); // Add spacing
  logger.info('📑 Starting content analysis...');
  for (const url of urls) {
    logger.info(`📄 Processing: ${url.slice(0, 50)}...`);

    const contentChunks = await fetchAndExtractContent(url);
    if (contentChunks.length > 0) {
      logger.info('🔍 Finding most relevant content...');
      const relevantIndices = await findSimilarSentences(topic, contentChunks, {
        topK: 3,
      });
      const relevantContent = relevantIndices
        .map((idx) => contentChunks[idx])
        .join(' ');

      logger.info('✍️ Generating summary...');
      const summary = await summarizeContent(relevantContent);
      summaries.push({ url, summary });

      const score = await prioritizeInsight(summary);
      researchInsights.push({ topic, summary, score, url });

      logger.success(`📄 Processed: ${url.slice(0, 50)}`);
      logger.log(kleur.dim(`└─ ${summary.slice(0, 100)}...`));

      if (!isSubTopic) {
        logger.info('🔍 Discovering related topics...');
        const newTopics = await discoverNewTopics(relevantContent, topic);
        logger.success(`🔍 Found ${newTopics.length} related topics`);
        newTopics.forEach((t) => logger.log(kleur.dim(`└─ ${t}`)));

        for (const newTopic of newTopics) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          researchQueue.add(() => researchTopic(newTopic, true, topic));
        }
      }
    } else {
      logger.error(`Failed to process: ${url.slice(0, 50)}`);
    }
  }
  logger.success('📑 Content analysis completed');

  if (!isSubTopic) {
    logger.info('🔄 Processing research...');
    await researchQueue.onIdle();

    const sources = summaries.map((s) => ({
      url: s.url,
      content: s.summary,
      relevance: researchInsights.find((i) => i.url === s.url)?.score || 5,
    }));

    logger.info('📝 Generating research paper...');
    const paper = await generateResearchPaper(
      topic,
      researchInsights,
      sources,
      logger
    );

    // Display paper with better formatting
    console.log(
      '\n' + kleur.bold().cyan('╭─────────────────────────────────╮')
    );
    console.log(kleur.bold().cyan('│         Research Paper            │'));
    console.log(kleur.bold().cyan('╰─────────────────────────────────╯\n'));

    // Title
    console.log(kleur.bold().blue(paper.title));
    console.log(kleur.dim('═'.repeat(paper.title.length)));
    console.log();

    // Abstract
    console.log(kleur.bold().yellow('Abstract'));
    console.log(kleur.dim('─'.repeat(40)));
    console.log(paper.abstract);
    console.log();

    // Introduction
    console.log(kleur.bold().yellow('Introduction'));
    console.log(kleur.dim('─'.repeat(40)));
    console.log(paper.introduction);
    console.log();

    // Sections
    for (const section of paper.sections) {
      console.log(kleur.bold().yellow(section.title));
      console.log(kleur.dim('─'.repeat(40)));
      console.log(section.content);

      if (section.sources.length > 0) {
        console.log(kleur.dim('\nSection Sources:'));
        section.sources.forEach((source) => {
          console.log(kleur.dim(`• ${source.url}`));
        });
      }
      console.log();
    }

    // Conclusion
    console.log(kleur.bold().yellow('Conclusion'));
    console.log(kleur.dim('─'.repeat(40)));
    console.log(paper.conclusion);
    console.log();

    // References
    console.log(kleur.bold().yellow('References'));
    console.log(kleur.dim('─'.repeat(40)));
    paper.references.forEach((ref, i) => {
      console.log(`[${i + 1}] ${ref.url}`);
    });
    console.log();

    state.isComplete = true;
    return { tweetThread: '', insights: researchInsights };
  }
}

// Example usage
const topic = process.argv[2];
if (!topic) {
  console.error('Please provide a search topic as an argument');
  process.exit(1);
}

researchTopic(topic).catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
