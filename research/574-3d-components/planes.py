from lib3d import *

NODES = {"A": (18, 14), "B": (50, 14), "C": (82, 14), "D": (18, 42), "E": (50, 42), "F": (82, 42)}
EDGES_A = [("A", "B"), ("B", "C"), ("A", "D"), ("B", "E"), ("E", "F")]
EDGES_B = [("A", "E"), ("B", "D"), ("C", "F"), ("D", "E"), ("B", "C")]
U, V = 100, 56

def build_into(fg, ox, oy, angle=45, scale=0.5, shape="circle", occl="ghost", slab=False, titles=True):
    t = fg.t
    P = Proj(angle, scale)
    k, m = P.off(1)  # per unit of plane depth v
    r = 4.3
    def pt(yfront, u, v):
        return (ox + u + v * k, yfront - v * m)
    yA, yB = oy + 38, oy + 38 + 40
    gfill, gline = t["grp_fill"], t["grp_line"]
    fa = mix(t["tones"]["gray"][0], t["canvas"], 0.5) if False else t["grp_fill"]
    corr_col = t["ink"]
    ghost = mix(t["ink"], t["canvas"], 0.6)

    def plane(yf, edges, tone, name):
        quad = [pt(yf, 0, 0), pt(yf, U, 0), pt(yf, U, V), pt(yf, 0, V)]
        if slab:
            th = 1.6
            fg.poly([quad[0], quad[1], (quad[1][0], quad[1][1] + th), (quad[0][0], quad[0][1] + th)], mix(gfill, t["ink"], 0.12), gline, t["grp_w"])
            fg.poly([quad[1], quad[2], (quad[2][0], quad[2][1] + th), (quad[1][0], quad[1][1] + th)], mix(gfill, t["ink"], 0.2), gline, t["grp_w"])
        fg.poly(quad, gfill, gline if t["name"] != "x" else gline, t["frame_w"] if t["dark"] or True else 1)
        if titles:
            fg.text(ox, yf + (4.4 if not slab else 6), name, 9, "start", bold=True)
    def nodes_edges(yf, edges, tone):
        for a, b in edges:
            (x1, y1), (x2, y2) = pt(yf, *NODES[a]), pt(yf, *NODES[b])
            L = math.hypot(x2 - x1, y2 - y1)
            ux, uy = (x2 - x1) / L, (y2 - y1) / L
            def clip(px, py, sx, sy):
                if shape == "circle":
                    return px + sx * ux * r, py + sy * uy * r
                # ellipse radius along direction
                ry = r * 0.5
                rr = 1 / math.sqrt((ux / r) ** 2 + (uy / ry) ** 2)
                return px + sx * ux * rr, py + sy * uy * rr
            p1 = clip(x1, y1, 1, 1); p2 = clip(x2, y2, -1, -1)
            fg.line([p1, p2], sw=t["edge_w"] * 1.5)
    def draw_nodes(yf, tone):
        order = sorted(NODES.items(), key=lambda kv: -kv[1][1])  # back (large v) first
        fill, line = t["tones"][tone]
        for name, (u, v) in order:
            x, y = pt(yf, u, v)
            if shape == "circle":
                fg.add(f'<circle cx="{f(x)}" cy="{f(y)}" r="{f(r)}" fill="{fill}" stroke="{line}" stroke-width="{f(t["frame_w"] * PT)}"/>')
                fg.text(x, y + 0.1, name, 8, color=line)
            else:
                fg.add(f'<ellipse cx="{f(x)}" cy="{f(y)}" rx="{f(r)}" ry="{f(r * 0.5)}" fill="{fill}" stroke="{line}" stroke-width="{f(t["frame_w"] * PT)}"/>')
                fg.text(x, y - r * 0.5 - 2.6, name, 8, color=line)
    def node_edge_pts(yf, name, up):
        x, y = pt(yf, *NODES[name])
        rr = r if shape == "circle" else r * 0.5
        return (x, y - rr) if up else (x, y + rr)

    # lower plane first
    plane(yB, EDGES_B, "green", "(b) Graph B")
    nodes_edges(yB, EDGES_B, "green")
    def corr(clip_to=None):
        for n in NODES:
            a = node_edge_pts(yB, n, True)   # top of lower node
            b = node_edge_pts(yA, n, False)  # bottom of upper node
            yield n, a, b
    if occl == "over":
        pass
    if occl in ("behind", "ghost"):
        for n, a, b in corr():
            fg.line([a, b], sw=t["edge_w"], dash="0.1 1.3" if True else None, color=corr_col)
    plane(yA, EDGES_A, "blue", "(a) Graph A")
    nodes_edges(yA, EDGES_A, "blue")
    if occl == "ghost":
        # re-draw faintly over the upper plane: from the plane's front edge up to the upper node
        for n, a, b in corr():
            xf = a[0]
            # front edge y of upper plane at this x: yA
            fg.line([(xf, yA), b], sw=t["edge_w"], dash="0.1 1.3", color=ghost)
    if occl == "over":
        for n, a, b in corr():
            fg.line([a, b], sw=t["edge_w"], dash="0.1 1.3", color=corr_col)
    draw_nodes(yB, "green")
    draw_nodes(yA, "blue")
    return yA, yB

def legend(fg, x, y):
    t = fg.t
    fg.line([(x, y), (x + 8, y)], sw=t["edge_w"] * 1.5)
    fg.text(x + 10, y, "edge in a graph", 7, "start")
    fg.line([(x, y + 6), (x + 8, y + 6)], sw=t["edge_w"], dash="0.1 1.3")
    fg.text(x + 10, y + 6, "same node, other graph", 7, "start")

def build(theme, **kw):
    fg = Fig(180, 92, theme)
    build_into(fg, 14, 4, **kw)
    legend(fg, 134 if False else 128, 14)
    return fg

if __name__ == "__main__":
    for th in ["sumi", "paper"]:
        build(th, occl="ghost").save(f"planes-{th}.svg")
    th = "sumi"
    sheet = Fig(180, 4 * 92, th)
    opts = [dict(occl="over"), dict(occl="behind"), dict(occl="ghost"), dict(occl="ghost", shape="ellipse")]
    names = ["V1 dotted lines drawn over the upper plane", "V2 lines hidden behind the upper plane", "V3 ghost: hidden, faint inside the plane (chosen)", "V3 with flattened ellipse nodes (label above)"]
    for i, (o, n) in enumerate(zip(opts, names)):
        build_into(sheet, 14, i * 92 + 8, **o)
        sheet.text(4, i * 92 + 5, n, 7, "start", bold=True)
    sheet.save("variants-planes-sumi.svg")
    s2 = Fig(180, 2 * 92, th)
    build_into(s2, 14, 8, angle=45, occl="ghost"); s2.text(4, 5, "45 deg, 0.5, flat plane", 7, "start", bold=True)
    build_into(s2, 14, 92 + 8, angle=30, occl="ghost", slab=True); s2.text(4, 97, "30 deg, 0.5, plane with 1.6 mm slab edge", 7, "start", bold=True)
    s2.save("variants-planes-angle-sumi.svg")
    build("sumi-dark", occl="ghost").save("planes-sumi-dark.svg")
