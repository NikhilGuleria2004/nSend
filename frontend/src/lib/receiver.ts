import { connectSignaling, newPeerConnection } from './rtc';

type FileMeta = { name: string; size: number; type: string };

export function initReceiver() {
  const roomId = new URLSearchParams(location.search).get('id') ?? '';
  const statusEl = document.getElementById('status') as HTMLElement;
  const downloadsEl = document.getElementById('downloads') as HTMLElement;
  const rxProgress = document.getElementById('rxProgress') as HTMLElement | null;
  const rxProgressBar = document.getElementById('rxProgressBar') as HTMLElement | null;

  if (!roomId) {
    statusEl.textContent = 'No link id found. Ask the sender for a fresh link.';
    statusEl.className = 'text-sm text-red font-mono';
    return;
  }

  let meta: FileMeta[] = [];
  let chunks: ArrayBuffer[] = [];
  let expectedBytes = 0;
  let receivedBytes = 0;
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;

  function updateRxProgress() {
    if (rxProgressBar && expectedBytes > 0) {
      const pct = Math.min(100, (receivedBytes / expectedBytes) * 100).toFixed(1);
      rxProgressBar.style.width = `${pct}%`;
    }
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
    channel.onmessage = (msg) => {
      if (typeof msg.data === 'string') {
        const control = JSON.parse(msg.data);
        if (control.type === 'meta') {
          meta = control.files;
          expectedBytes = meta.reduce((sum, f) => sum + f.size, 0);
          receivedBytes = 0;
          if (rxProgress) rxProgress.classList.remove('hidden');
          updateRxProgress();
          setStatus(`Receiving ${meta.length} file(s)…`, 'text-accent');
        } else if (control.type === 'file-start') {
          chunks = [];
        } else if (control.type === 'file-end') {
          const info = meta[control.index];
          const blob = new Blob(chunks, { type: info.type || 'application/octet-stream' });
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
           nameSpan.className = 'truncate';
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
          setStatus('All files received.', 'text-accent');
          if (rxProgress) rxProgress.classList.add('hidden');
        }
      } else {
        chunks.push(msg.data as ArrayBuffer);
        receivedBytes += (msg.data as ArrayBuffer).byteLength;
        updateRxProgress();
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
      setStatus('Sender disconnected.', 'text-red');
    }
  };

  ws.onclose = () => {
    if (receivedBytes < expectedBytes && expectedBytes > 0) {
      setStatus('Signaling connection closed. Transfer interrupted.', 'text-red');
    }
  };
}
