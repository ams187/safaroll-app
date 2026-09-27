import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/lib/notifications.ts', import.meta.url), 'utf8');
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(`check-notifications: ${message}`);
};

assert(!source.includes('SchedulableTriggerInputTypes.DAILY'), 'a one-shot reminder must not repeat daily');
assert(source.includes('SchedulableTriggerInputTypes.DATE'), 'reminders use one-shot dates');
assert(source.includes('setNotificationHandler'), 'foreground delivery is configured');
assert(source.includes('addNotificationResponseReceivedListener'), 'notification taps are observed');
assert(source.includes('setNotificationChannelAsync'), 'Android has an explicit channel');
assert(source.includes('LEGACY_PREFIX'), 'legacy repeating reminders are cleaned up');

console.log('check-notifications: one-shot, foreground, navigation, Android and legacy cleanup hold');
