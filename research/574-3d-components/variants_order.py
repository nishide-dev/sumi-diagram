from lib3d import *
# painting order and spacing when cuboids are close
def make(theme):
    P = Proj(45, .5)
    fg = Fig(180, 100, theme)
    def row(oy, gapf, label, order):
        x = 6
        gs = []
        for i, (w, H) in enumerate([(3, 20), (3, 20), (3, 20), (1, 14)]):
            g = fg.geom(x, oy + 20 - H / 2 + 6, w, H, H, P)
            gs.append((g, "blue" if i < 3 else "orange"))
            x += w + (gapf(g) if callable(gapf) else gapf)
        seq = sorted(gs, key=lambda p: key(p[0])) if order == "lr" else list(reversed(sorted(gs, key=lambda p: key(p[0]))))
        for g, tn in seq:
            fg.cuboid(g["x"], g["y"], g["w"], g["h"], g["d"], tn, P)
        fg.text(100, oy + 18, label, 7, "start")
    fg.text(4, 4, "painting order and spacing", 8, "start", bold=True)
    row(6, lambda g: 1.0, "A  gap 1mm (< depth offset), left to right (chosen order)", "lr")
    row(36, lambda g: g["dx"] * 0.5, "B  gap = 0.5 x dx, left to right", "lr")
    row(66, lambda g: g["dx"] + 1.2, "C  gap = dx + 1.2 (all side faces visible)", "lr")
    # wrong order
    fg.save(f"variants-order-{theme}.svg")
    # separate: wrong order sample
    fg2 = Fig(60, 40, theme); fg = fg2
    x = 6; gs = []
    for i in range(3):
        gs.append((fg.geom(x, 12, 3, 20, 20, P), "blue")); x += 4
    for g, tn in reversed(gs):
        fg.cuboid(g["x"], g["y"], g["w"], g["h"], g["d"], tn, P)
    fg.text(30, 36, "wrong: right to left", 7)
make("sumi")
