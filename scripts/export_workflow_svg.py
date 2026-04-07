from __future__ import annotations

import html
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path

INPUT = Path(r"c:\LOGISTIK\app\WORKFLOW.drawio")
OUT_DIR = Path(r"c:\LOGISTIK\app\workflow-figma")

FONT_FAMILY = "Arial, Helvetica, sans-serif"
DEFAULT_FONT_SIZE = 12


def parse_style(style: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for part in style.split(";"):
        part = part.strip()
        if not part:
            continue
        if "=" in part:
            key, value = part.split("=", 1)
            out[key] = value
        else:
            out[part] = "1"
    return out


def decode_text(value: str | None) -> list[str]:
    if not value:
        return []
    text = html.unescape(value).replace("<br>", "\n").replace("<br/>", "\n").replace("<br />", "\n")
    text = re.sub(r"<[^>]+>", "", text)
    return [line.strip() for line in text.splitlines()]


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def anchor(cell: dict, x_key: str, y_key: str, default_x: float = 0.5, default_y: float = 0.5) -> tuple[float, float]:
    style = cell["style"]
    x = float(style.get(x_key, default_x))
    y = float(style.get(y_key, default_y))
    gx, gy, gw, gh = cell["geom"]
    return gx + (gw * x), gy + (gh * y)


def polyline_midpoint(points: list[tuple[float, float]]) -> tuple[float, float]:
    if len(points) < 2:
        return points[0] if points else (0.0, 0.0)
    lengths: list[float] = []
    total = 0.0
    for i in range(len(points) - 1):
        x1, y1 = points[i]
        x2, y2 = points[i + 1]
        seg = math.hypot(x2 - x1, y2 - y1)
        lengths.append(seg)
        total += seg
    target = total / 2
    acc = 0.0
    for i, seg in enumerate(lengths):
        if acc + seg >= target and seg > 0:
            ratio = (target - acc) / seg
            x1, y1 = points[i]
            x2, y2 = points[i + 1]
            return x1 + ((x2 - x1) * ratio), y1 + ((y2 - y1) * ratio)
        acc += seg
    return points[-1]


def render_text(
    lines: list[str],
    x: float,
    y: float,
    w: float,
    h: float,
    style: dict[str, str],
    *,
    bold: bool = False,
    fill: str | None = None,
) -> str:
    if not lines:
        return ""
    font_size = int(float(style.get("fontSize", DEFAULT_FONT_SIZE)))
    font_weight = "700" if bold or style.get("fontStyle") == "1" else "400"
    font_color = style.get("fontColor", fill or "#111111")
    align = style.get("align", "center")
    vertical = style.get("verticalAlign", "middle")
    padding = 12
    if align == "left":
        text_anchor = "start"
        tx = x + padding
    elif align == "right":
        text_anchor = "end"
        tx = x + w - padding
    else:
        text_anchor = "middle"
        tx = x + (w / 2)

    line_height = font_size * 1.35
    total_h = line_height * max(len(lines), 1)
    if vertical == "top":
        start_y = y + padding + font_size
    elif vertical == "bottom":
        start_y = y + h - total_h + font_size - padding
    else:
        start_y = y + ((h - total_h) / 2) + font_size

    tspans = []
    for idx, line in enumerate(lines):
        dy = "0" if idx == 0 else str(line_height)
        tspans.append(f'<tspan x="{tx:.1f}" dy="{dy}">{esc(line)}</tspan>')
    return (
        f'<text x="{tx:.1f}" y="{start_y:.1f}" fill="{font_color}" '
        f'font-family="{FONT_FAMILY}" font-size="{font_size}" '
        f'font-weight="{font_weight}" text-anchor="{text_anchor}">'
        + "".join(tspans)
        + "</text>"
    )


def render_edge_label(label: str, x: float, y: float) -> str:
    lines = decode_text(label)
    if not lines:
        return ""
    font_size = 11
    longest = max(len(line) for line in lines) if lines else 0
    width = max(44, (longest * font_size * 0.58) + 18)
    height = max(24, (len(lines) * font_size * 1.35) + 10)
    left = x - (width / 2)
    top = y - (height / 2)
    return (
        f'<rect x="{left:.1f}" y="{top:.1f}" width="{width:.1f}" height="{height:.1f}" '
        'rx="6" ry="6" fill="#ffffff" opacity="0.92" stroke="none" />'
        + render_text(lines, left, top, width, height, {"fontSize": str(font_size), "align": "center", "verticalAlign": "middle"})
    )


def render_vertex(cell: dict) -> str:
    style = cell["style"]
    x, y, w, h = cell["geom"]
    value = cell["value"]
    lines = decode_text(value)
    fill = style.get("fillColor", "#ffffff")
    stroke = style.get("strokeColor", "#666666")
    dashed = ' stroke-dasharray="7 5"' if style.get("dashed") == "1" else ""
    stroke_attr = 'none' if stroke == "none" else stroke
    fill_attr = 'none' if fill == "none" else fill
    stroke_width = "1.5"

    if style.get("text") == "1":
        return render_text(lines, x, y, w, h, style, fill=style.get("fontColor", "#111111"))

    if style.get("swimlane") == "1":
        header_h = float(style.get("startSize", 34))
        body = [
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="12" ry="12" fill="{fill_attr}" stroke="{stroke_attr}" stroke-width="{stroke_width}"{dashed} />',
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{header_h:.1f}" rx="12" ry="12" fill="{fill_attr}" stroke="{stroke_attr}" stroke-width="{stroke_width}"{dashed} />',
            render_text(lines, x + 8, y + 2, w - 16, header_h - 4, {"fontSize": "14", "align": "left", "verticalAlign": "middle", "fontStyle": "1"}),
        ]
        return "".join(body)

    if style.get("rhombus") == "1":
        points = [
            (x + (w / 2), y),
            (x + w, y + (h / 2)),
            (x + (w / 2), y + h),
            (x, y + (h / 2)),
        ]
        pts = " ".join(f"{px:.1f},{py:.1f}" for px, py in points)
        return (
            f'<polygon points="{pts}" fill="{fill_attr}" stroke="{stroke_attr}" stroke-width="{stroke_width}"{dashed} />'
            + render_text(lines, x + 18, y + 14, w - 36, h - 28, {"fontSize": style.get("fontSize", str(DEFAULT_FONT_SIZE)), "align": "center", "verticalAlign": "middle", "fontStyle": style.get("fontStyle", "")})
        )

    if style.get("ellipse") == "1":
        cx = x + (w / 2)
        cy = y + (h / 2)
        return (
            f'<ellipse cx="{cx:.1f}" cy="{cy:.1f}" rx="{w/2:.1f}" ry="{h/2:.1f}" fill="{fill_attr}" stroke="{stroke_attr}" stroke-width="{stroke_width}"{dashed} />'
            + render_text(lines, x + 14, y + 10, w - 28, h - 20, {"fontSize": style.get("fontSize", str(DEFAULT_FONT_SIZE)), "align": "center", "verticalAlign": "middle", "fontStyle": style.get("fontStyle", "")}, bold=True)
        )

    rx = 12 if style.get("rounded") == "1" else 0
    shape = [
        f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" ry="{rx}" fill="{fill_attr}" stroke="{stroke_attr}" stroke-width="{stroke_width}"{dashed} />'
    ]
    if lines:
        shape.append(
            render_text(
                lines,
                x + 10,
                y + 8,
                w - 20,
                h - 16,
                {
                    "fontSize": style.get("fontSize", str(DEFAULT_FONT_SIZE)),
                    "align": "center",
                    "verticalAlign": "middle",
                    "fontStyle": style.get("fontStyle", ""),
                    "fontColor": style.get("fontColor", "#111111"),
                },
                bold=style.get("fontStyle") == "1",
            )
        )
    return "".join(shape)


def render_edge(cell: dict, cells: dict[str, dict]) -> str:
    style = cell["style"]
    source = cells.get(cell.get("source", ""))
    target = cells.get(cell.get("target", ""))
    if not source or not target:
        return ""
    src = anchor(source, "exitX", "exitY")
    tgt = anchor(target, "entryX", "entryY")
    points = [src] + cell.get("waypoints", []) + [tgt]
    d = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in points)
    dashed = ' stroke-dasharray="7 5"' if style.get("dashed") == "1" else ""
    label_svg = ""
    if cell["value"]:
        lx, ly = polyline_midpoint(points)
        label_svg = render_edge_label(cell["value"], lx, ly)
    return (
        f'<path d="{d}" fill="none" stroke="#4b5563" stroke-width="2"{dashed} marker-end="url(#arrow)" />'
        + label_svg
    )


def parse_diagram(diagram_el: ET.Element) -> tuple[str, float, float, dict[str, dict], list[dict]]:
    name = diagram_el.attrib["name"]
    model = diagram_el.find("mxGraphModel")
    assert model is not None
    width = float(model.attrib.get("pageWidth", 1800))
    height = float(model.attrib.get("pageHeight", 1400))
    root = model.find("root")
    assert root is not None
    cells: dict[str, dict] = {}
    edges: list[dict] = []
    for cell in root.findall("mxCell"):
        cid = cell.attrib.get("id")
        if cid in {"0", "1"} or not cid:
            continue
        geom = cell.find("mxGeometry")
        if cell.attrib.get("vertex") == "1" and geom is not None:
            cells[cid] = {
                "id": cid,
                "value": cell.attrib.get("value", ""),
                "style": parse_style(cell.attrib.get("style", "")),
                "geom": (
                    float(geom.attrib.get("x", 0)),
                    float(geom.attrib.get("y", 0)),
                    float(geom.attrib.get("width", 0)),
                    float(geom.attrib.get("height", 0)),
                ),
            }
        elif cell.attrib.get("edge") == "1":
            waypoints: list[tuple[float, float]] = []
            points_arr = geom.find("Array[@as='points']") if geom is not None else None
            if points_arr is not None:
                for point in points_arr.findall("mxPoint"):
                    waypoints.append((float(point.attrib.get("x", 0)), float(point.attrib.get("y", 0))))
            edges.append(
                {
                    "id": cid,
                    "value": cell.attrib.get("value", ""),
                    "style": parse_style(cell.attrib.get("style", "")),
                    "source": cell.attrib.get("source", ""),
                    "target": cell.attrib.get("target", ""),
                    "waypoints": waypoints,
                }
            )
    return name, width, height, cells, edges


def export_diagram(name: str, width: float, height: float, cells: dict[str, dict], edges: list[dict]) -> None:
    slug = slugify(name)
    svg_parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{int(width)}" height="{int(height)}" viewBox="0 0 {int(width)} {int(height)}">',
        "<defs>",
        '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">',
        '<path d="M 0 0 L 10 5 L 0 10 z" fill="#4b5563" />',
        "</marker>",
        "</defs>",
        f'<rect x="0" y="0" width="{int(width)}" height="{int(height)}" fill="#ffffff" />',
    ]

    for edge in edges:
        svg_parts.append(render_edge(edge, cells))
    for _, cell in sorted(cells.items(), key=lambda item: (item[1]["geom"][1], item[1]["geom"][0])):
        svg_parts.append(render_vertex(cell))

    svg_parts.append("</svg>")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"{slug}.svg").write_text("\n".join(svg_parts), encoding="utf-8")


def export_index(names: list[str]) -> None:
    lines = ["WORKFLOW FIGMA EXPORT", "", "Import file SVG per halaman ke Figma:", ""]
    for idx, name in enumerate(names, start=1):
        lines.append(f"{idx:02d}. {slugify(name)}.svg  ->  {name}")
    (OUT_DIR / "README.txt").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    tree = ET.parse(INPUT)
    root = tree.getroot()
    exported: list[str] = []
    for diagram_el in root.findall("diagram"):
        name, width, height, cells, edges = parse_diagram(diagram_el)
        export_diagram(name, width, height, cells, edges)
        exported.append(name)
    export_index(exported)
    print(f"Exported {len(exported)} SVG pages to {OUT_DIR}")


if __name__ == "__main__":
    main()
