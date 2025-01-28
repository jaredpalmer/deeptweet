import { z } from 'zod';

export const outlineSchema = z.object({
  title: z.string().describe('A compelling, SEO-friendly title that captures the main topic and value proposition'),
  sections: z.array(
    z.object({
      title: z.string().describe('Clear section heading that previews the content and maintains narrative flow'),
      key_points: z.array(
        z.string().describe('Specific points to cover, including technical details, business value, and practical applications')
      )
    })
  ).describe('Logical structure that builds knowledge progressively')
});

export const blogPostSchema = z.object({
  title: z.string().describe('Attention-grabbing, keyword-rich title that promises clear value to the reader'),
  subtitle: z.string().describe('One-line hook that expands on the title and emphasizes key benefits or insights'),
  summary: z.string().describe('Executive summary highlighting key takeaways and business value in 2-3 compelling sentences'),
  content: z.array(
    z.object({
      type: z.enum(['paragraph', 'heading']).describe('Content block type - either a section heading or body paragraph'),
      text: z.string().describe('The actual content, written in an engaging style with technical accuracy'),
      level: z.number().optional().describe('Heading level (2 for sections, 3 for subsections, etc.)'),
      citations: z.array(
        z.object({
          text: z.string().describe('The specific claim or statement being cited'),
          url: z.string().describe('Source URL supporting the claim')
        })
      ).optional().describe('Evidence backing specific claims or statements')
    })
  ).describe('Main content blocks, organized to tell a coherent story with proper citations'),
  metadata: z.object({
    reading_time: z.number().describe('Estimated reading time in minutes'),
    technical_level: z.number().min(1).max(5).describe('Technical complexity rating (1=beginner to 5=expert)'),
    business_impact: z.number().min(1).max(5).describe('Potential business value rating (1=low to 5=transformative)')
  }).describe('Article metadata for classification and reader expectations'),
  references: z.array(
    z.object({
      url: z.string().describe('Full URL to the reference'),
      title: z.string().describe('Title or description of the reference'),
      site: z.string().describe('Domain name of the source')
    })
  ).describe('List of authoritative sources used in the article')
});

export type BlogPost = z.infer<typeof blogPostSchema>;
export type Outline = z.infer<typeof outlineSchema>;
