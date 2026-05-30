// Конвертация webm -> mp4 прямо в браузере через ffmpeg.wasm.
//
// Берём ОДНОПОТОЧНОЕ ядро (@ffmpeg/core): оно не требует SharedArrayBuffer и,
// значит, кросс-изоляции (COOP/COEP). Это важно — изоляция сломала бы загрузку
// сэмплов Strudel с GitHub. Цена: кодирование медленнее (один поток, софтверный
// x264). Всё грузится с CDN при первом вызове (~31МБ ядро, потом кэш браузера),
// поэтому модуль импортируется лениво из main.js.

const FFMPEG_VER = '0.12.15';
const UTIL_VER = '0.12.2';
const CORE_VER = '0.12.10';

let ready = null;        // Promise<{ ffmpeg, util }>
let progressCb = null;   // текущий колбэк прогресса

async function getFFmpeg(onLog) {
  if (ready) return ready;
  ready = (async () => {
    // динамический импорт прямо с CDN (@vite-ignore — чтобы Vite не трогал)
    const { FFmpeg } = await import(
      /* @vite-ignore */ `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${FFMPEG_VER}/dist/esm/index.js`
    );
    const util = await import(
      /* @vite-ignore */ `https://cdn.jsdelivr.net/npm/@ffmpeg/util@${UTIL_VER}/dist/esm/index.js`
    );
    const base = `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VER}/dist/esm`;

    const ffmpeg = new FFmpeg();
    if (onLog) ffmpeg.on('log', ({ message }) => onLog(message));
    ffmpeg.on('progress', ({ progress }) => {
      if (progressCb) progressCb(Math.max(0, Math.min(1, progress)));
    });

    await ffmpeg.load({
      // toBlobURL скачивает файл с CDN и отдаёт same-origin blob: URL —
      // так воркер и ядро грузятся без требования cross-origin isolation
      coreURL: await util.toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await util.toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      classWorkerURL: await util.toBlobURL(
        `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${FFMPEG_VER}/dist/esm/worker.js`,
        'text/javascript',
      ),
    });
    return { ffmpeg, util };
  })();
  return ready;
}

export async function convertWebmToMp4(blob, { onProgress, onLog } = {}) {
  const { ffmpeg, util } = await getFFmpeg(onLog);
  progressCb = onProgress || null;

  await ffmpeg.writeFile('in.webm', await util.fetchFile(blob));
  // veryfast preset + yuv420p (совместимость), faststart (стрим/превью), aac звук
  await ffmpeg.exec([
    '-i', 'in.webm',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'aac',
    '-b:a', '192k',
    'out.mp4',
  ]);
  const data = await ffmpeg.readFile('out.mp4');
  progressCb = null;
  return new Blob([data.buffer], { type: 'video/mp4' });
}
