from pathlib import Path
import xml.etree.ElementTree as ET

OUT = Path(r"c:\LOGISTIK\app\COMPANY_PROFILE_WEB_GROWTH.drawio")

EDGE = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;jettySize=auto;orthogonalLoop=1;fontSize=11;labelBackgroundColor=#ffffff;align=center;verticalAlign=middle;"
TEXT = "text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;"
TITLE = TEXT + "fontSize=24;fontStyle=1;"
NOTE = TEXT + "fontSize=11;fontColor=#666666;"
TERM = "ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;"
DEC = "rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontStyle=1;"
BLUE = "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;"
GREEN = "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;"
YELLOW = "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;"
ORANGE = "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;"
PURPLE = "rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;"
GREY = "rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;"
PANEL = "rounded=1;whiteSpace=wrap;html=1;fillColor=#fafafa;strokeColor=#b3b3b3;dashed=1;"
REF = "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff7e6;strokeColor=#999999;dashed=1;"

GEOMS = {}


def mxfile():
    return ET.Element("mxfile", host="app.diagrams.net", modified="2026-04-06T09:00:00.000Z", agent="Codex", version="24.7.17", type="device")


def diagram(root, diag_id, name, page_w=1800, page_h=1300):
    diag = ET.SubElement(root, "diagram", id=diag_id, name=name)
    model = ET.SubElement(
        diag,
        "mxGraphModel",
        dx="1800",
        dy="1000",
        grid="1",
        gridSize="10",
        guides="1",
        tooltips="1",
        connect="1",
        arrows="1",
        fold="1",
        page="1",
        pageScale="1",
        pageWidth=str(page_w),
        pageHeight=str(page_h),
        math="0",
        shadow="0",
    )
    inner = ET.SubElement(model, "root")
    ET.SubElement(inner, "mxCell", id="0")
    ET.SubElement(inner, "mxCell", id="1", parent="0")
    return inner


def v(root, cid, value, style, x, y, w, h, parent="1"):
    cell = ET.SubElement(root, "mxCell", id=cid, value=value, style=style, vertex="1", parent=parent)
    ET.SubElement(cell, "mxGeometry", x=str(x), y=str(y), width=str(w), height=str(h), **{"as": "geometry"})
    GEOMS.setdefault(id(root), {})[cid] = (x, y, w, h)


def _anchor_style(root, source, target):
    geoms = GEOMS.get(id(root), {})
    if source not in geoms or target not in geoms:
        return ""
    sx, sy, sw, sh = geoms[source]
    tx, ty, tw, th = geoms[target]
    scx = sx + (sw / 2)
    scy = sy + (sh / 2)
    tcx = tx + (tw / 2)
    tcy = ty + (th / 2)
    dx = tcx - scx
    dy = tcy - scy
    if abs(dx) >= abs(dy):
        if dx >= 0:
            return "exitX=1;exitY=0.5;entryX=0;entryY=0.5;"
        return "exitX=0;exitY=0.5;entryX=1;entryY=0.5;"
    if dy >= 0:
        return "exitX=0.5;exitY=1;entryX=0.5;entryY=0;"
    return "exitX=0.5;exitY=0;entryX=0.5;entryY=1;"


def e(root, cid, source, target, label="", style_extra="", waypoints=None):
    attrs = {
        "id": cid,
        "style": EDGE + _anchor_style(root, source, target) + style_extra,
        "edge": "1",
        "parent": "1",
        "source": source,
        "target": target,
    }
    if label:
        attrs["value"] = label
    cell = ET.SubElement(root, "mxCell", **attrs)
    geom = ET.SubElement(cell, "mxGeometry", relative="1", **{"as": "geometry"})
    if waypoints:
        arr = ET.SubElement(geom, "Array", **{"as": "points"})
        for x, y in waypoints:
            ET.SubElement(arr, "mxPoint", x=str(x), y=str(y))


def add_page_0(root):
    r = diagram(root, "visitor-journey", "00 Visitor Journey", 1900, 1450)
    v(r, "t0", "FLOWCHART VISITOR JOURNEY WEBSITE COMPANY PROFILE", TITLE, 40, 20, 980, 30)
    v(r, "n0", "Flow ini dibuat sederhana sesuai scope Web Growth: visitor masuk, landing ke halaman utama, membaca trust content, lalu bergerak ke CTA.", NOTE, 40, 55, 1220, 20)
    nodes = [
        ("s", "Visitor masuk ke website", TERM, 830, 120, 220, 60),
        ("d1", "Landing ke halaman apa?", DEC, 845, 230, 190, 130),
        ("p1", "Home", BLUE, 150, 460, 190, 80),
        ("p2", "Tentang Kami", BLUE, 420, 460, 190, 80),
        ("p3", "Layanan", BLUE, 690, 460, 190, 80),
        ("p4", "Portofolio / Galeri", BLUE, 960, 460, 230, 80),
        ("p5", "Kontak", BLUE, 1290, 460, 190, 80),
        ("p6", "Visitor membaca konten utama&#xa;brand, profil, layanan, bukti kerja, kontak", GREEN, 770, 660, 340, 90),
        ("d2", "Visitor tertarik lanjut?", DEC, 845, 820, 190, 130),
        ("p7", "Keluar dari website", GREY, 500, 860, 220, 80),
        ("p8", "Klik CTA", ORANGE, 900, 1020, 160, 80),
        ("r1", "CTA utama: WhatsApp, Form Kontak, atau tombol Konsultasi", REF, 1190, 1010, 320, 90),
        ("end", "Lead masuk ke flow berikutnya", TERM, 870, 1180, 180, 60),
    ]
    for n in nodes:
        v(r, *n)
    for x in [
        ("e1", "s", "d1", ""),
        ("e2", "d1", "p1", "Home"),
        ("e3", "d1", "p2", "Tentang"),
        ("e4", "d1", "p3", "Layanan"),
        ("e5", "d1", "p4", "Portofolio"),
        ("e6", "d1", "p5", "Kontak"),
        ("e7", "p1", "p6", ""),
        ("e8", "p2", "p6", ""),
        ("e9", "p3", "p6", ""),
        ("e10", "p4", "p6", ""),
        ("e11", "p5", "p6", ""),
        ("e12", "p6", "d2", ""),
        ("e13", "d2", "p7", "Tidak"),
        ("e14", "d2", "p8", "Ya"),
        ("e15", "p8", "r1", ""),
        ("e16", "r1", "end", "Lead terkirim"),
    ]:
        e(r, *x)


def add_page_1(root):
    r = diagram(root, "lead-cta-flow", "01 Lead and CTA Flow", 1800, 1450)
    v(r, "t1", "FLOWCHART CTA DAN LEAD MASUK", TITLE, 40, 20, 620, 30)
    v(r, "n1", "Flow ini fokus ke jalur yang paling penting untuk website company profile: visitor klik CTA, lead diterima, lalu admin follow up.", NOTE, 40, 55, 1120, 20)
    nodes = [
        ("s", "Masuk dari CTA website", TERM, 780, 120, 220, 60),
        ("d1", "Lead masuk lewat apa?", DEC, 800, 240, 180, 130),
        ("p1", "WhatsApp terbuka", GREEN, 470, 470, 190, 80),
        ("p2", "Form kontak terkirim ke email", GREEN, 1020, 470, 250, 80),
        ("p3", "Admin menerima lead", BLUE, 780, 650, 220, 80),
        ("d2", "Lead valid untuk difollow up?", DEC, 800, 800, 180, 130),
        ("p4", "Arsip / abaikan lead", GREY, 470, 840, 210, 80),
        ("p5", "Follow up via chat / telepon / email", ORANGE, 760, 1000, 260, 80),
        ("d3", "Lanjut ke meeting atau penawaran?", DEC, 800, 1130, 180, 130),
        ("p6", "Tutup lead tanpa deal", GREY, 470, 1170, 220, 80),
        ("p7", "Jadwalkan meeting / kirim penawaran", PURPLE, 1060, 1170, 280, 80),
        ("end", "Lead selesai diproses", TERM, 810, 1320, 170, 60),
    ]
    for n in nodes:
        v(r, *n)
    for x in [
        ("e1", "s", "d1", ""),
        ("e2", "d1", "p1", "WhatsApp"),
        ("e3", "d1", "p2", "Form"),
        ("e4", "p1", "p3", ""),
        ("e5", "p2", "p3", ""),
        ("e6", "p3", "d2", ""),
        ("e7", "d2", "p4", "Tidak"),
        ("e8", "d2", "p5", "Ya"),
        ("e9", "p5", "d3", ""),
        ("e10", "d3", "p6", "Tidak"),
        ("e11", "d3", "p7", "Ya"),
        ("e12", "p4", "end", ""),
        ("e13", "p6", "end", ""),
        ("e14", "p7", "end", ""),
    ]:
        e(r, *x)


def add_page_2(root):
    r = diagram(root, "admin-content-update", "02 Admin Content Update", 1900, 1550)
    v(r, "t2", "FLOWCHART ADMIN CONTENT UPDATE", TITLE, 40, 20, 560, 30)
    v(r, "n2", "Flow admin ini dibatasi ke kebutuhan Web Growth: update konten company profile, layanan, portofolio, galeri, dan kontak.", NOTE, 40, 55, 1100, 20)
    nodes = [
        ("s", "Admin login ke dashboard konten", TERM, 800, 120, 260, 60),
        ("d1", "Konten apa yang diupdate?", DEC, 835, 240, 190, 130),
        ("p1", "Home / Hero", BLUE, 120, 500, 190, 80),
        ("p2", "Profil Perusahaan", BLUE, 350, 500, 210, 80),
        ("p3", "Layanan", BLUE, 610, 500, 190, 80),
        ("p4", "Portofolio / Galeri", BLUE, 860, 500, 230, 80),
        ("p5", "Kontak / CTA / WhatsApp", BLUE, 1170, 500, 240, 80),
        ("p6", "Edit konten, gambar, atau teks", GREEN, 780, 690, 300, 80),
        ("p7", "Preview perubahan", YELLOW, 830, 850, 200, 80),
        ("d2", "Sudah sesuai?", DEC, 835, 980, 190, 130),
        ("p8", "Revisi lagi", ORANGE, 500, 1015, 180, 80),
        ("p9", "Publish", PURPLE, 900, 1150, 160, 80),
        ("end", "Website terupdate", TERM, 850, 1300, 250, 60),
    ]
    for n in nodes:
        v(r, *n)
    for x in [
        ("e1", "s", "d1", ""),
        ("e2", "d1", "p1", "Home"),
        ("e3", "d1", "p2", "Profil"),
        ("e4", "d1", "p3", "Layanan"),
        ("e5", "d1", "p4", "Portofolio"),
        ("e6", "d1", "p5", "Kontak / CTA"),
        ("e7", "p1", "p6", ""),
        ("e8", "p2", "p6", ""),
        ("e9", "p3", "p6", ""),
        ("e10", "p4", "p6", ""),
        ("e11", "p5", "p6", ""),
        ("e12", "p6", "p7", ""),
        ("e13", "p7", "d2", ""),
        ("e14", "d2", "p8", "Belum"),
        ("e15", "d2", "p9", "Sudah"),
        ("e16", "p8", "p6", "Revisi"),
        ("e17", "p9", "end", ""),
    ]:
        e(r, *x)


def add_page_3(root):
    r = diagram(root, "page-structure-map", "03 Page Structure", 1800, 1300)
    v(r, "t3", "STRUKTUR HALAMAN WEBSITE COMPANY PROFILE", TITLE, 40, 20, 760, 30)
    v(r, "n3", "Map sederhana ini menunjukkan halaman utama yang paling cocok untuk scope Web Growth dan arah CTA utamanya.", NOTE, 40, 55, 1040, 20)
    nodes = [
        ("home", "Home", BLUE + "fontStyle=1;", 780, 160, 220, 80),
        ("about", "Tentang Kami", BLUE, 170, 420, 220, 80),
        ("services", "Layanan", BLUE, 500, 420, 220, 80),
        ("portfolio", "Portofolio / Galeri", BLUE, 830, 420, 250, 80),
        ("contact", "Kontak", BLUE, 1190, 420, 220, 80),
        ("cta", "CTA Utama&#xa;WhatsApp / Form", ORANGE + "fontStyle=1;", 780, 700, 220, 90),
        ("seo", "Fondasi SEO dasar&#xa;title, meta, heading, konten utama", YELLOW, 1350, 160, 300, 90),
        ("admin", "Dashboard admin&#xa;update konten dan galeri", GREEN, 120, 700, 260, 90),
        ("end", "Website siap dipakai untuk trust + lead generation", TERM, 720, 980, 340, 60),
    ]
    for n in nodes:
        v(r, *n)
    for x in [
        ("e1", "home", "about", ""),
        ("e2", "home", "services", ""),
        ("e3", "home", "portfolio", ""),
        ("e4", "home", "contact", ""),
        ("e5", "home", "cta", "CTA"),
        ("e6", "about", "cta", ""),
        ("e7", "services", "cta", ""),
        ("e8", "portfolio", "cta", ""),
        ("e9", "contact", "cta", ""),
        ("e10", "seo", "home", "Optimasi halaman"),
        ("e11", "admin", "home", "Update konten"),
        ("e12", "cta", "end", ""),
    ]:
        e(r, *x)


def build():
    root = mxfile()
    for fn in [add_page_0, add_page_1, add_page_2, add_page_3]:
        fn(root)
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    tree.write(OUT, encoding="utf-8", xml_declaration=False)
    xml = OUT.read_text(encoding="utf-8")
    xml = xml.replace("&amp;#xa;", "&#xa;")
    OUT.write_text(xml, encoding="utf-8")


if __name__ == "__main__":
    build()
