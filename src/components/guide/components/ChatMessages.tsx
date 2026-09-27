import * as React from 'react';
import { useChatStore, type Message } from '../state/chat-store';

export function ChatMessages({ children }: { children: (messages: Message[]) => React.ReactElement }) {
  const messages = useChatStore((state) => state.messages);
  return children(messages);
}
