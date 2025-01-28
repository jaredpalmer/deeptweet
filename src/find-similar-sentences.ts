import { Embedding } from 'openai/resources';
import { openai } from '@ai-sdk/openai';
import { embed, embedMany } from 'ai';
import { dot } from '@/lib/utils';

// see here: https://github.com/nmslib/hnswlib/blob/359b2ba87358224963986f709e593d799064ace6/README.md?plain=1#L34
function innerProduct(embeddingA: number[], embeddingB: number[]) {
  return 1.0 - dot(embeddingA, embeddingB);
}

export async function findSimilarSentences(
  query: string,
  sentences: string[],
  { topK = 5 }: { topK: number }
): Promise<number[]> {
  const inputs = [query, ...sentences];
  const { embeddings } = await embedMany({
    model: openai.embedding('text-embedding-3-small'),
    values: inputs,
  });

  const queryEmbedding: Embedding = embeddings[0];
  const sentencesEmbeddings: Embedding[] = embeddings.slice(
    1,
    inputs.length - 1
  );

  const distancesFromQuery: { distance: number; index: number }[] = [
    ...sentencesEmbeddings,
  ].map((sentenceEmbedding: Embedding, index: number) => {
    return {
      distance: innerProduct(
        queryEmbedding.embedding,
        sentenceEmbedding.embedding
      ),
      index: index,
    };
  });

  distancesFromQuery.sort((a, b) => {
    return a.distance - b.distance;
  });

  // Return the indexes of the closest topK sentences
  return distancesFromQuery.slice(0, topK).map((item) => item.index);
}
