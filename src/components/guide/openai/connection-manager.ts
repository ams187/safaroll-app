import { getSupabaseAccessToken } from '@/lib/supabase/client';
import { AppState } from 'react-native';
import { NitroWebSocket } from 'react-native-nitro-websockets';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !publishableKey) throw new Error('Supabase Guide configuration is missing');

const socketUrl = `${supabaseUrl.replace(/^http/, 'ws')}/functions/v1/guide-chat`;

type Handlers = {
  onServerEvent: (raw: string) => void;
  onDisconnect: () => void;
};

let socket: NitroWebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempts = 0;
let handlers: Handlers | null = null;
let connecting = false;

function resetBackoff() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  attempts = 0;
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  const delay = Math.min(1000 * 2 ** attempts, 4000);
  attempts += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

async function connect() {
  if (connecting || socket?.readyState === 'CONNECTING' || socket?.readyState === 'OPEN') return;
  connecting = true;
  try {
    const token = await getSupabaseAccessToken();
    if (!token) {
      scheduleReconnect();
      return;
    }
    const nextSocket = new NitroWebSocket(socketUrl, undefined, {
      apikey: publishableKey!,
      Authorization: `Bearer ${token}`,
    });
    socket = nextSocket;
    nextSocket.onopen = () => {
      attempts = 0;
    };
    nextSocket.onclose = () => {
      if (socket === nextSocket) socket = null;
      handlers?.onDisconnect();
      scheduleReconnect();
    };
    nextSocket.onerror = () => {
      handlers?.onDisconnect();
      scheduleReconnect();
    };
    nextSocket.onmessage = (event: { data: string }) => handlers?.onServerEvent(event.data);
  } finally {
    connecting = false;
  }
}

function forceReconnect() {
  resetBackoff();
  const stale = socket;
  socket = null;
  if (stale) {
    stale.onclose = () => {};
    stale.onerror = () => {};
    stale.onmessage = () => {};
    stale.close(1000, 'client reconnect');
  }
  void connect();
}

void connect();
AppState.addEventListener('change', (state) => {
  if (state === 'active' && socket == null) void connect();
});

export const connectionManager = {
  setHandlers(next: Handlers) {
    handlers = next;
    void connect();
    return { remove: () => { if (handlers === next) handlers = null; } };
  },
  send(payload: string) {
    if (!socket || socket.readyState !== 'OPEN') {
      void connect();
      return false;
    }
    socket.send(payload);
    return true;
  },
  forceReconnect,
};
