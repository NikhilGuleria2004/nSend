import { connectSignaling, newPeerConnection } from './rtc';

const CHUNK_SIZE = 16 * 1024;
const JOIN_TIMEOUT = 60000;

export function initSender() {
  const filesInput = document.getElementById('files') as HTMLInputElement;
  const sendBtn = document.getElementById('send') as HTMLButtonElement;
  const statusEl = document.getElementById('status') as HTMLElement;
  const linkEl = document.getElementById('link') as HTMLElement;
  const progressArea = document.getElementById('progressArea') as HTMLElement | null;
  const progressBar = document.getElementById('progressBar') as HTMLElement | null;
  const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement | null;

  let joinTimer: number;
  let totalBytes = 0;
  let sentBytes = 0;
  let ws: WebSocket | null = null;
  let pc: RTCPeerConnection | null = null;

  function updateProgress() {
    if (progressBar && totalBytes > 0) {
      const pct = Math.min(100, (sentBytes / totalBytes) * 100).toFixed(1);
      progressBar.style.width = `${pct}%`;
    }
  }

  function reset() {
    window.clearTimeout(joinTimer);
    ws?.close();
    pc?.close();
    ws = null;
    pc = null;
    sendBtn.disabled = false;
    if (progressArea) progressArea.classList.add('hidden');
    updateProgress();
  }

  function setStatus(text: string, type: string) {
    statusEl.textContent = text;
    statusEl.className = `text-sm ${type} h-5 font-mono`;
  }

  cancelBtn?.addEventListener('click', () => {
    reset();
    setStatus('Transfer cancelled.', 'text-red');
    linkEl.innerHTML = '';
  });

  sendBtn.addEventListener('click', async () => {
    const files = filesInput.files;
    if (!files || files.length === 0) {
      setStatus('Choose at least one file.', 'text-red');
      return;
    }
    reset();
    sendBtn.disabled = true;

    const room = crypto.randomUUID();
    const link = `${location.origin}/r?id=${room}`;
    linkEl.innerHTML = `Share this link with the receiver: <a href="${link}" class="text-accent underline hover:text-accent-hover transition-colors break-all font-mono">${link}</a><button id="copyBtn" class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-mono text-text-muted bg-surface border-2 border-border hover:border-text hover:text-text transition-colors whitespace-nowrap flex-shrink-0">[COPY]</button>`;
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(link);
          copyBtn.textContent = '[COPIED]';
          copyBtn.classList.add('bg-text', 'text-bg');
          setTimeout(() => {
            copyBtn.textContent = '[COPY]';
            copyBtn.classList.remove('bg-text', 'text-bg');
          }, 2000);
        } catch {
          copyBtn.textContent = '[FAIL]';
        }
      });
    }

    totalBytes = Array.from(files).reduce((sum, f) => sum + f.size, 0);
    sentBytes = 0;
    if (progressArea) progressArea.classList.remove('hidden');
    updateProgress();

    setStatus('Waiting for the receiver to open the link…', 'text-amber');

    joinTimer = window.setTimeout(() => {
      setStatus('Timed out waiting for receiver. Share the link again or try a different network.', 'text-red');
      sendBtn.disabled = false;
    }, JOIN_TIMEOUT);

    ws = connectSignaling(room, 'sender');
    pc = newPeerConnection();

    pc.onconnectionstatechange = () => {
      const state = pc?.connectionState;
      if (state === 'failed') {
        setStatus('Connection failed. Try again on a different network or use a TURN server.', 'text-red');
        sendBtn.disabled = false;
      } else if (state === 'disconnected') {
        setStatus('Connection lost. The receiver may have disconnected.', 'text-red');
        sendBtn.disabled = false;
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'signal', data: { candidate: e.candidate } }));
      }
    };

    ws.onmessage = async (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'peer-joined') {
        window.clearTimeout(joinTimer);
        setStatus('Receiver joined. Connecting…', 'text-amber');
        try {
          const offer = await pc!.createOffer();
          await pc!.setLocalDescription(offer);
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'signal', data: { sdp: offer } }));
          }
        } catch {
          setStatus('Failed to create offer.', 'text-red');
          sendBtn.disabled = false;
        }
      } else if (msg.type === 'signal') {
        const { sdp, candidate } = msg.data;
        if (sdp && pc) await pc.setRemoteDescription(sdp).catch(() => {});
        if (candidate && pc) await pc.addIceCandidate(candidate).catch(() => {});
      } else if (msg.type === 'peer-left') {
        setStatus('Receiver disconnected.', 'text-red');
        sendBtn.disabled = false;
      }
    };

    ws.onclose = () => {
      if (sentBytes < totalBytes && totalBytes > 0) {
        setStatus('Signaling connection closed.', 'text-red');
        sendBtn.disabled = false;
      }
    };

    const channel = pc.createDataChannel('files');
    channel.binaryType = 'arraybuffer';

    channel.onopen = async () => {
      setStatus('Connected. Sending…', 'text-amber');
      const fileList = Array.from(files);
      channel.send(JSON.stringify({
        type: 'meta',
        files: fileList.map((f) => ({ name: f.name, size: f.size, type: f.type }))
      }));
      for (let i = 0; i < fileList.length; i++) {
        await sendFile(channel, fileList[i], i);
      }
      channel.send(JSON.stringify({ type: 'done' }));
      setStatus('All files sent.', 'text-accent');
      sendBtn.disabled = false;
    };

    channel.onclose = () => {
      if (sentBytes < totalBytes && totalBytes > 0) {
        setStatus('Transfer interrupted.', 'text-red');
        sendBtn.disabled = false;
      }
    };
  });

  async function sendFile(channel: RTCDataChannel, file: File, index: number) {
    channel.send(JSON.stringify({ type: 'file-start', index }));
    const buf = await file.arrayBuffer();
    let offset = 0;
    while (offset < buf.byteLength) {
      if (channel.bufferedAmount > 8 * CHUNK_SIZE) {
        await new Promise((r) => setTimeout(r, 10));
        continue;
      }
      const slice = buf.slice(offset, offset + CHUNK_SIZE);
      channel.send(slice);
      sentBytes += slice.byteLength;
      updateProgress();
      offset += CHUNK_SIZE;
    }
    channel.send(JSON.stringify({ type: 'file-end', index }));
  }
}
