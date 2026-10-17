import sys
import numpy as np
from PIL import Image


def cut(inp, out, target=512, soft=(24.0, 62.0)):
    src = Image.open(inp).convert('RGB')
    a = np.asarray(src).astype(np.float32)
    h, w, _ = a.shape
    corners = np.concatenate([
        a[:6, :6].reshape(-1, 3), a[:6, -6:].reshape(-1, 3),
        a[-6:, :6].reshape(-1, 3), a[-6:, -6:].reshape(-1, 3)])
    bg = corners.mean(axis=0)
    d = np.sqrt(((a - bg) ** 2).sum(axis=2))
    alpha = np.clip((d - soft[0]) / (soft[1] - soft[0]), 0, 1)
    af = alpha[..., None]
    rgb = np.clip((a - (1 - af) * bg) / np.maximum(af, 1e-3), 0, 255)
    im = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), 'RGBA')
    ys, xs = np.where(alpha > 0.35)
    if len(xs) == 0:
        im.save(out)
        return im.size
    pad = 4
    x0, y0 = max(0, int(xs.min()) - pad), max(0, int(ys.min()) - pad)
    x1, y1 = min(w - 1, int(xs.max()) + pad), min(h - 1, int(ys.max()) + pad)
    im = im.crop((x0, y0, x1 + 1, y1 + 1))
    ratio = target / im.width
    im = im.resize((target, max(1, round(im.height * ratio))), Image.LANCZOS)
    im.save(out, optimize=True)
    return im.size


if __name__ == '__main__':
    inp, out = sys.argv[1], sys.argv[2]
    target = int(sys.argv[3]) if len(sys.argv) > 3 else 512
    size = cut(inp, out, target)
    print('cut', out, size)
