// Minimal FITS reader: primary HDU, BITPIX 8/16/32/-32/-64, NAXIS 2 or 3 (planes = channels).
// Returns float32 planes scaled by BZERO/BSCALE. No compression, no extensions.

export interface FitsImage {
  width: number;
  height: number;
  channels: Float32Array[];
  header: Record<string, string>;
}

const BLOCK = 2880;

function parseHeader(buf: ArrayBuffer): { header: Record<string, string>; dataOffset: number } {
  const bytes = new Uint8Array(buf);
  const header: Record<string, string> = {};
  let pos = 0;
  for (;;) {
    if (pos + 80 > bytes.length) throw new Error('FITS: header has no END card');
    const card = String.fromCharCode(...bytes.subarray(pos, pos + 80));
    pos += 80;
    const key = card.slice(0, 8).trim();
    if (key === 'END') break;
    if (card[8] !== '=') continue;
    let value = card.slice(10).split('/')[0].trim();
    if (value.startsWith("'")) value = value.slice(1, value.lastIndexOf("'")).trim();
    header[key] = value;
  }
  return { header, dataOffset: Math.ceil(pos / BLOCK) * BLOCK };
}

export function parseFits(buf: ArrayBuffer): FitsImage {
  const { header, dataOffset } = parseHeader(buf);
  const bitpix = Number(header.BITPIX);
  const naxis  = Number(header.NAXIS);
  if (naxis !== 2 && naxis !== 3) throw new Error(`FITS: unsupported NAXIS ${naxis}`);
  const width  = Number(header.NAXIS1);
  const height = Number(header.NAXIS2);
  const planes = naxis === 3 ? Number(header.NAXIS3) : 1;
  const bzero  = Number(header.BZERO  ?? 0);
  const bscale = Number(header.BSCALE ?? 1);
  const n = width * height;
  const view = new DataView(buf, dataOffset);
  const bytesPer = Math.abs(bitpix) / 8;
  if (view.byteLength < n * planes * bytesPer) throw new Error('FITS: data shorter than header claims');

  const read: (i: number) => number =
    bitpix === 8   ? i => view.getUint8(i)
    : bitpix === 16  ? i => view.getInt16(i * 2, false)
    : bitpix === 32  ? i => view.getInt32(i * 4, false)
    : bitpix === -32 ? i => view.getFloat32(i * 4, false)
    : bitpix === -64 ? i => view.getFloat64(i * 8, false)
    : (() => { throw new Error(`FITS: unsupported BITPIX ${bitpix}`); })();

  const channels: Float32Array[] = [];
  for (let p = 0; p < planes; p++) {
    const plane = new Float32Array(n);
    const base = p * n;
    // FITS rows run bottom-up; flip so row 0 is the top of the image.
    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * width;
      const dstRow = y * width;
      for (let x = 0; x < width; x++) plane[dstRow + x] = read(base + srcRow + x) * bscale + bzero;
    }
    channels.push(plane);
  }
  return { width, height, channels, header };
}
