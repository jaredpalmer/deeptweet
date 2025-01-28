import fs from 'fs/promises';
import path from 'path';
import { BlogPost } from '../schemas';
import { sanitizeFilename } from './filename';

export async function writeBlogPostMarkdown(blogPost: BlogPost, topic: string) {
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = sanitizeFilename(`${timestamp}-${topic}`);
  const outputDir = path.join(process.cwd(), 'output');
  
  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });
  
  const markdown = `# ${blogPost.title}

${blogPost.subtitle}

## Summary

${blogPost.summary}

${blogPost.sections.map(section => `
## ${section.title}

${section.content}

### Key Takeaways
${section.key_takeaways.map(point => `- ${point}`).join('\n')}

### Sources
${section.sources.map(url => `- ${url}`).join('\n')}
`).join('\n')}

## Conclusion

${blogPost.conclusion}

## Next Steps

${blogPost.next_steps.map(step => `- ${step}`).join('\n')}

## Further Reading

${blogPost.further_reading.map(ref => `- [${ref.title}](${ref.url}) - ${ref.why_relevant}`).join('\n')}

---

*Reading time: ${blogPost.metadata.reading_time} minutes*  
*Technical depth: ${blogPost.metadata.technical_level}/5*  
*Business impact: ${blogPost.metadata.business_impact}/5*
`;

  const outputPath = path.join(outputDir, `${filename}.md`);
  await fs.writeFile(outputPath, markdown, 'utf-8');
  return outputPath;
}
