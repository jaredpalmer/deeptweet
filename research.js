import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import PQueue from 'p-queue';
import { JSDOM, VirtualConsole } from 'jsdom';
import fetch from 'node-fetch';
import 'dotenv/config';
import Listr from 'listr';

const queue = new PQueue({ concurrency: 2 });

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
    console.log(`📥 Fetching and parsing: ${url}`);
    const content = await parseWeb(url);
    return content.slice(0, 4000); // Limit content length
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
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
    prompt: research,
    system: "You are a Twitter Thread Creator. Create a compelling thread from the research provided. Each tweet must be under 280 characters. Create 5-7 tweets that tell an engaging story about the topic. Format each tweet on a new line starting with a number and period (e.g. '1. First tweet')."
  });
  return text;
}

async function researchTopic(topic) {
  let searchResults, urls, contents, research, tweetThread;

  const tasks = new Listr([
    {
      title: '🔍 Searching Google',
      task: async () => {
        searchResults = await searchGoogle(topic);
        urls = [...new Set(
          searchResults
            .map(result => result.link)
            .filter(url => url && url.startsWith('http'))
        )];
      }
    },
    {
      title: '📑 Analyzing URLs',
      task: async () => {
        contents = await queue.addAll(
          urls.map(url => async () => {
            const content = await fetchAndExtractContent(url);
            if (content) {
              const summary = await summarizeContent(content);
              return `Source: ${url}\n\n${summary}`;
            }
            return '';
          })
        );
        research = contents.filter(Boolean).join('\n\n---\n\n');
      }
    },
    {
      title: '📱 Generating Tweet Thread',
      task: async () => {
        tweetThread = await generateTweetThread(research);
      }
    }
  ]);

  await tasks.run();

  console.log('\n📊 Research Results:');
  console.log('------------------------');
  console.log(research);
  
  console.log('\n🧵 Tweet Thread:');
  console.log('------------------------');
  console.log(tweetThread);
  
  return { research, tweetThread };
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
