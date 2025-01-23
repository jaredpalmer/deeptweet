import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { JSDOM, VirtualConsole } from 'jsdom';
import fetch from 'node-fetch';
import 'dotenv/config';
import ora from 'ora';
import kleur from 'kleur';
import PQueue from 'p-queue';
import Table from 'cli-table3';
import readline from 'readline';

// Logger class to manage terminal output
class Logger {
  constructor() {
    this.indent = 0;
    this.spinners = new Map();
  }

  getPrefix() {
    return '  '.repeat(this.indent);
  }

  log(message) {
    console.log(this.getPrefix() + message);
  }

  indent() {
    this.indent++;
    return () => this.outdent();
  }

  outdent() {
    this.indent = Math.max(0, this.indent - 1);
  }

  createSpinner(text, id) {
    const spinner = ora({
      text: this.getPrefix() + text,
      color: 'cyan',
      spinner: {
        frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
        interval: 80
      }
    }).start();
    
    if (id) {
      this.spinners.set(id, spinner);
    }
    
    return spinner;
  }

  updateSpinner(id, text) {
    const spinner = this.spinners.get(id);
    if (spinner) {
      spinner.text = this.getPrefix() + text;
    }
  }

  succeedSpinner(id, text) {
    const spinner = this.spinners.get(id);
    if (spinner) {
      spinner.succeed(this.getPrefix() + text);
      this.spinners.delete(id);
    }
  }

  failSpinner(id, text) {
    const spinner = this.spinners.get(id);
    if (spinner) {
      spinner.fail(this.getPrefix() + text);
      this.spinners.delete(id);
    }
  }
}

const logger = new Logger();

function createSpinner(text) {
  return ora({
    text,
    spinner: {
      frames,
      interval: 80
    }
  }).start();
}

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

async function fetchAndExtractContent(url, spinner) {
  try {
    spinner.text = kleur.blue(`📥 Processing: ${url}`);
    const content = await parseWeb(url);
    return content.slice(0, 4000); // Limit content length
  } catch (error) {
    spinner.text = kleur.red(`⚠️ Error: ${error.message}`);
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
  const topicId = `topic-${topic.replace(/\s+/g, '-')}`;
  
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
  
  const release = logger.indent();
  const topicSpinner = logger.createSpinner(kleur.bold().cyan(`🔬 Researching: ${topic}`), topicId);
  logger.log(''); // Add spacing
  
  const searchSpinner = logger.createSpinner(kleur.blue('🔍 Searching Google...'));
  try {
    searchResults = await searchGoogle(topic);
    urls = [...new Set(
      searchResults
        .map(result => result.link)
        .filter(url => url && url.startsWith('http'))
    )].slice(0, 4);
    searchSpinner.succeed(kleur.green('🔍 Found ' + urls.length + ' relevant sources'));
    urls.forEach(url => logger.log(kleur.dim(`└─ ${url}`)));
  } catch (error) {
    searchSpinner.fail(kleur.red(`Search failed: ${error.message}`));
    logger.failSpinner(topicId, kleur.red(`Research failed for: ${topic}`));
    release();
    return;
  }

  logger.log(''); // Add spacing
  const contentSpinner = logger.createSpinner(kleur.blue('📑 Starting content analysis...'));
  for (const url of urls) {
    const urlSpinner = ora(kleur.blue(`📄 Processing: ${url.slice(0, 50)}...`)).start();
    
    const content = await fetchAndExtractContent(url, urlSpinner);
    if (content) {
      urlSpinner.text = kleur.blue('✍️ Generating summary...');
      const summary = await summarizeContent(content);
      summaries.push({ url, summary });

      const score = await prioritizeInsight(summary);
      researchInsights.push({ topic, summary, score, url });
      
      urlSpinner.succeed(kleur.green(`📄 Processed: ${url.slice(0, 50)}`));
      console.log(kleur.dim(`   └─ ${summary.slice(0, 100)}...`));

      if (!isSubTopic) {
        const topicsSpinner = ora(kleur.blue('🔍 Discovering related topics...')).start();
        const newTopics = await discoverNewTopics(content, topic);
        topicsSpinner.succeed(kleur.green(`🔍 Found ${newTopics.length} related topics`));
        console.log(newTopics.map(t => kleur.dim(`   └─ ${t}`)).join('\n'));
        
        for (const newTopic of newTopics) {
          await new Promise(resolve => setTimeout(resolve, 500));
          researchQueue.add(() => researchTopic(newTopic, true));
        }
      }
    } else {
      urlSpinner.fail(kleur.red(`Failed to process: ${url.slice(0, 50)}`));
    }
  }
  contentSpinner.succeed(kleur.green('📑 Content analysis completed'));

  if (!isSubTopic) {
    console.log(); // Add spacing
    const processingSpinner = ora(kleur.blue('🔄 Processing research...')).start();
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
    processingSpinner.succeed(kleur.green('🔄 Research processing completed'));
  }

  if (!isSubTopic) {
    topicSpinner.succeed(kleur.green(`✨ Completed research: ${topic}`));
    
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
