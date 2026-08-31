import { connectSignaling, newPeerConnection } from './rtc';

type FileMeta = { name: string; size: number; type: string };

export function initReceiver() {
  const roomId = new URLSearchParams(location.search).get('id') ?? '';
  const statusEl = document.getElementById('status') as HTMLElement;
  const downloadsEl = document.getElementById('downloads') as HTMLElement;
  const rxProgress = document.getElementById('rxProgress') as HTMLElement | null;
  const rxProgressBar = document.getElementById('rxProgressBar') as HTMLElement | null;

  if (typeof RTCPeerConnection === 'undefined' || typeof RTCDataChannel === 'undefined' || typeof WebSocket === 'undefined') {
    statusEl.textContent = 'Your browser does not support peer-to-peer transfers.';
    statusEl.className = 'text-sm text-red font-mono';
    return;
  }

  if (!roomId) {
    statusEl.textContent = 'No link id found. Ask the sender for a fresh link.';
    statusEl.className = 'text-sm text-red font-mono';
    return;
  }

  let meta: FileMeta[] = [];
  let chunks: ArrayBuffer[] = [];
  let currentBuffer: Uint8Array | null = null;
  let bufferOffset = 0;
  let expectedBytes = 0;
  let receivedBytes = 0;
  let lastActivity = Date.now();
  let idleTimer: number | undefined;
  let speedTimer: number | undefined;
  let lastSpeedBytes = 0;
  let lastSpeedTime = Date.now();
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;

  function updateRxProgress() {
    if (rxProgressBar && expectedBytes > 0) {
      const pct = Math.min(100, (receivedBytes / expectedBytes) * 100).toFixed(1);
      rxProgressBar.style.width = `${pct}%`;
    }
  }

  function updateSpeed() {
    if (!rxSpeedEl || expectedBytes === 0) return;
    const now = Date.now();
    const dt = now - lastSpeedTime;
    if (dt > 0) {
      const delta = receivedBytes - lastSpeedBytes;
      const bps = (delta / dt) * 1000;
      let text: string;
      if (bps >= 1024 * 1024) {
        text = `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
      } else {
        text = `${(bps / 1024).toFixed(1)} KB/s`;
      }
      rxSpeedEl.textContent = text;
    }
    lastSpeedBytes = receivedBytes;
    lastSpeedTime = now;
  }

  function setStatus(text: string, type: string) {
    statusEl.textContent = text;
    statusEl.className = `text-sm ${type} font-mono`;
  }

  ws = connectSignaling(roomId, 'receiver');
  pc = newPeerConnection();

  pc.onconnectionstatechange = () => {
    const state = pc?.connectionState;
    if (state === 'failed') {
      setStatus('Connection failed. The sender may need to use a TURN server or try a different network.', 'text-red');
    } else if (state === 'disconnected') {
      setStatus('Connection lost. The sender may have disconnected.', 'text-red');
    }
  };

  pc.onicecandidate = (e) => {
    if (e.candidate && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'signal', data: { candidate: e.candidate } }));
    }
  };

  pc.ondatachannel = (event) => {
    const channel = event.channel;
    channel.binaryType = 'arraybuffer';

    idleTimer = window.setInterval(() => {
      if (Date.now() - lastActivity > 60000) {
        channel.close();
        setStatus('Transfer stalled.', 'text-red');
        window.clearInterval(idleTimer);
        idleTimer = undefined;
      }
    }, 10000);

    channel.onmessage = (msg) => {
      lastActivity = Date.now();
      if (typeof msg.data === 'string') {
        const control = JSON.parse(msg.data);
        if (control.type === 'meta') {
          meta = control.files;
          expectedBytes = meta.reduce((sum, f) => sum + f.size, 0);
          receivedBytes = 0;
          lastSpeedBytes = 0;
          lastSpeedTime = Date.now();
          if (rxProgress) rxProgress.classList.remove('hidden');
          updateRxProgress();
          if (speedTimer) {
            window.clearInterval(speedTimer);
          }
          speedTimer = window.setInterval(updateSpeed, 1000);
          setStatus(`Receiving ${meta.length} file(s)…`, 'text-accent');
        } else if (control.type === 'file-start') {
          chunks = [];
          currentBuffer = null;
          bufferOffset = 0;
          const info = meta[control.index];
          try {
            currentBuffer = new Uint8Array(info.size);
          } catch {
            currentBuffer = null;
          }
        } else if (control.type === 'file-end') {
          const info = meta[control.index];
          let blob: Blob;
          if (currentBuffer) {
            blob = new Blob([currentBuffer], { type: info.type || 'application/octet-stream' });
            currentBuffer = null;
            bufferOffset = 0;
          } else {
            blob = new Blob(chunks, { type: info.type || 'application/octet-stream' });
          }
          const url = URL.createObjectURL(blob);
          const li = document.createElement('li');
          li.className = 'flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 p-3 border-2 border-border bg-surface hover:border-text transition-colors';
          const a = document.createElement('a');
          a.href = url;
          a.download = info.name;
          a.className = 'inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-accent hover:text-accent-hover transition-colors font-mono';
           const arrow = document.createElement('span');
           arrow.textContent = '[↓]';
           a.appendChild(arrow);
           const nameSpan = document.createElement('span');
           nameSpan.className = 'truncate break-words';
           nameSpan.textContent = info.name;
           a.appendChild(nameSpan);
          const size = document.createElement('span');
          size.className = 'text-[10px] sm:text-xs text-text-dim font-mono sm:ml-auto';
          size.textContent = `${(info.size / 1024).toFixed(1)} KB`;
          li.appendChild(a);
          li.appendChild(size);
          downloadsEl.appendChild(li);
          chunks = [];
        } else if (control.type === 'done') {
          if (idleTimer) {
            window.clearInterval(idleTimer);
            idleTimer = undefined;
          }
          if (speedTimer) {
            window.clearInterval(speedTimer);
            speedTimer = undefined;
          }
          setStatus('All files received.', 'text-accent');
          if (rxProgress) rxProgress.classList.add('hidden');
        }
      } else {
        if (currentBuffer) {
          try {
            const view = new Uint8Array(msg.data as ArrayBuffer);
            currentBuffer.set(view, bufferOffset);
            bufferOffset += view.byteLength;
          } catch {
            currentBuffer = null;
            chunks.push(msg.data as ArrayBuffer);
          }
        } else {
          chunks.push(msg.data as ArrayBuffer);
        }
        receivedBytes += (msg.data as ArrayBuffer).byteLength;
        updateRxProgress();
      }
    };

    channel.onclose = () => {
      if (idleTimer) {
        window.clearInterval(idleTimer);
        idleTimer = undefined;
      }
      if (speedTimer) {
        window.clearInterval(speedTimer);
        speedTimer = undefined;
      }
      if (receivedBytes < expectedBytes && expectedBytes > 0) {
        setStatus('Transfer interrupted.', 'text-red');
      }
    };
  };

  ws.onmessage = async (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.type === 'signal') {
      const { sdp, candidate } = msg.data;
      if (sdp) {
        await pc!.setRemoteDescription(sdp);
        const answer = await pc!.createAnswer();
        await pc!.setLocalDescription(answer);
        ws!.send(JSON.stringify({ type: 'signal', data: { sdp: answer } }));
      }
      if (candidate) await pc!.addIceCandidate(candidate).catch(() => {});
    } else if (msg.type === 'peer-left') {
      if (idleTimer) {
        window.clearInterval(idleTimer);
        idleTimer = undefined;
      }
      if (speedTimer) {
        window.clearInterval(speedTimer);
        speedTimer = undefined;
      }
      setStatus('Sender disconnected.', 'text-red');
    } else if (msg.type === 'peer-timeout') {
      setStatus('Room will expire in 5 minutes. Complete your transfer soon.', 'text-amber');
    }
  };

  ws.onclose = () => {
    if (idleTimer) {
      window.clearInterval(idleTimer);
      idleTimer = undefined;
    }
    if (receivedBytes < expectedBytes && expectedBytes > 0) {
      setStatus('Signaling connection closed. Transfer interrupted.', 'text-red');
    }
  };
}
