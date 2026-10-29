// Run only against a disposable local OS with an isolated persistence directory.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connect, signUp, listConnectedAccounts, waitFor } from '../../../packages/integration-tests/src/rpc-client.ts';

const base = new URL(process.env.SALES_TEST_OS_URL || 'http://127.0.0.1:8788');
if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.port !== '8788' || base.pathname !== '/' || base.search || base.hash) {
  throw new Error('Only the isolated local test OS at http://127.0.0.1:8788/ is permitted.');
}
if (process.env.SALES_DISPOSABLE_DB !== 'confirmed') {
  throw new Error('Start a separate OS on port 8788 with a disposable database, then set SALES_DISPOSABLE_DB=confirmed. Never point this script at an existing workspace.');
}
const username = `salesdemo${randomBytes(6).toString('hex')}`;
const api = connect(base);
const authenticated = await signUp(api, username);
const vendor = (await authenticated.listGatekeeperVendors()).find(v => v.id === 'gavrri_sales');
if (!vendor || vendor.unavailable || !vendor.supportedResources.some(r => r.urlPattern === 'sales://local-demo')) {
  throw new Error('Local gavrri_sales connector or sales://local-demo resource is unavailable; no workspace was created.');
}
await authenticated.provisionAmbientAccount('gavrri_sales');
const account = await waitFor('local sales test account', async () =>
  (await listConnectedAccounts(authenticated)).find(a => a.vendorId === 'gavrri_sales') ?? null);
const workspace = await authenticated.newGadget();
const gatekeeper = await workspace.newGatekeeper(account.id, 'sales://local-demo');
const chatId = await workspace.newChat('ローカル営業デモのセットアップ', null);
const gadget = await workspace.createGadget('営業ノート', chatId, 'SALES_DESK');
const id = await gadget.getId();
const [server, client] = await Promise.all(['server.js', 'client.js'].map(name => readFile(new URL(name, import.meta.url), 'utf8')));
await workspace.submitCodeChange(chatId, { generation: 0, revision: 0, clientId: randomUUID(), seq: 1,
  change: { [id]: [['server.js', { set: server }], ['client.js', { set: client }]] } });
await gadget.bind('SALES', await gatekeeper.getId(), chatId);
const merged = await workspace.mergeChanges(chatId);
if (merged.outcome !== 'merged') throw new Error('Setup changes were not merged: workspace is stale.');
const metadata = await workspace.getMetadata();
console.log(`Disposable user: ${username}`);
console.log(`Workspace: ${new URL(`/workspace/${metadata.id}`, base)}`);
console.log('RPC-only disposable test identity; this account and workspace contain synthetic data only.');
process.exit(0);
