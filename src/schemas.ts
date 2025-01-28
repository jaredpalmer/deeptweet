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
  content: z.array(
    z.object({
      type: z.enum(['paragraph', 'heading']),
      text: z.string(),
      level: z.number().optional(), // For headings
      citations: z.array(
        z.object({
          text: z.string(),
          url: z.string()
        })
      ).optional()
    })
  ),
  metadata: z.object({
    reading_time: z.number(),
    technical_level: z.number().min(1).max(5),
    business_impact: z.number().min(1).max(5)
  }),
  references: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      site: z.string()
    })
  )
});

export type BlogPost = z.infer<typeof blogPostSchema>;
export type Outline = z.infer<typeof outlineSchema>;
