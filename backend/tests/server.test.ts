import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { app, rooms, cleanupRooms, injectWebSocket } from '../server';
import { serve } from '@hono/node-server';
import { createServer } from 'net';

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'string' ? parseInt(address.split(':').pop() || '0') : address?.port || 0;
      server.close();
      resolve(port);
    });
  });
}

describe('signaling server', () => {
  let server: ReturnType<typeof serve>;
  let port: number;

  beforeEach(async () => {
    rooms.clear();
    port = await getAvailablePort();
    server = serve({ fetch: app.fetch, port }, () => {});
    injectWebSocket(server);
  });

  afterEach(() => {
    server.close();
  });

  it('creates a room when sender connects', async () => {
    const ws = new WebSocket(`ws://localhost:${port}/ws?room=test-room&role=sender`);
    await new Promise((resolve) => ws.addEventListener('open', resolve));
    expect(rooms.has('test-room')).toBe(true);
    expect(rooms.get('test-room')?.sender).toBeDefined();
    ws.close();
    await new Promise((resolve) => ws.addEventListener('close', resolve));
  });

  it('notifies both peers when receiver joins', async () => {
    const senderMessages: string[] = [];
    const receiverMessages: string[] = [];

    const sender = new WebSocket(`ws://localhost:${port}/ws?room=test-room&role=sender`);
    const receiver = new WebSocket(`ws://localhost:${port}/ws?room=test-room&role=receiver`);

    sender.addEventListener('message', (evt) => senderMessages.push(evt.data));
    receiver.addEventListener('message', (evt) => receiverMessages.push(evt.data));

    await Promise.all([
      new Promise((resolve) => sender.addEventListener('open', resolve)),
      new Promise((resolve) => receiver.addEventListener('open', resolve)),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(senderMessages.some((m) => JSON.parse(m).type === 'peer-joined')).toBe(true);
    expect(receiverMessages.some((m) => JSON.parse(m).type === 'peer-joined')).toBe(true);

    sender.close();
    receiver.close();
    await Promise.all([
      new Promise((resolve) => sender.addEventListener('close', resolve)),
      new Promise((resolve) => receiver.addEventListener('close', resolve)),
    ]);
  });

  it('relays signal messages between peers', async () => {
    const sender = new WebSocket(`ws://localhost:${port}/ws?room=test-room&role=sender`);
    const receiver = new WebSocket(`ws://localhost:${port}/ws?room=test-room&role=receiver`);

    await Promise.all([
      new Promise((resolve) => sender.addEventListener('open', resolve)),
      new Promise((resolve) => receiver.addEventListener('open', resolve)),
    ]);

    const signalMsg = JSON.stringify({ type: 'signal', data: { sdp: 'fake-sdp' } });
    let receivedBySender = false;
    sender.addEventListener('message', (evt) => {
      if (evt.data === signalMsg) receivedBySender = true;
    });

    receiver.send(signalMsg);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(receivedBySender).toBe(true);

    sender.close();
    receiver.close();
    await Promise.all([
      new Promise((resolve) => sender.addEventListener('close', resolve)),
      new Promise((resolve) => receiver.addEventListener('close', resolve)),
    ]);
  });

  it('notifies remaining peer when peer leaves', async () => {
    const sender = new WebSocket(`ws://localhost:${port}/ws?room=test-room&role=sender`);
    const receiver = new WebSocket(`ws://localhost:${port}/ws?room=test-room&role=receiver`);

    await Promise.all([
      new Promise((resolve) => sender.addEventListener('open', resolve)),
      new Promise((resolve) => receiver.addEventListener('open', resolve)),
    ]);

    let peerLeftReceived = false;
    sender.addEventListener('message', (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'peer-left') peerLeftReceived = true;
    });

    receiver.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(peerLeftReceived).toBe(true);

    sender.close();
    await new Promise((resolve) => sender.addEventListener('close', resolve));
  });

  it('deletes room when both peers disconnect', async () => {
    const sender = new WebSocket(`ws://localhost:${port}/ws?room=test-room&role=sender`);
    await new Promise((resolve) => sender.addEventListener('open', resolve));
    expect(rooms.has('test-room')).toBe(true);

    sender.close();
    await new Promise((resolve) => sender.addEventListener('close', resolve));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rooms.has('test-room')).toBe(false);
  });

  it('cleans up rooms older than TTL', async () => {
    const roomId = 'old-room';
    rooms.set(roomId, { createdAt: Date.now() - (31 * 60 * 1000) });
    expect(rooms.has(roomId)).toBe(true);

    cleanupRooms();
    expect(rooms.has(roomId)).toBe(false);
  });
});
