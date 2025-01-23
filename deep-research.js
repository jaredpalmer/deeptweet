import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { JSDOM, VirtualConsole } from 'jsdom';
import fetch from 'node-fetch';
import 'dotenv/config';
import kleur from 'kleur';
import PQueue from 'p-queue';
import Table from 'cli-table3';
import readline from 'readline';

// State management
const state = {
  events: [],
  topics: new Set(),
  insights: [],
  currentTasks: new Map(),
  tweetThread: null,
  startTime: null,
  isComplete: false
};

const EventType = {
  INFO: 'info',
  SUCCESS: 'success',
  ERROR: 'error',
  TASK_START: 'task_start',
  TASK_END: 'task_end',
  INSIGHT_ADDED: 'insight_added',
  TOPIC_ADDED: 'topic_added'
};

function addEvent(type, message, data = {}) {
  state.events.push({
    type,
    message,
    timestamp: Date.now(),
    data
  });
  render();
}

function clearScreen() {
  process.stdout.write('\x1Bc');
}

function render() {
  clearScreen();
  
  // Print banner
  console.log('\n' + kleur.bold().cyan('╭─────────────────────────────────╮'));
  console.log(kleur.bold().cyan('│      DeepTweet Research Tool      │'));
  console.log(kleur.bold().cyan('╰─────────────────────────────────╯\n'));

  // Print current tasks
  if (state.currentTasks.size > 0) {
    console.log(kleur.bold().yellow('🔄 Current Tasks:'));
    state.currentTasks.forEach((task, id) => {
      console.log(kleur.dim(`└─ ${task}`));
    });
    console.log();
  }

  // Print recent events (last 10)
  console.log(kleur.bold().yellow('📋 Recent Activity:'));
  state.events.slice(-10).forEach(event => {
    const prefix = {
      [EventType.INFO]: kleur.blue('ℹ'),
      [EventType.SUCCESS]: kleur.green('✓'),
      [EventType.ERROR]: kleur.red('✗'),
      [EventType.TASK_START]: kleur.yellow('→'),
      [EventType.TASK_END]: kleur.green('←'),
      [EventType.INSIGHT_ADDED]: kleur.magenta('💡'),
      [EventType.TOPIC_ADDED]: kleur.cyan('🔍')
    }[event.type];
    
    console.log(`${prefix} ${event.message}`);
  });

  // Print completion status if done
  if (state.isComplete) {
    const duration = ((Date.now() - state.startTime) / 1000).toFixed(1);
    console.log(kleur.dim(`\n⏱️  Research completed in ${duration}s`));
    
    if (state.tweetThread) {
      console.log('\n' + kleur.bold().cyan('🧵 Generated Tweet Thread:'));
      console.log(kleur.blue(state.tweetThread));
    }
  }
}

// Logger class to manage state events
class Logger {
  constructor() {
    this.taskId = 0;
  }

  startTask(message) {
    const id = `task-${++this.taskId}`;
    state.currentTasks.set(id, message);
    addEvent(EventType.TASK_START, message);
    return id;
  }

  endTask(id, message) {
    state.currentTasks.delete(id);
    addEvent(EventType.TASK_END, message);
  }

  log(message) {
    addEvent(EventType.INFO, message);
  }

  success(message) {
    addEvent(EventType.SUCCESS, message);
  }

  error(message) {
    addEvent(EventType.ERROR, message);
  }

  info(message) {
    addEvent(EventType.INFO, message);
  }

  addInsight(insight) {
    state.insights.push(insight);
    addEvent(EventType.INSIGHT_ADDED, `New insight for ${insight.topic}`);
  }

  addTopic(topic) {
    state.topics.add(topic);
    addEvent(EventType.TOPIC_ADDED, `New topic: ${topic}`);
  }
}

const logger = new Logger();

function printBanner(topic) {
  console.log('\n' + kleur.bold().cyan('╭─────────────────────────────────╮'));
  console.log(kleur.bold().cyan('│      DeepTweet Research Tool      │'));
  console.log(kleur.bold().cyan('╰─────────────────────────────────╯\n'));
  console.log(kleur.bold().yellow(`🎯 Researching: "${topic}"\n`));
}

function logError(message, details = '') {
  console.log(kleur.red().bold('\n╭─ ERROR ────────────────────╮'));
  console.log(kleur.red().bold('│ ') + message);
  if (details) {
    console.log(kleur.red().dim('│ ' + details));
  }
  console.log(kleur.red().bold('╰────────────────────────────╯\n'));
}

function displayInsightsTable(insights) {
  const table = new Table({
    head: [
      kleur.cyan('Topic'),
      kleur.cyan('Score'),
      kleur.cyan('Summary')
    ],
    wordWrap: true,
    wrapOnWordBoundary: true,
    colWidths: [20, 8, 50]
  });
  
  insights.forEach(({ topic, score, summary }) => {
    table.push([
      topic,
      score,
      summary.slice(0, 200) + '...'
    ]);
  });
  
  console.log('\n' + table.toString());
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
const researchInsights = [];
const MAX_TOPICS = 3;

async function discoverNewTopics(content, originalTopic) {
  const { text } = await generateText({
    model: openai('gpt-4o'),
    messages: [
      {
        role: "system",
        content: "You are a research assistant. Analyze the content and identify 2-3 related subtopics that would be valuable to research further. Topics should be specific and focused. Format as a numbered list."
      },
      {
        role: "user",
        content: `Original topic: ${originalTopic}\n\nContent to analyze:\n${content}`
      }
    ]
  });
  
  // Parse numbered list format
  return text.split('\n')
    .map(line => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

async function parseWeb(url) {
  const abortController = new AbortController();
  setTimeout(() => abortController.abort(), 10000);
  const htmlString = await fetch(url, { signal: abortController.signal })
    .then(response => response.text())
    .catch(() => null);

  if (!htmlString) return '';

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('error', () => {
    // No-op to skip console errors.
  });

  // put the html string into a DOM
  const dom = new JSDOM(htmlString, {
    virtualConsole
  });

  const { document } = dom.window;
  const textElTags = 'p';
  const paragraphs = document.querySelectorAll(textElTags);
  if (!paragraphs.length) {
    throw new Error(`webpage doesn't have any "${textElTags}" element`);
  }
  const paragraphTexts = Array.from(paragraphs).map(p => p.textContent);

  // combine text contents from paragraphs and then remove newlines and multiple spaces
  const text = paragraphTexts.join(' ').replace(/ {2}|\r\n|\n|\r/gm, '');

  return text;
}

async function searchGoogle(query) {
  if (!process.env.SERPER_API_KEY) {
    throw new Error('SERPER_API_KEY environment variable is required');
  }

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      q: query,
      num: 5 // Get top 5 results
    })
  });

  const data = await response.json();
  return data.organic || [];
}

async function fetchAndExtractContent(url) {
  try {
    logger.info(`📥 Processing: ${url}`);
    const content = await parseWeb(url);
    return content.slice(0, 4000); // Limit content length
  } catch (error) {
    logger.error(`⚠️ Error: ${error.message}`);
    return '';
  }
}

async function summarizeContent(content) {
  const { text } = await generateText({
    model: openai('gpt-4o'),
    prompt: content,
    system: "You are a research assistant. Summarize the provided content into 2-3 key insights. Focus on factual information and interesting findings."
  });
  return text;
}

async function generateTweetThread(research) {
  const { text } = await generateText({
    model: openai('gpt-4o'),
    messages: [
      {
        role: "system",
        content: "You are a Twitter Thread Creator. Create a compelling thread from the research provided. Each tweet must be under 280 characters. Create 5-7 tweets that tell an engaging story about the topic. Format each tweet on a new line starting with a number and period (e.g. '1. First tweet')."
      },
      {
        role: "user",
        content: research
      }
    ]
  });
  return text;
}

async function prioritizeInsight(insight) {
  const { text } = await generateText({
    model: openai('gpt-4o'),
    messages: [
      {
        role: "system",
        content: "You are a research assistant. Rate the following insight from 1-10 based on: novelty, factual content, and potential interest to readers. Return only the number."
      },
      {
        role: "user",
        content: insight
      }
    ]
  });
  const score = parseInt(text.trim(), 10) || 5;
  return score;
}

async function researchTopic(topic, isSubTopic = false) {
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
    urls = [...new Set(
      searchResults
        .map(result => result.link)
        .filter(url => url && url.startsWith('http'))
    )].slice(0, 4);
    logger.success('🔍 Found ' + urls.length + ' relevant sources');
    urls.forEach(url => logger.log(kleur.dim(`└─ ${url}`)));
  } catch (error) {
    logger.error(`Search failed: ${error.message}`);
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
        newTopics.forEach(t => logger.log(kleur.dim(`└─ ${t}`)));
        
        for (const newTopic of newTopics) {
          await new Promise(resolve => setTimeout(resolve, 500));
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

    const insightsByTopic = researchInsights.reduce((acc, insight) => {
      if (!acc[insight.topic]) acc[insight.topic] = [];
      acc[insight.topic].push(insight);
      return acc;
    }, {});

    const topInsights = Object.entries(insightsByTopic)
      .map(([topic, insights]) => {
        const topicInsights = insights
          .sort((a, b) => b.score - a.score)
          .slice(0, 3)
          .map(i => `• ${i.summary}`)
          .join('\n');
        return `Topic: ${topic}\n${topicInsights}`;
      })
      .join('\n\n');

    tweetThread = await generateTweetThread(topInsights);
    logger.success('🔄 Research processing completed');
  }

  if (!isSubTopic) {
    logger.success(`✨ Completed research: ${topic}`);
    
    console.log('\n' + kleur.bold().cyan('📊 Research Coverage:'));
    console.log(kleur.blue(`📌 Main topic: ${topic}`));
    console.log(kleur.blue(`🔍 Related topics: ${Array.from(discoveredTopics).slice(1).join(', ') || 'none'}`));
    console.log(kleur.blue(`📚 Total insights: ${researchInsights.length}`));
    
    displayInsightsTable(researchInsights);
    
    console.log('\n' + kleur.bold().cyan('🧵 Generated Tweet Thread:'));
    console.log(kleur.blue(tweetThread));

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(kleur.dim(`\n⏱️  Research completed in ${duration}s`));

    return { tweetThread, insights: researchInsights };
  }
}

// Example usage
const topic = process.argv[2];
if (!topic) {
  console.error('Please provide a search topic as an argument');
  process.exit(1);
}

researchTopic(topic)
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
