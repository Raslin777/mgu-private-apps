'use strict';
// Original vector-style artwork rasterized locally; no external image assets.
// Each icon is a directional warning triangle on a fully transparent square.
function segment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    return Math.sqrt(Math.pow(px - ax - t * dx, 2) + Math.pow(py - ay - t * dy, 2));
}
function icon(side, active, size) {
    const n = size || 64, out = Buffer.alloc(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let cover = 0;
        for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
            let px = (x + (sx + 0.5) / 2) / n, py = (y + (sy + 0.5) / 2) / n;
            if (side === 'right') px = 1 - px;
            const rim = Math.min(segment(px, py, 0.12, 0.5, 0.82, 0.12),
                segment(px, py, 0.82, 0.12, 0.82, 0.88), segment(px, py, 0.82, 0.88, 0.12, 0.5));
            const mark = segment(px, py, 0.61, 0.35, 0.61, 0.56) < 0.035 ||
                Math.pow(px - 0.61, 2) + Math.pow(py - 0.67, 2) < 0.0013;
            const inside = px > 0.12 && px < 0.82 && Math.abs(py - 0.5) < (px - 0.12) * 0.38 / 0.7;
            cover += active ? (rim < 0.034 || (inside && !mark) ? 1 : 0) : (rim < 0.034 || mark ? 1 : 0);
        }
        const i = (y * n + x) * 4;
        if (cover) { out[i] = 255; out[i + 1] = 182; out[i + 2] = 42; out[i + 3] = Math.round(255 * cover / 4); }
    }
    return out;
}
function layout(targets, settings) {
    const match = /(?:^|[,;\s])hud:(\d+)x(\d+)(?:$|[,;\s])/.exec(String(targets || ''));
    if (!match) return null;
    const w = Number(match[1]), h = Number(match[2]);
    if (w < 200 || w > 1920 || h < 120 || h > 1080) return null;
    const ratio = settings.size === 'large' ? 0.07 : settings.size === 'medium' ? 0.06 : 0.05;
    const size = Math.round(Math.max(24, Math.min(64, w * ratio)));
    const inset = Math.round(w * (w >= 600 ? 0.18 : 0.06));
    const height = ['40', '50', '60'].indexOf(String(settings.height)) >= 0 ? Number(settings.height) : 50;
    const y = Math.round(h * height / 100 - size / 2);
    const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
    // ID7's 800x480 scene extends beyond what the glass shows. These bounds
    // follow the existing conservative viewport, and keep each icon on its side.
    const wide = w >= 600, marginX = Math.round(w * (wide ? 0.15 : 0.04));
    const marginY = Math.round(h * (wide ? 0.25 : 0.04));
    const offsets = {}, points = {};
    for (const side of ['left', 'right']) {
        const raw = settings.positions && settings.positions[side] || {};
        const dx = typeof raw.x === 'number' && Number.isFinite(raw.x) ? clamp(raw.x, -100, 100) : 0;
        const dy = typeof raw.y === 'number' && Number.isFinite(raw.y) ? clamp(raw.y, -100, 100) : 0;
        const baseX = side === 'left' ? inset : w - inset - size;
        const lowX = side === 'left' ? marginX : Math.ceil(w / 2) + 4;
        const highX = side === 'left' ? Math.floor(w / 2) - size - 4 : w - marginX - size;
        const px = Math.round(clamp(baseX + dx * w / 100, lowX, highX));
        const py = Math.round(clamp(y + dy * h / 100, marginY, h - marginY - size));
        points[side] = { x: px, y: py };
        offsets[side] = { x: (px - baseX) / w * 100, y: (py - y) / h * 100 };
    }
    return { width: w, height: h, size: size, y: y, left: points.left.x, right: points.right.x,
        leftY: points.left.y, rightY: points.right.y, offsets: offsets,
        opacity: settings.opacity === '45' ? 0.45 : settings.opacity === '85' ? 0.85 : 0.65 };
}
module.exports = { icon, layout };
