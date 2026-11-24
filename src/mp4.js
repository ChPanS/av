import ffmpegWorker from '@ffmpeg/ffmpeg/worker?worker&url';

const core = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
let ready;
let progress;

async function blobURL(name, type) {
  const response = await fetch(core + '/' + name);
  if (!response.ok) throw new Error('Could not load the MP4 encoder (' + response.status + ').');
  return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type }));
}

function getEncoder() {
  ready ??= (async () => {
    const { FFmpeg } = await import('@ffmpeg/ffmpeg');
    const encoder = new FFmpeg();
    encoder.on('progress', ({ progress: value }) => progress?.(Math.max(0, Math.min(1, value))));
    const coreURL = await blobURL('ffmpeg-core.js', 'text/javascript');
    let wasmURL;
    try {
      wasmURL = await blobURL('ffmpeg-core.wasm', 'application/wasm');
      await encoder.load({ classWorkerURL: ffmpegWorker, coreURL, wasmURL });
      return encoder;
    } catch (error) {
      encoder.terminate();
      throw error;
    } finally {
      URL.revokeObjectURL(coreURL);
      if (wasmURL) URL.revokeObjectURL(wasmURL);
    }
  })().catch(error => {
    ready = null;
    throw error;
  });
  return ready;
}

export async function convertWebmToMp4(blob, { onProgress } = {}) {
  const encoder = await getEncoder();
  progress = onProgress;
  try {
    await encoder.writeFile('input.webm', new Uint8Array(await blob.arrayBuffer()));
    const status = await encoder.exec([
      '-i', 'input.webm', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-c:a', 'aac', '-b:a', '192k', 'output.mp4',
    ]);
    if (status !== 0) throw new Error('MP4 encoder exited with status ' + status);
    const data = await encoder.readFile('output.mp4');
    return new Blob([data], { type: 'video/mp4' });
  } finally {
    progress = null;
    await Promise.allSettled([encoder.deleteFile('input.webm'), encoder.deleteFile('output.mp4')]);
  }
}
