import fixWebmDuration from 'fix-webm-duration';

export function recordingMime(format) {
  const mp4 = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4'];
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return (format === 'mp4' ? [...mp4, ...webm] : webm)
    .find(mime => globalThis.MediaRecorder?.isTypeSupported(mime));
}

export function recordClip({ canvas, audioStream, mime, fps, from, to, getClock, signal, onProgress }) {
  return new Promise((resolve, reject) => {
    if (!mime || !canvas.captureStream || !audioStream?.getAudioTracks().length) {
      reject(new Error('Audio/video recording is unavailable in this browser.'));
      return;
    }
    const video = canvas.captureStream(fps).getVideoTracks()[0];
    const stream = new MediaStream([video, ...audioStream.getAudioTracks()]);
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: canvas.height >= 1080 ? 12_000_000 : 7_000_000 });
    } catch (error) {
      video.stop();
      reject(error);
      return;
    }

    const chunks = [];
    const timeout = performance.now() + 12000;
    let timer;
    let lastCycle;
    let lastMotion = performance.now();
    let stopping = false;
    let startedAt;
    let duration;
    const cleanup = () => {
      clearInterval(timer);
      signal.removeEventListener('abort', abort);
      video.stop();
    };
    const abort = () => {
      if (recorder.state !== 'inactive') recorder.stop();
      cleanup();
      reject(new DOMException('Export cancelled', 'AbortError'));
    };

    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onerror = event => {
      cleanup();
      reject(event.error || new Error('Recording failed.'));
    };
    recorder.onstop = () => {
      cleanup();
      if (!chunks.length) reject(new Error('Recorder produced no video.'));
      else {
        const blob = new Blob(chunks, { type: recorder.mimeType || mime });
        resolve(blob.type.includes('webm') ? fixWebmDuration(blob, duration, { logger: false }) : blob);
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }

    timer = setInterval(() => {
      if (stopping) return;
      const cycle = getClock()?.cycle;
      if (cycle !== undefined && cycle !== lastCycle) {
        lastCycle = cycle;
        lastMotion = performance.now();
      }
      if (performance.now() - lastMotion > 12000) {
        abort();
        return;
      }
      if (recorder.state === 'inactive') {
        if (cycle >= from) {
          try {
            recorder.start(500);
            startedAt = performance.now();
          } catch (error) { cleanup(); reject(error); }
        } else if (performance.now() > timeout) {
          cleanup();
          reject(new Error('Playback did not reach the export range.'));
        }
      } else if (cycle >= to) {
        duration = performance.now() - startedAt;
        stopping = true;
        clearInterval(timer);
        recorder.stop();
      } else {
        onProgress?.(Math.min(1, (cycle - from) / (to - from)));
      }
    }, 8);
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
