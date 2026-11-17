from lib3d import *

def build(theme, angle=45, scale=0.5, shade="medium"):
    P = Proj(angle, scale)
    fg = Fig(180, 74, theme)
    # (kind, channels label, w, H, spatial label)
    blocks = [("in", "3", 1.4, 28, "224²"),
              ("conv", "64", 2.0, 28, ""), ("conv", "64", 2.0, 28, ""), ("pool", "", 0.8, 21, ""),
              ("conv", "128", 3.0, 21, "112²"), ("conv", "128", 3.0, 21, "112²"), ("pool", "", 0.8, 15, ""),
              ("conv", "256", 4.0, 15, "56²"), ("conv", "256", 4.0, 15, "56²"), ("conv", "256", 4.0, 15, "56²"), ("pool", "", 0.8, 10, ""),
              ("conv", "512", 5.0, 10, "28²"), ("conv", "512", 5.0, 10, "28²"), ("conv", "512", 5.0, 10, "28²"), ("pool", "", 0.8, 7, ""),
              ("conv", "512", 5.0, 7, "14²"), ("conv", "512", 5.0, 7, "14²"), ("conv", "512", 5.0, 7, "14²"), ("pool", "", 0.8, 5, ""),
              ("fc", "4096", 1.4, 28, ""), ("fc", "4096", 1.4, 28, ""), ("fc", "1000", 1.4, 28, "")]
    tone = dict(in_="gray")
    tones = {"in": "gray", "conv": "blue", "pool": "orange", "fc": "green"}
    yc = 33
    x = 6.0
    geoms = []
    prev_kind = None
    for kind, C, w, H, sp in [(k, c, w * 1.45, H * 1.2, sp) for k, c, w, H, sp in blocks]:
        d = (0.7 * H) if kind != "fc" else 1.4
        if prev_kind is not None:
            if kind == prev_kind and kind != "fc":
                x += 1.0
            elif kind == "fc" and prev_kind == "fc":
                x += 6.2
            else:
                x += 0.5 * prev_dx + 1.2
        prev_dx = fg.geom(0, 0, w, H, d, P)["dx"]
        g = fg.geom(x, yc - H / 2 + 6 if False else yc - H / 2 + (0 if kind != "fc" else 0), w, H, d, P)
        geoms.append((kind, C, sp, g))
        x += w + g["dx"] * (0.0)
        prev_kind = kind
    for kind, C, sp, g in sorted(geoms, key=lambda p: key(p[3])):
        fg.cuboid(g["x"], g["y"], g["w"], g["h"], g["d"], tones[kind], P, shade)
    fg.Wused = geoms[-1][3]["bbox"][2]
    # labels: channels above (first of each run), spatial below (first of run)
    prev = None
    for i, (kind, C, sp, g) in enumerate(geoms):
        run_first = (prev != (kind, C, sp)) or kind == 'fc'
        if C and run_first:
            # centre over the whole run
            j = i
            while kind != 'fc' and j + 1 < len(geoms) and geoms[j + 1][:3] == (kind, C, sp):
                j += 1
            last = geoms[j][3]
            cx = (g["top"][0] + last["top"][0]) / 2
            fg.text(cx, g["top"][1] - 2.6, C, 7)
            if sp:
                fg.text((g["xc"] + last["xc"]) / 2, yc + 16.8 + 3.4, sp, 7)
        prev = (kind, C, sp)
    # legend
    ly = 68
    x0 = 6
    x0 = legend_item_cuboid(fg, x0, ly, "gray", "input", P)
    x0 = legend_item_cuboid(fg, x0, ly, "blue", "conv 3×3 + ReLU", P)
    x0 = legend_item_cuboid(fg, x0, ly, "orange", "max pool 2×2", P)
    x0 = legend_item_cuboid(fg, x0, ly, "green", "fully connected", P)
    fg.text(x0 + 2, ly, "thickness = channels, face = H × W", 7, "start")
    return fg

if __name__ == "__main__":
    for th in ["sumi", "paper"]:
        fg = build(th)
        print(th, fg.Wused)
        fg.save(f"vgg-{th}.svg")
    fg = build("sumi-dark"); fg.save("vgg-sumi-dark.svg")
    fg = build("sumi", 30, 0.5); fg.save("vgg-sumi-30deg.svg")
