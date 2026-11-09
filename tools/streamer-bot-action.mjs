// Builds the Streamer.bot import string for the settle action (#114) from src/chat/settleAction.cs:
// "SBAE" + gzip(JSON), base64, the layout Streamer.bot 1.0.7's own exports use. Fixed ids keep the output stable.
// Run after editing the C#: node tools/streamer-bot-action.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const code = readFileSync('src/chat/settleAction.cs', 'utf8').replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
const action = {
  id: '6c0f3b52-7a1e-4d2b-9a3f-1b8e5d4c7a01', queue: '00000000-0000-0000-0000-000000000000', enabled: true,
  excludeFromHistory: false, excludeFromPending: false, name: 'Rhino Race settle', group: 'Rhino Race',
  alwaysRun: false, randomAction: false, concurrent: true, triggers: [],
  subActions: [{
    name: 'Settle redemption', description: 'Fulfils or refunds a Rhino Race redemption, called by the game through DoAction.',
    references: ['C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\mscorlib.dll'],
    byteCode: Buffer.from(code).toString('base64'), precompile: false, delayStart: false,
    saveResultToVariable: false, saveToVariable: null,
    id: '6c0f3b52-7a1e-4d2b-9a3f-1b8e5d4c7a02', weight: 0.0, type: 99999, parentId: null, enabled: true, index: 0,
  }],
  collapsedGroups: [],
};
const json = {
  meta: { name: 'Rhino Race settle', author: 'p0mz0r', version: '1.0.0', description: 'Fulfils or refunds channel point redemptions for the Rhino Race game (docs/streamer-bot-action.md).', autoRunAction: null, minimumVersion: null },
  data: { actions: [action], queues: [], commands: [], websocketServers: [], websocketClients: [], timers: [] },
  version: 23, exportedFrom: '1.0.7', minimumVersion: '1.0.0-alpha.1',
};
const exported = Buffer.concat([Buffer.from('SBAE'), gzipSync(JSON.stringify(json))]).toString('base64');
writeFileSync('src/chat/settleAction.sb', exported + '\n');
console.log(`src/chat/settleAction.sb: ${exported.length} characters`);
