import { App, Platform, TFile, normalizePath, requestUrl } from 'obsidian';
import { ImageNode } from './types';

/**
 * Loads image sources into data URLs pdfkit can embed.
 *
 * pdfkit only decodes baseline/progressive JPEG and non-interlaced PNG. Anything
 * else (WebP, GIF, BMP, SVG, interlaced PNG) is re-encoded to PNG through a
 * canvas, which uses the same decoders Obsidian itself displays images with.
 * To support another source kind (e.g. a remote cache) add a branch to
 * `readBytes`; to support another format add it to `sniff` or let the canvas
 * path handle it.
 */

// Longest edge, in pixels, of any embedded raster. ~1800px is about 220 dpi
// across a full A4/Letter text width: sharper than print needs, and it keeps a
// 12 MP phone photo from inflating the PDF (and the heap) by tens of MB.
// Phones get a lower cap because canvas/heap limits are much tighter there.
const MAX_EMBED_DIM = Platform.isMobile ? 1400 : 1800;
const MAX_CANVAS_DIM = Platform.isMobile ? 2048 : 3000;
const SVG_RASTER_SCALE = 2;
const JPEG_QUALITY = 0.85;
// Re-encoding costs time and can only help when the file is not already small.
const RECOMPRESS_MIN_BYTES = 400 * 1024;

interface Sniffed { mime: string; width?: number; height?: number; interlaced?: boolean }

export function sniffImage(b: Uint8Array): Sniffed | null {
    // PNG: IHDR holds big-endian width/height at 16..24 and the interlace flag at 28.
    if (b.length > 29 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
        const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        return { mime: 'image/png', width: dv.getUint32(16), height: dv.getUint32(20), interlaced: b[28] === 1 };
    }
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
        let pos = 2;
        while (pos + 9 < b.length) {
            if (b[pos] !== 0xff) { pos++; continue; }
            const marker = b[pos + 1];
            if (marker === 0xff) { pos++; continue; }
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
                return { mime: 'image/jpeg', height: (b[pos + 5] << 8) | b[pos + 6], width: (b[pos + 7] << 8) | b[pos + 8] };
            }
            pos += 2 + ((b[pos + 2] << 8) | b[pos + 3]);
        }
        return { mime: 'image/jpeg' };
    }
    return null;
}

export function toBase64(bytes: Uint8Array): string {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
    }
    return btoa(bin);
}

/** An error whose message is safe to show in the PDF. Anything else becomes a generic reason. */
class LoadError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
    let timer = 0;
    const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new LoadError(message)), ms);
    });
    return Promise.race([p, timeout]).finally(() => window.clearTimeout(timer));
}

interface Loaded { dataUrl: string; width?: number; height?: number }

export class ImageLoader {
    private cache = new Map<string, Promise<Loaded>>();

    constructor(private app: App) {}

    /** Fills dataUrl/naturalWidth/naturalHeight, or sets unresolvedReason. Never throws. */
    async load(img: ImageNode, sourcePath: string): Promise<void> {
        if (img.unresolvedReason) return;
        // Key on the resolved file so "a.png", "./a.png" and "folder/../a.png" decode once.
        const resolved = !img.svg && img.vault ? this.resolveVaultFile(img.src, sourcePath)?.path : undefined;
        const key = img.svg ? `svg:${img.svg.length}:${img.svg.slice(0, 200)}` : `${img.vault ? 'v' : 'u'}:${resolved ?? img.src}`;
        let pending = this.cache.get(key);
        if (!pending) {
            pending = this.loadUncached(img, sourcePath);
            this.cache.set(key, pending);
        }
        try {
            const r = await pending;
            img.dataUrl = r.dataUrl;
            img.naturalWidth = r.width;
            img.naturalHeight = r.height;
        } catch (err) {
            console.warn('[Print-Ready PDF] Image not embedded', img.src, err);
            img.unresolvedReason = err instanceof LoadError ? err.message : 'could not be read';
        }
    }

    private async loadUncached(img: ImageNode, sourcePath: string): Promise<Loaded> {
        if (img.svg) {
            return this.rasterize(new TextEncoder().encode(img.svg), 'image/svg+xml', img.width, img.height);
        }
        const { bytes, hint } = await this.readBytes(img, sourcePath);
        const info = sniffImage(bytes);
        const oversized = !!info && !!info.width && !!info.height
            && (Math.max(info.width, info.height) > MAX_EMBED_DIM
                || (bytes.length > RECOMPRESS_MIN_BYTES && Math.max(info.width, info.height) > MAX_EMBED_DIM * 0.75));
        if (info && !info.interlaced && !oversized) {
            return { dataUrl: `data:${info.mime};base64,${toBase64(bytes)}`, width: info.width, height: info.height };
        }
        return this.rasterize(bytes, info?.mime ?? hint, undefined, undefined, MAX_EMBED_DIM);
    }

    private async readBytes(img: ImageNode, sourcePath: string): Promise<{ bytes: Uint8Array; hint: string }> {
        if (img.vault) {
            const file = this.resolveVaultFile(img.src, sourcePath);
            if (!file) throw new LoadError('not found');
            const bytes = new Uint8Array(await this.app.vault.readBinary(file));
            return { bytes, hint: mimeForExt(file.extension) };
        }
        const src = img.src;
        if (src.startsWith('data:')) {
            const m = src.match(/^data:([^;,]*)(;base64)?,(.*)$/s);
            if (!m) throw new LoadError('invalid data URL');
            const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
            const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
            return { bytes, hint: m[1] || 'application/octet-stream' };
        }
        if (/^https?:/i.test(src)) {
            const res = await withTimeout(requestUrl({ url: src }), 15_000, 'remote image timed out');
            return { bytes: new Uint8Array(res.arrayBuffer), hint: res.headers['content-type'] ?? '' };
        }
        // app:// / capacitor:// resource URLs for vault files rendered by Obsidian.
        const res = await fetch(src);
        if (!res.ok) throw new LoadError(`HTTP ${res.status}`);
        return { bytes: new Uint8Array(await res.arrayBuffer()), hint: res.headers.get('content-type') ?? '' };
    }

    private resolveVaultFile(link: string, sourcePath: string): TFile | null {
        const linkPath = decodeSafe(link.split('#')[0]);
        const sourceFolder = sourcePath.includes('/') ? sourcePath.slice(0, sourcePath.lastIndexOf('/')) : '';
        let file: unknown = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
        if (!(file instanceof TFile)) {
            file = this.app.vault.getAbstractFileByPath(normalizePath(`${sourceFolder}/${linkPath}`));
        }
        return file instanceof TFile ? file : null;
    }

    /** Decode with the browser and re-encode as PNG. */
    private async rasterize(bytes: Uint8Array, mime: string, w?: number, h?: number, maxDim = MAX_CANVAS_DIM): Promise<Loaded> {
        const type = mime.startsWith('image/') ? mime : 'application/octet-stream';
        // SVG goes through a data: URL: a blob: URL taints the canvas when the SVG
        // contains <foreignObject> (mermaid), which makes toDataURL throw.
        const isSvgSrc = type === 'image/svg+xml';
        const url = isSvgSrc
            ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new TextDecoder().decode(bytes))}`
            : URL.createObjectURL(new Blob([bytes], { type }));
        try {
            const el = new Image();
            el.decoding = 'async';
            await new Promise<void>((resolve, reject) => {
                el.onload = () => resolve();
                el.onerror = () => reject(new LoadError('format not supported'));
                el.src = url;
            });
            const isSvg = type === 'image/svg+xml';
            const baseW = el.naturalWidth || w || 800;
            const baseH = el.naturalHeight || h || 600;
            const k = isSvg ? SVG_RASTER_SCALE : 1;
            let cw = baseW * k;
            let ch = baseH * k;
            const over = Math.max(cw, ch) / maxDim;
            if (over > 1) { cw /= over; ch /= over; }
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(cw));
            canvas.height = Math.max(1, Math.round(ch));
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new LoadError('canvas unavailable');
            // Photos stay JPEG (an order of magnitude smaller than PNG); everything
            // else keeps its alpha channel as PNG.
            const asJpeg = type === 'image/jpeg';
            if (asJpeg) {
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            let dataUrl: string;
            try {
                ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
                dataUrl = asJpeg ? canvas.toDataURL('image/jpeg', JPEG_QUALITY) : canvas.toDataURL('image/png');
            } catch {
                throw new LoadError('could not be converted');
            }
            // Release the pixel buffer now; mobile WebViews are slow to GC canvases.
            canvas.width = 0;
            canvas.height = 0;
            // Report the logical (CSS pixel) size so the image keeps its on-screen size.
            return { dataUrl, width: Math.round(baseW), height: Math.round(baseH) };
        } finally {
            if (!isSvgSrc) URL.revokeObjectURL(url);
        }
    }
}

function decodeSafe(s: string): string {
    try { return decodeURIComponent(s); } catch { return s; }
}

function mimeForExt(ext: string): string {
    switch (ext.toLowerCase()) {
        case 'svg': return 'image/svg+xml';
        case 'png': return 'image/png';
        case 'jpg': case 'jpeg': return 'image/jpeg';
        case 'gif': return 'image/gif';
        case 'webp': return 'image/webp';
        case 'bmp': return 'image/bmp';
        case 'avif': return 'image/avif';
        default: return '';
    }
}
