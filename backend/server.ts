import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createNodeWebSocket } from '@hono/node-ws';
import type { WSContext } from 'hono/ws';

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

type Role = 'sender' | 'receiver';
type Room = Partial<Record<Role, WSContext>>;

// Only signaling messages (SDP/ICE) ever pass through here — never file data.
const rooms = new Map<string, Room>();

app.get(
  '/ws',
  upgradeWebSocket((c) => {
    const room = c.req.query('room') ?? '';
    const role = c.req.query('role') as Role;

    return {
      onOpen(_evt, ws) {
        const peers = rooms.get(room) ?? {};
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

const port = Number(process.env.PORT) || 3000;
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`p2p-send listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
