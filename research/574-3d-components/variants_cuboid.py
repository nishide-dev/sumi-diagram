from lib3d import *
import sys

def panel(fg, ox, oy, proj, shade, outline, label, tone="blue"):
    g = fg.cuboid(ox, oy + 8, 8, 16, 18, tone, proj, shade, outline)
    g2 = fg.cuboid(ox + 22 + g["dx"], oy + 8, 8, 16, 18, "green", proj, shade, outline)
    fg.text(ox + 12, oy + 30 + 4, label, 7, "middle")

def make(theme):
    fg = Fig(180, 150, theme)
    # row 1: angle/scale
    fg.text(4, 5, "angle / scale", 8, "start", bold=True)
    for i, (a, s) in enumerate([(45, .5), (30, .5), (45, .35), (30, .7)]):
        panel(fg, 4 + i * 44, 5, Proj(a, s), "medium", "all", f"{a} deg, x{s}")
    # row 2: shading
    fg.text(4, 46, "face shading (top / side)", 8, "start", bold=True)
    for i, sh in enumerate(["weak", "medium", "strong"]):
        panel(fg, 4 + i * 44, 46, Proj(45, .5), sh, "all", sh)
    # row 3: outline
    fg.text(4, 87, "outline", 8, "start", bold=True)
    for i, ol in enumerate(["all", "sil"]):
        panel(fg, 4 + i * 44, 87, Proj(45, .5), "medium", ol, "all edges full" if ol == "all" else "silhouette + light inner")
    # thin slab small scale (VGG-like) at 100% to judge stroke
    fg.text(100, 87, "thin slabs (w=1.5,3), 1pt frame", 8, "start", bold=True)
    for k, ol in enumerate(["all", "sil"]):
        ox = 100 + k * 40
        fg.cuboid(ox, 100, 1.5, 18, 18, "blue", Proj(45, .5), "medium", ol)
        fg.cuboid(ox + 8, 100, 3, 14, 14, "blue", Proj(45, .5), "medium", ol)
        fg.cuboid(ox + 18, 100, 3, 10, 10, "orange", Proj(45, .5), "medium", ol)
        fg.text(ox + 8, 128, ["all edges", "silhouette+light"][k], 7)
    fg.save(f"variants-cuboid-{theme}.svg")

for th in ["sumi", "paper", "sumi-dark"]:
    make(th)
