import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';
import type { WSContext } from 'hono/ws';
import { fileURLToPath } from 'node:url';

export type Role = 'sender' | 'receiver';
export type Room = {
  sender?: WSContext;
  receiver?: WSContext;
  createdAt: number;
  warned?: boolean;
};

export const app = new Hono();
export const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

export const rooms = new Map<string, Room>();

app.get(
  '/ws',
  upgradeWebSocket((c) => {
    const room = c.req.query('room') ?? '';
    const role = c.req.query('role') as Role;

    return {
      onOpen(_evt, ws) {
        const peers = rooms.get(room) ?? { createdAt: Date.now() };
        peers[role] = ws;
        rooms.set(room, peers);

        const other = peers[role === 'sender' ? 'receiver' : 'sender'];
        if (other) {
          other.send(JSON.stringify({ type: 'peer-joined' }));
          ws.send(JSON.stringify({ type: 'peer-joined' }));
        }
      },
      onMessage(evt, ws) {
        const peers = rooms.get(room);
        const other = peers?.[role === 'sender' ? 'receiver' : 'sender'];
        other?.send(evt.data as string);
      },
      onClose() {
        const peers = rooms.get(room);
        if (!peers) return;
        delete peers[role];
        const other = peers[role === 'sender' ? 'receiver' : 'sender'];
        other?.send(JSON.stringify({ type: 'peer-left' }));
        if (!peers.sender && !peers.receiver) rooms.delete(room);
      }
    };
  })
);

app.use('/*', serveStatic({ root: './dist' }));

export function cleanupRooms() {
  const now = Date.now();
  for (const [id, r] of rooms) {
    if (now - r.createdAt > ROOM_TTL) {
      rooms.delete(id);
    }
  }
}

const port = Number(process.env.PORT) || 3000;
const CLEANUP_INTERVAL = 60_000;
const ROOM_TTL = 30 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [id, r] of rooms) {
    if (now - r.createdAt > 25 * 60_000 && !r.warned) {
      r.warned = true;
      r.sender?.send(JSON.stringify({ type: 'peer-timeout' }));
      r.receiver?.send(JSON.stringify({ type: 'peer-timeout' }));
    }
  }
  for (const [id, r] of rooms) {
    if (now - r.createdAt > ROOM_TTL) {
      rooms.delete(id);
    }
  }
}, CLEANUP_INTERVAL);

const currentFile = fileURLToPath(import.meta.url);
const isMain = process.argv[1] && currentFile === process.argv[1];

if (isMain) {
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`p2p-send listening on http://localhost:${info.port}`);
  });
  injectWebSocket(server);
}
