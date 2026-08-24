/**
 * Paste-time image economics.
 *
 * An image costs tokens by **pixel count only** — file size is irrelevant. Measured in this
 * repo's own transcripts: a 664KB PNG and an 8KB PNG both billed 1,533 tokens, because the
 * API downscales to a fixed geometry first (long edge 1568, then a 1.15M pixel cap) and bills
 * ceil(w*h/750) on the result. Two consequences drive everything here:
 *
 *   1. Re-encoding to WebP saves upload bytes, never tokens.
 *   2. Capping the long edge at 2048 — or even 1568 — saves nothing either, because the cap
 *      above already applies. Real savings start below ~1.15M pixels.
 *
 * And the saving multiplies: an image stays in the conversation and is re-sent on every later
 * request of that session. Measured across 38 sessions: 242K tokens of images were re-read as
 * 129M tokens — 533x. One pixel dropped at paste time is dropped hundreds of times over.
 */

export const BILLED_MAX_EDGE = 1568;
export const BILLED_MAX_PIXELS = 1150336;
const PIXELS_PER_TOKEN = 750;

/** What the API will bill for an image of these dimensions, after its own resize. */
export const estimateImageTokens = (width, height) => {
  if (!width || !height || width < 0 || height < 0) return 0;
  let w = width;
  let h = height;
  const edgeScale = Math.min(1, BILLED_MAX_EDGE / Math.max(w, h));
  w *= edgeScale;
  h *= edgeScale;
  if (w * h > BILLED_MAX_PIXELS) {
    const areaScale = Math.sqrt(BILLED_MAX_PIXELS / (w * h));
    w *= areaScale;
    h *= areaScale;
  }
  return Math.ceil((w * h) / PIXELS_PER_TOKEN);
};

/** Fit inside a long-edge budget. Never upscales — a small paste stays small. */
export const fitWithin = (width, height, maxEdge) => {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
};

const CHANNEL_TOLERANCE = 12;   // JPEG ringing around a flat border
const MIN_KEPT_AREA_RATIO = 0.05;

const sameColor = (data, i, ref) =>
  Math.abs(data[i] - ref[0]) <= CHANNEL_TOLERANCE
  && Math.abs(data[i + 1] - ref[1]) <= CHANNEL_TOLERANCE
  && Math.abs(data[i + 2] - ref[2]) <= CHANNEL_TOLERANCE;

/**
 * Box of actual content inside a uniform border — the empty desktop around a window, the
 * letterboxing a scaled capture leaves behind. Cropping beats scaling: it drops pixels
 * without touching the size of the glyphs the model has to read.
 *
 * Works on a thumbnail (caller downsamples first) so a 4K paste never allocates 33MB of
 * ImageData on a phone. Returns null when there is no uniform border to trim — the corners
 * disagree, or the trim would eat almost everything (which means the guess was wrong).
 */
export const findContentBox = ({ data, width, height }) => {
  if (!data || width < 3 || height < 3) return null;
  const at = (x, y) => (y * width + x) * 4;
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  const ref = [data[corners[0]], data[corners[0] + 1], data[corners[0] + 2]];
  if (!corners.every((i) => sameColor(data, i, ref))) return null;

  const rowIsBorder = (y) => {
    for (let x = 0; x < width; x += 1) if (!sameColor(data, at(x, y), ref)) return false;
    return true;
  };
  const colIsBorder = (x) => {
    for (let y = 0; y < height; y += 1) if (!sameColor(data, at(x, y), ref)) return false;
    return true;
  };

  let top = 0;
  let bottom = height - 1;
  let left = 0;
  let right = width - 1;
  while (top < bottom && rowIsBorder(top)) top += 1;
  while (bottom > top && rowIsBorder(bottom)) bottom -= 1;
  while (left < right && colIsBorder(left)) left += 1;
  while (right > left && colIsBorder(right)) right -= 1;

  const box = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  if (box.width === width && box.height === height) return null;           // nothing trimmed
  if (box.width * box.height < width * height * MIN_KEPT_AREA_RATIO) return null;
  return box;
};

/**
 * Scale a thumbnail-space box back onto the source image, with a small outward margin so a
 * one-pixel misjudgement at thumbnail resolution cannot shave content off the edge.
 */
export const scaleBoxToSource = (box, thumbW, thumbH, srcW, srcH) => {
  const kx = srcW / thumbW;
  const ky = srcH / thumbH;
  const pad = 2;
  const x = Math.max(0, Math.floor(box.x * kx) - Math.ceil(pad * kx));
  const y = Math.max(0, Math.floor(box.y * ky) - Math.ceil(pad * ky));
  const right = Math.min(srcW, Math.ceil((box.x + box.width) * kx) + Math.ceil(pad * kx));
  const bottom = Math.min(srcH, Math.ceil((box.y + box.height) * ky) + Math.ceil(pad * ky));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
};
