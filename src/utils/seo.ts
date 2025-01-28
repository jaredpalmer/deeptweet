import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const seoSchema = z.object({
  title_score: z.number().min(1).max(100),
  keyword_density: z.number().min(1).max(100),
  readability_score: z.number().min(1).max(100),
  suggestions: z.array(z.string()),
  keywords: z.array(z.string()),
  meta_description: z.string()
});

export async function analyzeSEO(content: string) {
  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: seoSchema,
    messages: [
      {
        role: 'system',
        content: 'You are an SEO expert. Analyze this content and provide SEO metrics and suggestions.'
      },
      {
        role: 'user',
        content
      }
    ]
  });

  return {
    ...object,
    overall_score: Math.round(
      (object.title_score + object.keyword_density + object.readability_score) / 3
    )
  };
}

export function generateMetaTags(seoData: Awaited<ReturnType<typeof analyzeSEO>>) {
  return {
    title: seoData.meta_description.slice(0, 60),
    description: seoData.meta_description,
    keywords: seoData.keywords.join(', ')
  };
}
