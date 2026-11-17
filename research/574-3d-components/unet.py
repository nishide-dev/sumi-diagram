from lib3d import *

def build(theme, angle=45, scale=0.5):
    P = Proj(angle, scale)
    W, Hh = 180, 134
    fg = Fig(W, Hh, theme)
    t = fg.t
    LV = [("572²", 24, 64, "568²"), ("284²", 17, 128, "280²"), ("140²", 12, 256, "136²"),
          ("68²", 8.5, 512, "64²"), ("28²", 6, 1024, "")]
    DEC = ["52²", "100²", "196²", "388²"]
    cw = lambda C: 0.65 * math.log2(C) - 2.6
    YC = [41, 68, 87, 101, 113]
    gap_in, colgap = 0.8, 3.4
    x = 9.0
    items = []  # (zorder-key geom)
    # input
    cub = []

    def add(xx, yc, w, H, tone):
        d = 0.75 * H
        g = fg.geom(xx, yc - H / 2, w, H, d, P)
        cub.append((g, tone))
        return g

    enc = []
    g_in = add(x, YC[0], 0.9, LV[0][1], "gray")
    x += 0.9 + P.off(LV[0][1])[0] + colgap - 1.5
    for i, (sp, H, C, _) in enumerate(LV):
        w = cw(C)
        a = add(x, YC[i], w, H, "blue")
        b = add(x + w + gap_in, YC[i], w, H, "blue")
        enc.append((a, b, sp, C))
        x = b["x"] + w + P.off(H)[0] + colgap
    # decoder
    dec = []
    for i in range(3, -1, -1):
        H, C = LV[i][1], LV[i][2]
        w = cw(C)
        up = add(x, YC[i], w, H, "green")
        sk = add(x + w, YC[i], w, H, "blue")
        c1 = add(x + 2 * w + gap_in, YC[i], w, H, "green")
        c2 = add(c1["x"] + w + gap_in, YC[i], w, H, "green")
        dec.append((i, up, sk, c1, c2))
        x = c2["x"] + w + P.off(H)[0] + colgap
    out = add(x - colgap + 3.6, YC[0], 1.2, 17, "orange")
    for g, tone in sorted(cub, key=lambda p: key(p[0])):
        fg.cuboid(g["x"], g["y"], g["w"], g["h"], g["d"], tone, P)
    fg.W_used = out["bbox"][2]
    # labels + arrows
    lab = 7
    for i, (a, b, sp, C) in enumerate(enc):
        fg.text(b["top"][0] - 1.0, a["top"][1] - 2.4, str(C), lab, "end")
        if i < 4:
            bx = b["bottom"][0]
            nxt = enc[i + 1][0]
            fg.text(bx - 1.4, b["y"] + b["h"] + 3.0, sp, lab, "end")
            fg.line([(bx, b["y"] + b["h"]), (bx, nxt["yc"]), (nxt["left"][0], nxt["yc"])], arrow=True)
        else:
            fg.text(b["x"] + b["w"] / 2 + 3, b["y"] + b["h"] + 3.0, sp, lab, "middle")
    # bottleneck -> dec L4 up
    prev = enc[4][1]
    for k, (i, up, sk, c1, c2) in enumerate(dec):
        src = prev
        sx = src["right"][0]
        fg.line([(sx, src["yc"]), (up["bottom"][0], src["yc"]), (up["bottom"][0], up["y"] + up["h"])], arrow=True)
        C = LV[i][2]
        fg.text(sk["top"][0] - 1.0, up["top"][1] - 2.4, str(C), lab, "end")
        fg.text(c2["x"] + c2["w"] + 1.5, c2["y"] + c2["h"] + 3.0, DEC[k], lab, "middle")
        # skip
        a = enc[i][1]
        ys = a["y"] - a["dy"] - 8.0
        fg.line([(a["top"][0] + 0.0, a["top"][1]), (a["top"][0], ys), (sk["top"][0], ys), (sk["top"][0], sk["top"][1])],
                dash="1.6 1.2", arrow=True)
        prev = c2
    # output conv
    fg.line([(prev["right"][0], prev["yc"]), (out["left"][0], out["yc"])], arrow=True)
    fg.text(out["top"][0], out["top"][1] - 2.4, "2", lab)

    fg.text(g_in["top"][0], g_in["top"][1] - 2.4, "1", lab)
    # legend
    ly = 127
    x0 = 6
    x0 = legend_item_cuboid(fg, x0, ly, "blue", "conv 3×3 ReLU (encoder)", P)
    x0 = legend_item_cuboid(fg, x0, ly, "green", "(decoder)", P)
    x0 = legend_item_cuboid(fg, x0, ly, "orange", "conv 1×1", P)
    x0 = legend_item_arrow(fg, x0, ly, "max pool / up-conv 2×2")
    x0 = legend_item_arrow(fg, x0, ly, "copy and crop", dash="1.6 1.2")
    return fg

if __name__ == "__main__":
    for th in ["sumi", "paper"]:
        fg = build(th)
        print(th, "used width", fg.W_used)
        fg.save(f"unet-{th}.svg")
