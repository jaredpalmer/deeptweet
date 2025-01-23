import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { JSDOM, VirtualConsole } from 'jsdom';
import fetch from 'node-fetch';
import 'dotenv/config';
import Listr from 'listr';
import PQueue from 'p-queue';

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

async function fetchAndExtractContent(url, task) {
  try {
    task.output = `📥 Processing: ${url}`;
    const content = await parseWeb(url);
    return content.slice(0, 4000); // Limit content length
  } catch (error) {
    task.output = `⚠️ Error: ${error.message}`;
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
  if (discoveredTopics.has(topic) || discoveredTopics.size >= MAX_TOPICS) {
    return;
  }
  discoveredTopics.add(topic);

  let searchResults, urls, tweetThread;

  const tasks = new Listr([
    {
      title: `Researching: ${topic}`,
      task: () => new Listr([
        {
          title: '🔍 Searching Google',
          task: async (ctx) => {
            searchResults = await searchGoogle(topic);
            urls = [...new Set(
              searchResults
                .map(result => result.link)
                .filter(url => url && url.startsWith('http'))
            )].slice(0, 4); // Limit to top 4 URLs for cleaner output
            ctx.urls = urls;
          }
        },
        {
          title: '📑 Analyzing Content',
          task: () => new Listr(
            urls.map(url => ({
              title: `${url.slice(0, 40)}...`,
              task: async (ctx, task) => {
                const content = await fetchAndExtractContent(url, task);
                if (content) {
                  task.output = '✍️ Generating summary...';
                  const summary = await summarizeContent(content);
                  if (!ctx.summaries) ctx.summaries = [];
                  ctx.summaries.push({ url, summary });

                  if (!isSubTopic) {
                    // Discover new topics
                    const newTopics = await discoverNewTopics(content, topic);
                    task.output = `🔍 Found ${newTopics.length} related topics`;
                    
                    // Queue new topics with a delay for clearer output
                    for (const newTopic of newTopics) {
                      await new Promise(resolve => setTimeout(resolve, 500));
                      researchQueue.add(() => researchTopic(newTopic, true));
                    }
                  }

                  // Score and store insight
                  const score = await prioritizeInsight(summary);
                  researchInsights.push({ topic, summary, score, url });
                }
              }
            })),
            { concurrent: 2, exitOnError: false } // Reduced concurrency for clearer output
          )
        },
        {
          title: '📱 Processing Research',
          task: async (ctx) => {
            if (!isSubTopic) {
              await researchQueue.onIdle();

              // Group insights by topic
              const insightsByTopic = researchInsights.reduce((acc, insight) => {
                if (!acc[insight.topic]) acc[insight.topic] = [];
                acc[insight.topic].push(insight);
                return acc;
              }, {});

              // Format insights grouped by topic
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
            }
          }
        }
      ])
    }
  ]);

  await tasks.run();

  if (!isSubTopic) {
    console.log('\n📊 Research Coverage:');
    console.log(`Main topic: ${topic}`);
    console.log(`Related topics explored: ${Array.from(discoveredTopics).slice(1).join(', ')}`);
    console.log(`Total insights gathered: ${researchInsights.length}`);
    
    console.log('\n🧵 Tweet Thread:\n');
    console.log(tweetThread);

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
