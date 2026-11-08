// Node side of extraction. The logic lives in core/ so the web trial runs the same code.
export { sample, batches, merge, SYSTEM, normalize, buildPrompt, objectStream, locate, hash } from "./core/extract.js";
import { liveExtract } from "./core/live.js";

// The terminal path: same live run, progress printed instead of streamed to a page.
export async function extractWithModel(provider, picked, { onProgress, emit, maxBatches = 4, signal } = {}) {
  let done = 0, total = 0;
  const r = await liveExtract({
    picked, provider, maxBatches, signal,
    emit: (type, data) => {
      emit?.(type, data);
      if (type === "plan") total = data.batches;
      if (type === "batch" && data.state === "done") onProgress?.(++done, total);
      if (type === "warn") onProgress?.(++done, total, new Error(data.message));
    },
  });
  return r.items;
}
