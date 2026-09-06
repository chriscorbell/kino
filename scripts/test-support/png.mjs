import { inflateSync } from 'node:zlib';

// Enough of a PNG decoder for the icon and banner gates to read pixels back out
// of what CoreGraphics and WebKit write: 8 bit RGBA, no interlacing. Anything
// else throws rather than returning plausible nonsense.
export function decodePng(buffer) {
  if (buffer.toString('binary', 1, 4) !== 'PNG') throw new Error('not a PNG');
  const parts = [];
  let width;
  let height;
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0)
        throw new Error('expected a non-interlaced 8 bit RGBA PNG');
    } else if (type === 'IDAT') parts.push(body);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  let previous = Buffer.alloc(stride);
  let read = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const line = Buffer.from(raw.subarray(read, read + stride));
    read += stride;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 4 ? line[i - 4] : 0;
      const b = previous[i];
      const c = i >= 4 ? previous[i - 4] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    line.copy(pixels, y * stride);
    previous = line;
  }
  return {
    width,
    height,
    alpha: (x, y) => pixels[(y * width + x) * 4 + 3],
    luma: (x, y) => {
      const i = (y * width + x) * 4;
      return (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000;
    },
  };
}

// The bounding box of everything at least `threshold` opaque, which for an icon
// is its shape without the drop shadow fading out around it.
export function opaqueBounds(image, threshold = 250) {
  let left = image.width;
  let top = image.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1)
    for (let x = 0; x < image.width; x += 1)
      if (image.alpha(x, y) >= threshold) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) throw new Error('image is fully transparent');
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}
