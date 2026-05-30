// Запись AV-клипа: видео с canvas + аудио из Strudel.
// Длина подбирается как целое ЧЁТНОЕ число музыкальных циклов,
// чтобы клип закольцовывался без шва, но не длиннее maxSeconds.

function pickMime() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  for (const m of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

// вычисляем длительность клипа в секундах
export function computeClipDuration(cps, maxSeconds = 60) {
  const cycleDur = 1 / cps; // секунд в одном цикле
  let cycles = Math.floor(maxSeconds / cycleDur);
  if (cycles % 2 !== 0) cycles -= 1; // делаем чётным
  if (cycles >= 2) {
    return { seconds: cycles * cycleDur, cycles };
  }
  // цикл слишком длинный — не влезает даже 2. Берём 1 цикл или maxSeconds.
  const fallback = Math.min(maxSeconds, cycleDur);
  return { seconds: fallback, cycles: fallback / cycleDur };
}

// canvas: HTMLCanvasElement, audioStream: MediaStream | null
// возвращает Promise<Blob>
export function recordClip({ canvas, audioStream, durationSec, fps = 60, onProgress }) {
  return new Promise((resolve, reject) => {
    const mime = pickMime();
    if (!mime) {
      reject(new Error('MediaRecorder/webm не поддерживается этим браузером'));
      return;
    }

    const videoStream = canvas.captureStream(fps);
    const tracks = [...videoStream.getVideoTracks()];
    if (audioStream) tracks.push(...audioStream.getAudioTracks());
    const combined = new MediaStream(tracks);

    const chunks = [];
    let recorder;
    try {
      recorder = new MediaRecorder(combined, {
        mimeType: mime,
        videoBitsPerSecond: 8_000_000,
      });
    } catch (e) {
      reject(e);
      return;
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = (e) => reject(e.error || new Error('ошибка записи'));
    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: mime }));
    };

    recorder.start();

    const startedAt = performance.now();
    if (onProgress) {
      const tick = () => {
        const t = (performance.now() - startedAt) / 1000;
        onProgress(Math.min(1, t / durationSec));
        if (recorder.state === 'recording') requestAnimationFrame(tick);
      };
      tick();
    }

    setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, durationSec * 1000);
  });
}

export function downloadBlob(blob, filename = 'av-clip.webm') {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
