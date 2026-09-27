// Destructive integration check, ONLY for a dedicated disposable Clerk account.
// TEST_USER_ID=user_... TEST_SESSION_ID=sess_... bun --env-file=.env.local scripts/check-account-deletion.ts
import assert from 'node:assert/strict';

const uid = process.env.TEST_USER_ID;
const sid = process.env.TEST_SESSION_ID;
assert.match(uid ?? '', /^user_[a-zA-Z0-9]+$/);
assert.match(sid ?? '', /^sess_[a-zA-Z0-9]+$/);
function clerk(path: string, data?: object) {
  const args = ['clerk', 'api', path, '--instance', 'prod'];
  if (data) {
    args.push('-d', JSON.stringify(data));
    assert.equal(Bun.spawnSync([...args, '--dry-run']).exitCode, 0);
    args.push('--yes');
  }
  const result = Bun.spawnSync(args);
  assert.equal(result.exitCode, 0, `Clerk request failed: ${path}`);
  return JSON.parse(result.stdout.toString());
}
const user = clerk(`/users/${uid}`);
assert.equal(user.email_addresses.length, 1);
assert.match(user.email_addresses[0].email_address, /^review-deletion-[0-9]+@safaroll\.com$/);
assert.equal(clerk(`/sessions/${sid}`).user_id, uid);
const { jwt } = clerk(`/sessions/${sid}/tokens`, {});
assert.ok(jwt);
const base = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const headers = {
  apikey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  authorization: `Bearer ${jwt}`,
  'content-type': 'application/json',
  prefer: 'resolution=merge-duplicates',
};
async function request(path: string, body: object) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await response.text();
  assert.ok(response.ok, `${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}
assert.equal(await request('/rest/v1/rpc/current_user_id', {}), uid);
await request('/rest/v1/profiles', { user_id: uid, display_name: 'Deletion QA', community_visible: false });
// A real blob in each private bucket, including a nested path.
for (const bucket of ['capture-originals', 'capture-stickers', 'items']) {
  const response = await fetch(`${base}/storage/v1/object/${bucket}/${uid}/deletion-qa/test.png`, {
    method: 'POST', headers: { ...headers, 'content-type': 'image/png', 'x-upsert': 'true' },
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nQAAAABJRU5ErkJggg==', 'base64'),
  });
  assert.ok(response.ok, `Upload ${bucket}: ${response.status} ${await response.text()}`);
}
assert.equal((await request('/rest/v1/rpc/list_my_account_files', {})).length, 3);
console.log('Test account: authenticated; profile and 3 Storage files created.');
const result = await request('/functions/v1/delete-account', {});
assert.equal(result.ok, true);
const identity = await fetch(`https://api.clerk.com/v1/users/${uid}`, {
  headers: { authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
});
assert.equal(identity.status, 404, 'Clerk identity must be deleted');
console.log('delete-account: OK; Clerk identity: deleted (404). Verify database counts independently.');
