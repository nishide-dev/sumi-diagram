"""Hand-written mockup helpers for oblique-projection 3D components (#574).
Units: 1 SVG user unit = 1 mm. Theme colours were copied from Sumi probe renders
(`sumi render` of tinted boxes in each theme); see README.md."""
import math
from html import escape as _esc

PT = 0.352778  # 1pt in mm
FONT = "BIZ UDPGothic, Hiragino Sans, Helvetica Neue, Arial, sans-serif"


def _rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def mix(a, b, t):
    """t=0 -> a, t=1 -> b."""
    ra, rb = _rgb(a), _rgb(b)
    return "#%02x%02x%02x" % tuple(round(x + (y - x) * t) for x, y in zip(ra, rb))


THEMES = {
    "sumi": dict(
        dark=False, canvas="#f8f8ee", ink="#30364f", edge="#30364f", edge_w=1.0, frame_w=1.0,
        grp_fill="#efeddd", grp_line="#4e566b", grp_w=1.0,
        tones=dict(gray=("#e1dece", "#4e566b"), blue=("#d9e4e6", "#3d5d77"), green=("#dce7d3", "#426344"),
                   orange=("#efdfce", "#814b2d"), red=("#efd8d0", "#813f40"), purple=("#e2dce9", "#5f4f78"),
                   yellow=("#eee7c9", "#997600")),
        lit="#ffffff", shade_to=None, head=(4, 2)),
    "paper": dict(
        dark=False, canvas="#ffffff", ink="#000000", edge="#000000", edge_w=0.5, frame_w=1.0,
        grp_fill="#ffffff", grp_line="#b4b8c0", grp_w=0.5,
        tones=dict(gray=("#dee1e8", "#60646a"), blue=("#d1e7ff", "#31608e"), green=("#c6edcd", "#3c704a"),
                   orange=("#fcdbb7", "#b23907"), red=("#f9c7bb", "#8b3c34"), purple=("#d8cdf8", "#524177"),
                   yellow=("#f8efbf", "#b28600")),
        lit="#ffffff", shade_to=None, head=(4, 2)),
    "sumi-dark": dict(
        dark=True, canvas="#30364f", ink="#f0f0db", edge="#f0f0db", edge_w=1.0, frame_w=1.0,
        grp_fill="#383f58", grp_line="#acbac4", grp_w=1.0,
        tones=dict(gray=("#454d64", "#c4cbd0"), blue=("#3e5068", "#b9d0e5"), green=("#3e574b", "#b9d5b8"),
                   orange=("#654b40", "#f1c6a7"), red=("#65454d", "#f0bdb5"), purple=("#514862", "#d1c2e5"),
                   yellow=("#5a543b", "#ecd994")),
        lit=None, shade_to="#1c2033", head=(4, 2)),
}
# face shading: fraction of the way from the tone fill toward a target.
#   light themes: top -> white, side -> tone line (darker, same hue)
#   dark theme:   top -> tone line (lighter, same hue), side -> #1c2033 (darker)
SHADES = {  # name: {theme-kind: (top, side)}
    "weak":   {"light": (0.35, 0.10), "dark": (0.12, 0.20)},
    "medium": {"light": (0.55, 0.20), "dark": (0.22, 0.35)},
    "strong": {"light": (0.80, 0.32), "dark": (0.34, 0.50)},
}


class Proj:
    def __init__(self, angle=45, scale=0.5):
        self.angle, self.scale = angle, scale

    def off(self, d):
        a = math.radians(self.angle)
        return self.scale * d * math.cos(a), self.scale * d * math.sin(a)  # (dx right, dy up)


def f(v):
    return ("%.3f" % v).rstrip("0").rstrip(".")


class Fig:
    def __init__(self, w, h, theme, title=None):
        self.w, self.h, self.t = w, h, THEMES[theme]
        self.name = theme
        self.t['name'] = theme
        self.parts = []

    # -- primitives
    def add(self, s):
        self.parts.append(s)

    def poly(self, pts, fill="none", stroke=None, sw=None, dash=None, join="round", extra=""):
        p = " ".join(f"{f(x)},{f(y)}" for x, y in pts)
        st = f' stroke="{stroke}" stroke-width="{f((sw if sw is not None else 1) * PT)}" stroke-linejoin="{join}"' if stroke else ' stroke="none"'
        if dash and stroke:
            st += f' stroke-dasharray="{dash}"'
        self.add(f'<polygon points="{p}" fill="{fill}"{st}{extra}/>')

    def path(self, d, stroke, sw, dash=None, cap="round", fill="none"):
        da = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<path d="{d}" fill="{fill}" stroke="{stroke}" stroke-width="{f(sw * PT)}" stroke-linecap="{cap}" stroke-linejoin="round"{da}/>')

    def line(self, pts, color=None, sw=None, dash=None, arrow=False, arrow_start=False, cap="round"):
        t = self.t
        color = color or t["edge"]
        sw = sw if sw is not None else t["edge_w"]
        pts = list(pts)
        hl, hw = (t["head"][0] * PT, t["head"][1] * PT)
        heads = []
        def trim(p_from, p_to):  # shorten p_to side by head length
            dx, dy = p_to[0] - p_from[0], p_to[1] - p_from[1]
            L = math.hypot(dx, dy) or 1
            ux, uy = dx / L, dy / L
            heads.append((p_to, ux, uy))
            return (p_to[0] - ux * hl * 0.9, p_to[1] - uy * hl * 0.9)
        body = pts[:]
        if arrow:
            body[-1] = trim(pts[-2], pts[-1])
        if arrow_start:
            body[0] = trim(pts[1], pts[0])
        d = "M" + " L".join(f"{f(x)} {f(y)}" for x, y in body)
        self.path(d, color, sw, dash, cap)
        for (tip, ux, uy) in heads:
            bx, by = tip[0] - ux * hl, tip[1] - uy * hl
            nx, ny = -uy, ux
            self.add(f'<polygon points="{f(tip[0])},{f(tip[1])} {f(bx + nx * hw)},{f(by + ny * hw)} {f(bx - nx * hw)},{f(by - ny * hw)}" fill="{color}"/>')

    def text(self, x, y, s, size=8, anchor="middle", color=None, bold=False, base="central", italic=False):
        color = color or self.t["ink"]
        w = ' font-weight="bold"' if bold else ""
        it = ' font-style="italic"' if italic else ""
        self.add(f'<text x="{f(x)}" y="{f(y)}" font-size="{f(size * PT)}" text-anchor="{anchor}" dominant-baseline="{base}" fill="{color}" font-family="{FONT}"{w}{it}>{_esc(s, quote=False)}</text>')

    def svg(self):
        t = self.t
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(self.w)} {f(self.h)}" '
                f'width="{f(self.w)}mm" height="{f(self.h)}mm">\n<rect width="100%" height="100%" fill="{t["canvas"]}"/>\n')
        return head + "\n".join(self.parts) + "\n</svg>\n"

    def save(self, path):
        open(path, "w").write(self.svg())

    # -- 3D
    def shade_colors(self, tone, shade="medium", fill_override=None):
        t = self.t
        fill, line = t["tones"][tone] if tone in t["tones"] else (tone, tone)
        if fill_override:
            fill = fill_override
        kind = "dark" if t["dark"] else "light"
        kt, ks = SHADES[shade][kind]
        if t["dark"]:
            top, side = mix(fill, line, kt), mix(fill, t["shade_to"], ks)
        else:
            top, side = mix(fill, t["lit"], kt), mix(fill, line, ks)
        return fill, top, side, line

    def cuboid(self, x, y, w, h, d, tone="blue", proj=Proj(), shade="medium", outline="sil",
               grid=None, fill_override=None, sw=None):
        """x,y = top-left of the FRONT face. Returns geometry/ports."""
        t = self.t
        sw = sw if sw is not None else t["frame_w"]
        dx, dy = proj.off(d)
        fill, top_c, side_c, line = self.shade_colors(tone, shade, fill_override)
        front = [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]
        top = [(x, y), (x + dx, y - dy), (x + w + dx, y - dy), (x + w, y)]
        side = [(x + w, y), (x + w + dx, y - dy), (x + w + dx, y + h - dy), (x + w, y + h)]
        inner = mix(line, fill, 0.55)
        if outline == "all":
            for pts, c in ((top, top_c), (side, side_c), (front, fill)):
                self.poly(pts, c, line, sw)
        else:  # silhouette full, 3 visible inner edges lighter and thinner
            for pts, c in ((top, top_c), (side, side_c), (front, fill)):
                self.poly(pts, c, None)
            if grid:
                self._grid(x, y, w, h, d, proj, grid, line)
            self.path(f"M{f(x)} {f(y)} L{f(x+w)} {f(y)} L{f(x+w)} {f(y)}", inner, sw * 0.5)
            self.path(f"M{f(x)} {f(y)} L{f(x+w)} {f(y)} L{f(x+w+dx)} {f(y-dy)}", inner, sw * 0.5)
            self.path(f"M{f(x+w)} {f(y)} L{f(x+w)} {f(y+h)}", inner, sw * 0.5)
            sil = [(x, y + h), (x, y), (x + dx, y - dy), (x + w + dx, y - dy), (x + w + dx, y + h - dy), (x + w, y + h)]
            self.poly(sil, "none", line, sw)
        if outline == "all" and grid:
            self._grid(x, y, w, h, d, proj, grid, line)
        return self.geom(x, y, w, h, d, proj)

    def geom(self, x, y, w, h, d, proj):
        dx, dy = proj.off(d)
        yc = y + h / 2
        if h / 2 >= dy:
            rx = x + w + dx
        else:
            rx = x + w + (y + h - yc) * dx / dy if dy else x + w
        return dict(x=x, y=y, w=w, h=h, d=d, dx=dx, dy=dy, yc=yc, xc=x + w / 2,
                    left=(x, yc), right=(rx, yc), bottom=(x + w / 2, y + h), top=(x + w / 2 + dx, y - dy),
                    right_front=(x + w, yc), bbox=(x, y - dy, x + w + dx, y + h))

    def _grid(self, x, y, w, h, d, proj, grid, line):
        nx, ny, nz = grid
        dx, dy = proj.off(d)
        gc = mix(line, self.t["canvas"], 0.45)
        sw = self.t["edge_w"] * 0.5
        s = []
        for i in range(1, nx):
            xi = x + w * i / nx
            s.append(f"M{f(xi)} {f(y)} L{f(xi)} {f(y+h)}")
            s.append(f"M{f(xi)} {f(y)} L{f(xi+dx)} {f(y-dy)}")
        for j in range(1, ny):
            yj = y + h * j / ny
            s.append(f"M{f(x)} {f(yj)} L{f(x+w)} {f(yj)}")
            s.append(f"M{f(x+w)} {f(yj)} L{f(x+w+dx)} {f(yj-dy)}")
        for k in range(1, nz):
            a = k / nz
            s.append(f"M{f(x+dx*a)} {f(y-dy*a)} L{f(x+w+dx*a)} {f(y-dy*a)}")
            s.append(f"M{f(x+w+dx*a)} {f(y-dy*a)} L{f(x+w+dx*a)} {f(y+h-dy*a)}")
        self.path(" ".join(s), gc, sw)


def key(g):  # paint order: left->right, bottom->top
    return g["x"] - g["y"]


def legend_item_cuboid(fg, x, y, tone, label, proj, size=(2.4, 4, 4), anchor_gap=2.6):
    w, h, d = size
    fg.cuboid(x, y - h / 2, w, h, d, tone, proj)
    dx, dy = proj.off(d)
    fg.text(x + w + dx + anchor_gap, y, label, 7, "start")
    return x + w + dx + anchor_gap + len(label) * 1.45 + 5


def legend_item_arrow(fg, x, y, label, dash=None):
    fg.line([(x, y), (x + 7, y)], dash=dash, arrow=True)
    fg.text(x + 7 + 2.6, y, label, 7, "start")
    return x + 7 + 2.6 + len(label) * 1.45 + 5
