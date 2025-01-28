import fs from 'fs/promises';
import path from 'path';
import { BlogPost } from '../schemas';
import { sanitizeFilename } from './filename';

export async function writeBlogPostMarkdown(blogPost: BlogPost, topic: string, customPath?: string) {
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = sanitizeFilename(`${timestamp}-${topic}`);
  const outputDir = path.join(process.cwd(), 'output');
  
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });
  
  const outputPath = customPath || path.join(outputDir, `${filename}.md`);
  const markdown = `# ${blogPost.title}

${blogPost.subtitle}

${blogPost.summary}

${blogPost.content.map(block => {
  if (block.type === 'heading') {
    return `${'#'.repeat(block.level || 2)} ${block.text}\n`;
  }
  
  let text = block.text;
  
  // Add inline citations if present
  if (block.citations?.length) {
    block.citations.forEach((citation, idx) => {
      text = text.replace(
        citation.text,
        `${citation.text}[^${idx + 1}]`
      );
    });
  }
  
  return text;
}).join('\n\n')}

---

*Reading time: ${blogPost.metadata.reading_time} minutes*  
*Technical level: ${blogPost.metadata.technical_level}/5*  
*Business impact: ${blogPost.metadata.business_impact}/5*

## References

${blogPost.references.map((ref, idx) => 
  `[^${idx + 1}]: [${ref.title}](${ref.url}) via ${ref.site}`
).join('\n')}
`;

  await fs.writeFile(outputPath, markdown, 'utf-8');
  return outputPath;
}
