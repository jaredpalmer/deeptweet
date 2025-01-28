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
  summary: z.string(),
  sections: z.array(
    z.object({
      title: z.string(),
      content: z.string()
    })
  ),
  conclusion: z.string()
});

export type BlogPost = z.infer<typeof blogPostSchema>;
export type Outline = z.infer<typeof outlineSchema>;
