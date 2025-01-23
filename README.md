# DeepTweet Research Tool

A tool that researches topics and generates Twitter threads using AI.

## Prerequisites

You'll need:
- Node.js (v16 or higher)
- pnpm package manager
- Serper API key (for Google search results)
- OpenAI API key

## Installation

1. Install dependencies:
```bash
pnpm install
```

2. Copy the example environment file and edit it with your API keys:
```bash
cp .env.example .env
```

Add your API keys to the `.env` file:
```
SERPER_API_KEY=your_serper_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
```

### Getting API Keys

#### Serper API
1. Go to [serper.dev](https://serper.dev)
2. Sign up for an account
3. Navigate to your dashboard to find your API key

#### OpenAI API
1. Go to [platform.openai.com](https://platform.openai.com)
2. Sign up or log in
3. Navigate to API keys section
4. Create a new API key

## Usage

There are two ways to run the research tool:

### Standard Output
```bash
pnpm research "your topic here"
```

### Pretty Output (with progress bars)
```bash
pnpm pretty "your topic here"
```

Both commands will:
1. Search Google for relevant articles
2. Extract and summarize content
3. Generate a Twitter thread based on the research

The pretty version includes progress bars and better formatted output.

## Example

```bash
pnpm pretty "latest developments in quantum computing"
```

This will generate a researched Twitter thread about quantum computing developments.
