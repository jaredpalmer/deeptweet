import { JSDOM, VirtualConsole } from 'jsdom';
import fetch from 'node-fetch';

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  hostname?: string;
}

const MAX_N_PAGES_SCRAPE = 10;
const DOMAIN_BLOCKLIST = [
  'youtube.com',
  'facebook.com',
  'twitter.com',
  'instagram.com',
];

export async function searchGoogle(query: string): Promise<SearchResult[]> {
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
