import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync('src/lib/onesignal.ts', 'utf8');
const notifications = readFileSync('src/lib/notifications.ts', 'utf8');
const extract = (text: string, name: string) => {
  const start = text.indexOf(`export function ${name}(`);
  const asyncStart = text.indexOf(`export async function ${name}(`);
  const offset = start < 0 ? asyncStart : start;
  assert(offset >= 0, name);
  return text.slice(offset, text.indexOf('\n}', offset) + 2).replace('export ', '');
};
const calls: string[] = [];
const events: unknown[] = [];
const values = new Map<string, unknown>();
let liveEnabled = true;
let dismissed = 0;
const liveCalls: boolean[] = [];
const OneSignal = {
  login: (id: string) => calls.push(`login:${id}`),
  logout: () => calls.push('logout'),
  InAppMessages: { clearTriggers: () => calls.push('clear') },
  LiveActivities: {
    setupDefault: (options: { enablePushToStart: boolean }) => liveCalls.push(options.enablePushToStart),
    removePushToStartToken: () => {},
  },
  User: {
    addEmail: (email: string) => calls.push(`email-in:${email}`),
    removeEmail: (email: string) => calls.push(`email-out:${email}`),
    pushSubscription: { optIn: () => calls.push('in'), optOut: () => calls.push('out') },
    trackEvent: (...args: unknown[]) => events.push(args),
  },
};
const transpile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const js = transpile(`
const setNudgeAccount = () => {};
let currentUserId: string | null | undefined;
const startedSafaris = new Set();
const initialized = true, __DEV__ = false, DERNIERE_FENETRE = 'season-window';
${['oneSignalLogin', 'setOneSignalPushEnabled', 'trackSeasonWindow', 'syncLiveActivityPreference', 'stopLiveActivities', 'dismissLiveActivities', 'syncEmailSubscription'].map(n => extract(source, n)).join('\n')}
return { oneSignalLogin, setOneSignalPushEnabled, trackSeasonWindow, syncLiveActivityPreference, syncEmailSubscription };
`);
const api = new Function('OneSignal', 'journal', 'liveActivitiesEnabled', 'endLocalLiveActivities', js)(OneSignal, {
  getBoolean: (key: string) => values.get(key),
  set: (key: string, value: unknown) => values.set(key, value),
}, () => liveEnabled, () => { dismissed += 1; });
api.syncLiveActivityPreference();
assert.equal(dismissed, 0); // Auth still loading must preserve a running activity.
api.oneSignalLogin('alice');
api.oneSignalLogin('alice');
assert.deepEqual(calls, ['clear', 'login:alice']);
assert.equal(liveCalls.at(-1), true);
liveEnabled = false;
api.syncLiveActivityPreference();
assert.equal(liveCalls.at(-1), false);
assert.equal(dismissed, 1);
api.setOneSignalPushEnabled(true);
assert.equal(calls.at(-1), 'in');
const nudge = { scientificName: 'Lynx lynx', kind: 'peak', body: 'body', title: 'Lynx', locale: 'fr' };
api.trackSeasonWindow(nudge);
api.trackSeasonWindow(null); // Loading must not reset deduplication.
api.trackSeasonWindow(nudge);
api.trackSeasonWindow({ ...nudge, scientificName: 'Puma concolor' });
api.trackSeasonWindow(nudge); // A → B → A must not resend A.
assert.equal(events.length, 2);
api.oneSignalLogin(null);
assert.deepEqual(calls.slice(-3), ['clear', 'logout', 'out']);
assert.equal(liveCalls.at(-1), false);
api.setOneSignalPushEnabled(true);
assert.equal(calls.at(-1), 'out'); // An async permission result after logout cannot opt in.
api.trackSeasonWindow(nudge);
assert.equal(events.length, 2);
api.oneSignalLogin('bob');
assert.equal(liveCalls.at(-1), false); // Refusal survives account changes.
liveEnabled = true;
api.syncLiveActivityPreference();
assert.equal(liveCalls.at(-1), true);
api.trackSeasonWindow(nudge);
assert.equal(events.length, 3); // Accounts have independent deduplication.
const beforeEmail = calls.length;
api.syncEmailSubscription('alice', 'alice@example.com', true);
assert.equal(calls.length, beforeEmail); // A late mutation cannot attach Alice to Bob.
api.syncEmailSubscription('bob', 'bob@example.com', true);
assert.equal(calls.at(-1), 'email-in:bob@example.com');
api.syncEmailSubscription('bob', 'bob@example.com', false);
assert.equal(calls.at(-1), 'email-out:bob@example.com');
const beforeSwitch = dismissed;
api.oneSignalLogin('alice');
assert.ok(dismissed > beforeSwitch); // Direct account switching also closes activities.

const refreshJs = transpile(`${extract(notifications, 'refreshNotificationPermission')}; return refreshNotificationPermission;`);
for (const enabled of [false, true]) for (const granted of [false, true]) {
  let optedIn: boolean | undefined, cancelled = false;
  const store = new Map<string, boolean>([['enabled', enabled]]);
  const refresh = new Function('store', 'ENABLED', 'hasNotificationPermission', 'setOneSignalPushEnabled', 'emit', 'cancelSafaRollNotifications', refreshJs)(
    { getBoolean: (k: string) => store.get(k), set: (k: string, v: boolean) => store.set(k, v) },
    'enabled', async () => granted, (v: boolean) => { optedIn = v; }, () => {}, async () => { cancelled = true; },
  );
  await refresh();
  assert.equal(optedIn, enabled && granted);
  assert.equal(cancelled, enabled && !granted);
}
const root = readFileSync('src/app/_layout.tsx', 'utf8');
assert.match(root, /if \(!isLoaded\) return;\s*oneSignalLogin\(userId\)/);
console.log('OneSignal lifecycle: account switch, logout, consent, delayed permission and seasonal deduplication pass');

const clicked: string[] = [];
const opened: string[] = [];
let listener: (event: unknown) => void;
const navigationJs = transpile(`const initialized = true; ${extract(source, 'observeOneSignalNavigation')}; return observeOneSignalNavigation;`);
const observe = new Function('OneSignal', 'trackReturnOutcome', 'noterClicRappel', navigationJs)(
  { Notifications: { addEventListener: (_: string, fn: typeof listener) => { listener = fn; }, removeEventListener: () => {} } },
  () => {}, (kind: string) => clicked.push(kind),
);
observe((url: string) => opened.push(url));
listener!({ notification: { launchURL: 'safaroll:///(app)/profile?nudge_kind=leaving' } });
assert.deepEqual(clicked, ['leaving']);
assert.deepEqual(opened, ['/(app)/profile?nudge_kind=leaving']);
listener!({ notification: { launchURL: 'safaroll:///(app)/profile?nudge_kind=unknown' } });
assert.equal(clicked.length, 1);
listener!({ notification: { additionalData: { kind: 'peak', url: '/(app)/profile' } } });
assert.equal(clicked.at(-1), 'peak');
