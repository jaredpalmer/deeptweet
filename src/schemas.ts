import { z } from 'zod';

export const outlineSchema = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      title: z.string(),
      key_points: z.array(z.string())
    })
  )
});

export const blogPostSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  summary: z.string(),
  keywords: z.array(z.string()),
  sections: z.array(
    z.object({
      title: z.string(),
      content: z.string(),
      key_takeaways: z.array(z.string()),
      technical_depth: z.number().min(1).max(5),
      business_value: z.number().min(1).max(5)
    })
  ),
  conclusion: z.string(),
  next_steps: z.array(z.string()),
  further_reading: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      why_relevant: z.string()
    })
  ),
  metadata: z.object({
    reading_time: z.number(),
    technical_level: z.number().min(1).max(5),
    business_impact: z.number().min(1).max(5),
    seo_score: z.number().min(1).max(100)
  })
});

export type BlogPost = z.infer<typeof blogPostSchema>;
export type Outline = z.infer<typeof outlineSchema>;
