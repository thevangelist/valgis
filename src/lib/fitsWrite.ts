// Write float32 FITS (BITPIX -32), one or three planes, carrying the source header cards over.
const BLOCK = 2880;
const STRUCTURAL = new Set(['SIMPLE', 'BITPIX', 'NAXIS', 'NAXIS1', 'NAXIS2', 'NAXIS3', 'EXTEND', 'BZERO', 'BSCALE', 'END']);

function card(key: string, value: string | number | boolean, comment = ''): string {
  const v = typeof value === 'boolean' ? (value ? 'T' : 'F').padStart(20)
    : typeof value === 'number' ? String(value).padStart(20)
    : `'${value.replace(/'/g, "''").padEnd(8)}'`;
  return `${key.padEnd(8)}= ${v}${comment ? ` / ${comment}` : ''}`.padEnd(80).slice(0, 80);
}

export function writeFits(channels: Float32Array[], width: number, height: number, header: Record<string, string> = {}, history: string[] = []): ArrayBuffer {
  const cards = [card('SIMPLE', true), card('BITPIX', -32), card('NAXIS', channels.length > 1 ? 3 : 2), card('NAXIS1', width), card('NAXIS2', height)];
  if (channels.length > 1) cards.push(card('NAXIS3', channels.length));
  cards.push(card('BZERO', 0), card('BSCALE', 1));
  for (const [k, v] of Object.entries(header)) {
    if (STRUCTURAL.has(k) || !/^[A-Z0-9_-]{1,8}$/.test(k)) continue;
    const num = Number(v);
    cards.push(card(k, v !== '' && Number.isFinite(num) && /^[-+0-9.eE]+$/.test(v) ? num : v === 'T' || v === 'F' ? v === 'T' : v));
  }
  history.forEach(h => cards.push(`HISTORY ${h}`.padEnd(80).slice(0, 80)));
  cards.push('END'.padEnd(80));
  const headLen = Math.ceil(cards.length * 80 / BLOCK) * BLOCK;
  const n = width * height, dataLen = Math.ceil(n * channels.length * 4 / BLOCK) * BLOCK;
  const buf = new ArrayBuffer(headLen + dataLen);
  const bytes = new Uint8Array(buf);
  bytes.fill(0x20, 0, headLen);
  cards.forEach((c, i) => { for (let j = 0; j < 80; j++) bytes[i * 80 + j] = c.charCodeAt(j); });
  const dv = new DataView(buf, headLen);
  channels.forEach((p, c) => {
    // Rows bottom-up, as FITS expects; parseFits flipped them on the way in.
    for (let y = 0; y < height; y++) {
      const src = (height - 1 - y) * width, dst = (c * n + y * width) * 4;
      for (let x = 0; x < width; x++) dv.setFloat32(dst + x * 4, p[src + x], false);
    }
  });
  return buf;
}
