import { readFile } from 'node:fs/promises';

const [entry, layout, collection, backend, queue, socket, protocol] = await Promise.all([
  readFile('index.ts', 'utf8'),
  readFile('src/app/(app)/_layout.tsx', 'utf8'),
  readFile('src/components/animals/collection-screen.tsx', 'utf8'),
  readFile('src/lib/supabase/backend.ts', 'utf8'),
  readFile('src/lib/animals/use-capture-queue.ts', 'utf8'),
  readFile('src/components/guide/openai/connection-manager.ts', 'utf8'),
  readFile('src/components/guide/openai/protocol.ts', 'utf8'),
]);

const requireSource = (source: string, needle: string, failure: string) => {
  if (!source.includes(needle)) throw new Error(failure);
};

requireSource(entry, 'maxBodyCapture: 0', 'Network inspection must not retain Supabase bodies');
requireSource(layout, 'queryClient.prefetchQuery(backendQuery(api.animals.listCaptures', 'Home captures are not prefetched');
requireSource(collection, 'onViewableItemsChanged={prewarmVisibleDetails}', 'Visible card details are not prewarmed');
requireSource(backend, "createWorkletRuntime({ name: 'safaroll-catalog-parser' })", 'Catalog parsing is not off the React thread');
requireSource(backend, 'const response = await nitroFetch', 'Catalog transport does not use Nitro Fetch');
requireSource(backend, "if ('scientificName' in row) return row", 'The shaped catalog cache must not be parsed as raw Supabase rows');
requireSource(queue, 'if (retriedIdentification)', 'An empty capture queue must not refetch the collection');
requireSource(socket, 'new NitroWebSocket', 'The Guide is not using its streaming Nitro socket');
requireSource(protocol, "case 'response.output_text.delta'", 'Guide response deltas are not consumed');

console.log('Nitro data path contract OK.');
