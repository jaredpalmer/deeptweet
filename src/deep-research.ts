import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { JSDOM, VirtualConsole } from 'jsdom';
import fetch from 'node-fetch';
import 'dotenv/config';
import kleur from 'kleur';
import PQueue from 'p-queue';
import Table from 'cli-table3';
import readline from 'readline';

interface Event {
  type: EventType;
  message: string;
  timestamp: number;
  data: Record<string, any>;
}

interface State {
  events: Event[];
  topics: Set<string>;
  insights: Insight[];
  currentTasks: Map<string, string>;
  tweetThread: string | null;
  startTime: number | null;
  isComplete: boolean;
}

interface SearchResult {
  link: string;
  title?: string;
  snippet?: string;
}

interface Insight {
  topic: string;
  summary: string;
  score: number;
  url: string;
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
  isComplete: false
};

enum EventType {
  INFO = 'info',
  SUCCESS = 'success',
  ERROR = 'error',
  TASK_START = 'task_start',
  TASK_END = 'task_end',
  INSIGHT_ADDED = 'insight_added',
  TOPIC_ADDED = 'topic_added'
}

function addEvent(type: EventType, message: string, data: Record<string, any> = {}) {
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
    const duration = ((Date.now() - (state.startTime ?? Date.now())) / 1000).toFixed(1);
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

async function discoverNewTopics(content: string, originalTopic: string): Promise<string[]> {
  const { text } = await generateText({
    model: openai('gpt-4o'),
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

async function parseWeb(url: string): Promise<string> {
  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 10000);
  const htmlString = await fetch(url, { signal: abortController.signal })
    .then((response) => response.text())
    .catch(() => null);

  if (!htmlString) return '';

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

  return text;
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

  const data = await response.json() as { organic?: SearchResult[] };
  return data.organic || [];
}

async function fetchAndExtractContent(url: string): Promise<string> {
  try {
    logger.info(`📥 Processing: ${url}`);
    const content = await parseWeb(url);
    return content.slice(0, 4000); // Limit content length
  } catch (error) {
    logger.error(`⚠️ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return '';
  }
}

async function summarizeContent(content: string): Promise<string> {
  const { text } = await generateText({
    model: openai('gpt-4o'),
    prompt: content,
    system:
      'You are a research assistant. Summarize the provided content into 2-3 key insights. Focus on factual information and interesting findings.',
  });
  return text;
}

async function generateTweetThread(research: string): Promise<string> {
  const { text } = await generateText({
    model: openai('gpt-4o'),
    messages: [
      {
        role: 'system',
        content:
          "You are a Twitter Thread Creator. Create a compelling thread from the research provided. Each tweet must be under 280 characters. Create 5-7 tweets that tell an engaging story about the topic. Format each tweet on a new line starting with a number and period (e.g. '1. First tweet').",
      },
      {
        role: 'user',
        content: research,
      },
    ],
  });
  return text;
}

async function prioritizeInsight(insight: string): Promise<number> {
  const { text } = await generateText({
    model: openai('gpt-4o'),
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

async function researchTopic(topic: string, isSubTopic: boolean = false): Promise<{ tweetThread: string; insights: Insight[] } | void> {
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

  logger.info('🔍 Searching Google...');
  try {
    searchResults = await searchGoogle(topic);
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
    logger.error(`Search failed: ${error instanceof Error ? error.message : String(error)}`);
    logger.error(`Research failed for: ${topic}`);
    logger.endTask(taskId, `❌ Research failed for: ${topic}`);
    return;
  }

  logger.log(''); // Add spacing
  logger.info('📑 Starting content analysis...');
  for (const url of urls) {
    logger.info(`📄 Processing: ${url.slice(0, 50)}...`);

    const content = await fetchAndExtractContent(url);
    if (content) {
      logger.info('✍️ Generating summary...');
      const summary = await summarizeContent(content);
      summaries.push({ url, summary });

      const score = await prioritizeInsight(summary);
      researchInsights.push({ topic, summary, score, url });

      logger.success(`📄 Processed: ${url.slice(0, 50)}`);
      logger.log(kleur.dim(`└─ ${summary.slice(0, 100)}...`));

      if (!isSubTopic) {
        logger.info('🔍 Discovering related topics...');
        const newTopics = await discoverNewTopics(content, topic);
        logger.success(`🔍 Found ${newTopics.length} related topics`);
        newTopics.forEach((t) => logger.log(kleur.dim(`└─ ${t}`)));

        for (const newTopic of newTopics) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          researchQueue.add(() => researchTopic(newTopic, true));
        }
      }
    } else {
      logger.error(`Failed to process: ${url.slice(0, 50)}`);
    }
  }
  logger.success('📑 Content analysis completed');

  if (!isSubTopic) {
    console.log(); // Add spacing
    logger.info('🔄 Processing research...');
    await researchQueue.onIdle();

    const insightsByTopic = researchInsights.reduce<Record<string, Insight[]>>((acc, insight) => {
      if (!acc[insight.topic]) acc[insight.topic] = [];
      acc[insight.topic].push(insight);
      return acc;
    }, {});

    const topInsights = Object.entries(insightsByTopic)
      .map(([topic, insights]) => {
        const topicInsights = (insights as Insight[])
          .sort((a: Insight, b: Insight) => b.score - a.score)
          .slice(0, 3)
          .map((i: Insight) => `• ${i.summary}`)
          .join('\n');
        return `Topic: ${topic}\n${topicInsights}`;
      })
      .join('\n\n');

    tweetThread = await generateTweetThread(topInsights);
    logger.success('🔄 Research processing completed');
  }

  if (!isSubTopic) {
    logger.success(`✨ Completed research: ${topic}`);

    console.log(kleur.bold().cyan('\n📊 Summary'));
    console.log(kleur.dim('─'.repeat(40)));
    console.log(kleur.blue(`› Topic: ${topic}`));
    const relatedTopics = Array.from(discoveredTopics).slice(1);
    if (relatedTopics.length) {
      console.log(
        kleur.blue(
          `› Related: ${relatedTopics.slice(0, 3).join(', ')}${
            relatedTopics.length > 3 ? '...' : ''
          }`
        )
      );
    }
    console.log(kleur.blue(`› Insights: ${researchInsights.length}`));
    console.log(kleur.dim('─'.repeat(40)));

    displayInsightsTable(researchInsights);

    console.log(kleur.bold().cyan('\n🧵 Tweet Thread'));
    console.log(kleur.dim('─'.repeat(40)));
    console.log(kleur.blue(tweetThread || ''));

    return { tweetThread: tweetThread || '', insights: researchInsights };
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
