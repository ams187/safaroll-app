// Captures taken with no usable connection.
//
// Wildlife happens in places with no bars, which makes "the upload failed" an
// ordinary outcome for this app rather than an error state. A queued capture
// keeps its photo and its cut-out on disk and identifies itself the moment the
// app can reach Supabase again.
//
// The files are copied into the **document** directory, not left where the
// camera wrote them: iOS empties the cache directory whenever storage runs low,
// and a capture that waits hours for a signal must not evaporate in the
// meantime. They are deleted again as soon as the capture lands.
import { Directory, File, Paths } from 'expo-file-system';
import { createMMKV } from 'react-native-mmkv';

export type PendingCapture = {
  capturedAt?: number;
  /** MIME type of the stored photo — it is re-uploaded exactly as written. */
  contentType?: string;
  captureSource: 'camera' | 'library';
  height: number;
  id: string;
  latitude?: number;
  longitude?: number;
  /** Absolute `file://` uri inside the pending directory. */
  originalUri: string;
  queuedAt: number;
  stickerUri?: string;
  width: number;
};

const KEY = 'pending-captures';
// GELÉ AU NOM DE L'ANCIEN PROJET, ET ÇA RESTERA. Ce n'est pas un nom, c'est
// une CLÉ DE STOCKAGE : la renommer ouvrirait un magasin vide et jetterait
// silencieusement les captures en attente d'un joueur qui met l'app à jour au
// mauvais moment. Le prix d'un nom propre serait payé par lui.
const store = createMMKV({ id: 'birdy-capture-queue' });

function pendingDirectory() {
  const directory = new Directory(Paths.document, 'pending-captures');
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

export function listPending(): PendingCapture[] {
  try {
    return JSON.parse(store.getString(KEY) ?? '[]') as PendingCapture[];
  } catch {
    return [];
  }
}

function write(queue: PendingCapture[]) {
  store.set(KEY, JSON.stringify(queue));
}

/** Moves the capture's files somewhere durable and records it. */
export function enqueue(input: {
  capturedAt?: number;
  contentType?: string;
  captureSource: 'camera' | 'library';
  height: number;
  location?: { latitude: number; longitude: number };
  originalUri: string;
  stickerUri?: string | null;
  width: number;
}): PendingCapture {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const directory = pendingDirectory();
  const pending: PendingCapture = {
    captureSource: input.captureSource,
    ...(input.contentType ? { contentType: input.contentType } : {}),
    height: input.height,
    id,
    originalUri: keep(input.originalUri, directory, `${id}-original`),
    queuedAt: Date.now(),
    width: input.width,
    ...(input.capturedAt === undefined ? {} : { capturedAt: input.capturedAt }),
    ...(input.location ?? {}),
    ...(input.stickerUri
      ? { stickerUri: keep(input.stickerUri, directory, `${id}-sticker`) }
      : {}),
  };
  write([...listPending(), pending]);
  return pending;
}

/** Drops a capture from the queue and reclaims its disk. */
export function release(id: string) {
  const queue = listPending();
  const pending = queue.find((entry) => entry.id === id);
  if (pending) {
    remove(pending.originalUri);
    if (pending.stickerUri) remove(pending.stickerUri);
  }
  write(queue.filter((entry) => entry.id !== id));
}

function keep(uri: string, directory: Directory, name: string): string {
  try {
    const source = new File(uri);
    const extension = source.extension || '.jpg';
    const target = new File(directory, `${name}${extension}`);
    if (target.exists) target.delete();
    source.copy(target);
    return target.uri;
  } catch {
    // Copy failed — the original is still on disk, so queue that instead and
    // accept the risk of the cache being swept. Better than losing it now.
    return uri;
  }
}

function remove(uri: string) {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A file we cannot delete is a few megabytes, not a failure worth raising.
  }
}
