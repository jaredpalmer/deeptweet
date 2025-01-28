export interface WebContent {
  url: string;
  chunks: string[];
  title?: string;
  hostname?: string;
}

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  hostname?: string;
}
