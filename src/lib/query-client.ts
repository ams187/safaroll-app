import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { QueryClient } from '@tanstack/react-query';
import { createMMKV } from 'react-native-mmkv';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 1000 * 60 * 60 * 24,
    },
  },
});

// MMKV is synchronous, so use the sync storage persister with a small shim.
// MMKV v4 (Nitro) creates instances via createMMKV() and deletes with remove().
const mmkv = createMMKV({ id: 'tanstack-query-cache' });

const clientStorage = {
  setItem: (key: string, value: string) => mmkv.set(key, value),
  getItem: (key: string) => {
    const value = mmkv.getString(key);
    return value === undefined ? null : value;
  },
  removeItem: (key: string) => {
    mmkv.remove(key);
  },
};

// 3 s plutôt que la seconde par défaut : chaque frappe du persister est un
// `JSON.stringify` du cache entier sur le fil JS. La fréquence est le seul
// levier ici — la taille, c'est `shouldDehydrateQuery` qui la tient (_layout).
export const persister = createSyncStoragePersister({
  storage: clientStorage,
  throttleTime: 3000,
});
