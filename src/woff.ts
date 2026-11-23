// WOFF / WOFF2 -> sfnt (TTF/OTF) conversion, so web fonts can be used as
// fallback fonts. pdfkit and the cmap reader only understand raw sfnt data.
//
// WOFF1 is zlib-compressed per table: decoded with the platform's
// DecompressionStream (Electron, iOS 16.4+, Android WebView), no dependency.
// WOFF2 needs Brotli plus the glyf/loca transform, so it uses woff2-encoder's
// decoder (WASM). It is imported dynamically, so it only runs when a WOFF2
// font is actually used.

function tag(v: DataView, o: number): string {
    return String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
    if (typeof window.DecompressionStream === 'undefined') {
        throw new Error('WOFF needs DecompressionStream, which this device lacks; use a .ttf/.otf file');
    }
    const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new window.DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function woff1ToSfnt(buf: ArrayBuffer): Promise<ArrayBuffer> {
    const v = new DataView(buf);
    const src = new Uint8Array(buf);
    const n = v.getUint16(12);
    const tables: { tag: number; data: Uint8Array; sum: number }[] = [];
    for (let i = 0; i < n; i++) {
        const r = 44 + i * 20;
        const off = v.getUint32(r + 4), comp = v.getUint32(r + 8), orig = v.getUint32(r + 12);
        if (off + comp > buf.byteLength) throw new Error('corrupt WOFF');
        const raw = src.subarray(off, off + comp);
        const data = comp < orig ? await inflate(raw) : raw;
        if (data.length !== orig) throw new Error('corrupt WOFF table');
        tables.push({ tag: v.getUint32(r), data, sum: v.getUint32(r + 16) });
    }
    const headerLen = 12 + 16 * n;
    const total = tables.reduce((s, t) => s + ((t.data.length + 3) & ~3), headerLen);
    const out = new Uint8Array(total);
    const ov = new DataView(out.buffer);
    ov.setUint32(0, v.getUint32(4));
    ov.setUint16(4, n);
    let pow = 1, log = 0;
    while (pow * 2 <= n) { pow *= 2; log++; }
    ov.setUint16(6, pow * 16);
    ov.setUint16(8, log);
    ov.setUint16(10, n * 16 - pow * 16);
    let pos = headerLen;
    tables.forEach((t, i) => {
        const r = 12 + i * 16;
        ov.setUint32(r, t.tag);
        ov.setUint32(r + 4, t.sum);
        ov.setUint32(r + 8, pos);
        ov.setUint32(r + 12, t.data.length);
        out.set(t.data, pos);
        pos += (t.data.length + 3) & ~3;
    });
    return out.buffer;
}

/** Returns raw sfnt data for TTF/OTF/TTC (unchanged), WOFF and WOFF2 input. */
export async function toSfnt(buf: ArrayBuffer): Promise<ArrayBuffer> {
    if (buf.byteLength < 12) throw new Error('not a font file');
    const sig = tag(new DataView(buf), 0);
    if (sig === 'wOFF') return woff1ToSfnt(buf);
    if (sig === 'wOF2') {
        const { default: decompress } = await import('woff2-encoder/decompress');
        const out = await decompress(new Uint8Array(buf));
        return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
    }
    return buf;
}
