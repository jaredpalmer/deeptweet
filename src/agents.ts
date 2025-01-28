import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

export interface CritiqueResult {
  score: number;
  feedback: string;
  suggestions: string[];
}

export interface ResearchAgent {
  name: string;
  role: string;
  analyze: (content: string) => Promise<string>;
}

export interface AgentScore {
  score: number;
  rationale: string;
}

export interface AgentAnalysis {
  feedback: string;
  suggestions: string[];
  scores: {
    technical_accuracy: AgentScore;
    business_value: AgentScore;
    engagement: AgentScore;
    actionability: AgentScore;
    depth: AgentScore;
  };
}

export const researchAgents: ResearchAgent[] = [
  {
    name: 'BusinessValueAnalyst',
    role: 'You are a business strategy expert. Your job is to ensure the content provides clear, actionable business value and strategic insights.',
    analyze: async (content: string) => {
      const { text } = await generateText({
        model: openai('gpt-4o'),
        messages: [
          {
            role: 'system',
            content: 'Review the content for business value. Identify opportunities to strengthen ROI discussion, strategic implications, and practical applications.'
          },
          { role: 'user', content }
        ]
      });
      return text;
    }
  },
  {
    name: 'FactChecker',
    role: 'You are a meticulous fact checker. Your job is to verify claims, identify potential inaccuracies, and ensure all statements are well-supported by evidence.',
    analyze: async (content: string) => {
      const { text } = await generateText({
        model: openai('gpt-4o'),
        messages: [
          {
            role: 'system',
            content: 'You are a fact checker. Review the content for accuracy and evidence. Highlight any unsupported claims or potential inaccuracies. Suggest improvements.',
          },
          { role: 'user', content }
        ]
      });
      return text;
    }
  },
  {
    name: 'DepthAnalyst',
    role: 'You are a depth analyst. Your job is to identify areas where the analysis could go deeper, find missing perspectives, and suggest additional angles to explore.',
    analyze: async (content: string) => {
      const { text } = await generateText({
        model: openai('gpt-4o'),
        messages: [
          {
            role: 'system',
            content: 'You are a depth analyst. Review the content for thoroughness. Identify shallow analysis, missing perspectives, and opportunities for deeper investigation.',
          },
          { role: 'user', content }
        ]
      });
      return text;
    }
  },
  {
    name: 'Synthesizer',
    role: 'You are a research synthesizer. Your job is to connect ideas across sections, identify patterns, and ensure the analysis forms a cohesive narrative.',
    analyze: async (content: string) => {
      const { text } = await generateText({
        model: openai('gpt-4o'),
        messages: [
          {
            role: 'system',
            content: 'You are a research synthesizer. Review the content for connections between ideas. Identify opportunities to strengthen the narrative and create deeper insights.',
          },
          { role: 'user', content }
        ]
      });
      return text;
    }
  }
];

export async function critiquePaper(content: string): Promise<CritiqueResult> {
  const critiques = await Promise.all(
    researchAgents.map(agent => agent.analyze(content))
  );

  const { text: evaluation } = await generateText({
    model: openai('gpt-4o'),
    messages: [
      {
        role: 'system',
        content: 'You are a research evaluator. Review the critiques and provide a consolidated assessment with concrete suggestions for improvement. Score the paper from 1-10.',
      },
      {
        role: 'user',
        content: `Critiques:\n${critiques.join('\n\n')}\n\nProvide a score (1-10) and specific suggestions for improvement.`
      }
    ]
  });

  // Parse evaluation
  const score = parseInt(evaluation.match(/Score:\s*(\d+)/)?.[1] || '5', 10);
  const suggestions = evaluation
    .match(/Suggestions:([\s\S]*?)(?:\n\n|$)/)?.[1]
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean) || [];

  return {
    score,
    feedback: evaluation,
    suggestions
  };
}

export async function improveSection(
  section: string,
  critique: CritiqueResult
): Promise<string> {
  const { text } = await generateText({
    model: openai('gpt-4o'),
    messages: [
      {
        role: 'system',
        content: 'You are a research paper improver. Revise the section based on the critique feedback while maintaining academic rigor and depth.',
      },
      {
        role: 'user',
        content: `Original section:\n${section}\n\nCritique feedback:\n${critique.feedback}\n\nSuggestions:\n${critique.suggestions.join('\n')}\n\nProvide an improved version that addresses these points.`
      }
    ]
  });
  return text;
}
