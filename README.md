# p2p-send

Minimal, no-CSS site to send files browser-to-browser over WebRTC.
The server only relays a handful of tiny signaling messages (SDP/ICE) to
introduce two browsers to each other — it never sees, stores, or touches
your files.

## How it works

1. Open `/`, pick files, click **Send**. The page opens a `RTCDataChannel`
   and prints a link like `/r?id=<room>`.
2. Send that link to the receiver.
3. When they open it, both browsers exchange a WebRTC offer/answer through
   the Hono `/ws` endpoint (plain relay, in-memory, nothing persisted).
4. Once the data channel is open, files stream directly from sender to
   receiver in chunks. The receiver gets a download link per file.
5. Close either tab and the transfer/room is gone — nothing is kept.

## Run it

```bash
npm install
npm run build   # builds the Astro static site into ./dist
npm start        # starts the Hono server (serves ./dist + /ws) on :3000
```

Open http://localhost:3000 in one tab and the generated `/r?id=...` link in
another (or on another device on the same network / with a TURN server for
NAT traversal in production).

## Notes

- Uses a public STUN server only (`stun.l.google.com`). For reliable
  transfers across strict NATs/firewalls in production, add a TURN server
  to `src/lib/rtc.ts`.
- Both browser tabs must stay open for the duration of the transfer.
