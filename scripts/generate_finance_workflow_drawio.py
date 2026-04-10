from pathlib import Path
import xml.etree.ElementTree as ET

OUT = Path(r"c:\LOGISTIK\app\FINANCE_WORKFLOW.drawio")

EDGE = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=classic;endFill=1;jettySize=auto;orthogonalLoop=1;fontSize=11;labelBackgroundColor=#ffffff;align=center;verticalAlign=middle;strokeColor=#111827;strokeWidth=2.4;fontColor=#111827;jumpStyle=arc;jumpSize=8;"
TEXT = "text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;"
TITLE = TEXT + "fontSize=24;fontStyle=1;"
NOTE = TEXT + "fontSize=11;fontColor=#666666;"
TERM = "ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;"
BLUE = "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;"
GREEN = "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;"
YELLOW = "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;"
ORANGE = "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;"
PURPLE = "rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;fontStyle=1;"
GREY = "rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;"
PANEL = "rounded=1;whiteSpace=wrap;html=1;fillColor=#fafafa;strokeColor=#b3b3b3;dashed=1;"

GEOMS: dict[int, dict[str, tuple[float, float, float, float]]] = {}


def mxfile():
    return ET.Element(
        "mxfile",
        host="app.diagrams.net",
        modified="2026-04-10T09:30:00.000Z",
        agent="Codex",
        version="24.7.17",
        type="device",
    )


def diagram(root, diag_id, name, page_w=2500, page_h=1600):
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


def add_finance_page(root):
    r = diagram(root, "finance-main", "00 Finance Workflow", 3000, 1750)

    v(r, "title", "FLOWCHART FINANCE DAN LAPORAN KEUANGAN", TITLE, 40, 20, 980, 30)
    v(
        r,
        "subtitle",
        "Alur dibuat dari atas ke bawah dan dibagi per domain supaya panah tetap jelas. Penjualan ditagihkan dari tonase final total di nota, sedangkan overtonase hanya dipakai untuk biaya internal trip dan tidak menjadi charge customer terpisah.",
        NOTE,
        40,
        55,
        1980,
        20,
    )

    v(r, "legend-panel", "", PANEL, 2050, 20, 910, 120)
    v(r, "legend-title", "Legenda", TEXT + "fontSize=14;fontStyle=1;", 2070, 32, 120, 20)
    v(r, "leg-1", "Dokumen / sumber transaksi", BLUE, 2070, 60, 170, 34)
    v(r, "leg-2", "Sudah hidup di sistem", GREEN, 2260, 60, 160, 34)
    v(r, "leg-3", "Pengelompokan laporan", YELLOW, 2440, 60, 170, 34)
    v(r, "leg-4", "Target pengembangan", GREY, 2630, 60, 160, 34)
    v(r, "leg-5", "Future pajak / accounting formal", ORANGE, 2070, 100, 230, 34)
    v(r, "leg-6", "Output laporan", PURPLE, 2320, 100, 160, 34)

    v(r, "start", "Transaksi Finance Operasional", TERM, 1310, 110, 380, 56)
    v(r, "band-source", "DOKUMEN / TRANSAKSI SUMBER", GREY + "fontStyle=1;", 120, 195, 2580, 38)
    e(r, "e-start-band", "start", "band-source", "")

    # Panels
    v(r, "panel-sales", "", PANEL, 60, 255, 620, 670)
    v(r, "panel-purchase", "", PANEL, 720, 255, 620, 670)
    v(r, "panel-cash", "", PANEL, 1380, 255, 660, 670)
    v(r, "panel-tax", "", PANEL, 2080, 255, 620, 670)

    v(r, "label-sales", "PENJUALAN & PIUTANG", TEXT + "fontSize=16;fontStyle=1;", 90, 272, 260, 24)
    v(r, "label-purchase", "PEMBELIAN & HUTANG", TEXT + "fontSize=16;fontStyle=1;", 750, 272, 260, 24)
    v(r, "label-cash", "KAS, BANK, DAN BEBAN", TEXT + "fontSize=16;fontStyle=1;", 1410, 272, 300, 24)
    v(r, "label-tax", "PAJAK", TEXT + "fontSize=16;fontStyle=1;", 2110, 272, 120, 24)

    # Sales panel
    v(r, "s1", "Freight Nota&#xa;(dasar tonase final total)", BLUE, 120, 345, 210, 76)
    v(r, "s2", "Customer Receipt / Payment", BLUE, 390, 345, 230, 76)
    v(r, "i2", "Piutang Customer", GREEN, 120, 540, 220, 82)
    v(r, "i1", "Pendapatan Penjualan&#xa;(berdasar tonase final)", GREEN, 390, 540, 220, 82)
    v(r, "i3", "Overpayment / Refund", GREEN, 255, 665, 230, 82)
    v(r, "m1", "Mutasi Kas dari Customer", GREEN, 220, 790, 300, 82)

    # Purchase panel
    v(r, "p1", "Pembelian Supplier", BLUE, 780, 345, 220, 76)
    v(r, "p2", "Terima Barang", BLUE, 1060, 345, 210, 76)
    v(r, "p3", "Purchase Payment", BLUE, 920, 455, 220, 76)
    v(r, "i4", "Hutang Supplier", GREEN, 780, 600, 220, 82)
    v(r, "i5", "Persediaan / Barang Gudang", GREEN, 1040, 600, 240, 82)
    v(r, "m2", "Mutasi Kas ke Supplier", GREEN, 900, 790, 260, 82)

    # Cash panel
    v(r, "c1", "Expense Operasional", BLUE, 1460, 345, 220, 76)
    v(r, "c2", "Maintenance / Voucher / Borongan&#xa;(termasuk upah overtonase internal)", BLUE, 1730, 345, 260, 76)
    v(r, "i7", "Beban Operasional Tercatat", GREEN, 1490, 600, 240, 82)
    v(r, "m3", "Mutasi Kas Operasional", GREEN, 1760, 600, 230, 82)

    # Tax panel
    v(r, "t1", "PPN Keluaran / Masukan", ORANGE, 2150, 345, 220, 76)
    v(r, "t2", "PPh Potong / Pungut", ORANGE, 2420, 345, 220, 76)
    v(r, "i8", "Rekap Pajak", GREY, 2150, 600, 220, 82)
    v(r, "i9", "Hutang Pajak", GREY, 2420, 600, 220, 82)

    # Shared accounting layer
    v(r, "band-summary", "RINGKASAN SALDO DAN PENGELOMPOKAN LAPORAN", GREY + "fontStyle=1;", 120, 960, 2580, 38)
    v(r, "kasbank", "Kas & Bank", GREEN, 1210, 1025, 620, 82)
    v(r, "g1", "Aktiva Lancar&#xa;(Kas/Bank, Piutang, Persediaan)", YELLOW, 500, 1160, 540, 92)
    v(r, "g2", "Kelompok Beban", YELLOW, 1210, 1160, 260, 92)
    v(r, "g3", "Pasiva Lancar&#xa;(Hutang Dagang, Hutang Pajak)", YELLOW, 1660, 1160, 500, 92)
    v(r, "g4", "Aktiva Tetap & Penyusutan", GREY, 2240, 1160, 220, 92)
    v(r, "g5", "Modal & Laba Ditahan", GREY, 2480, 1160, 220, 92)

    # Outputs
    v(r, "band-output", "OUTPUT LAPORAN", GREY + "fontStyle=1;", 120, 1325, 2580, 38)
    v(r, "o1", "Laba / Rugi", PURPLE, 1180, 1405, 250, 92)
    v(r, "o2", "Arus Kas", PURPLE, 1490, 1405, 230, 92)
    v(r, "o3", "Neraca", PURPLE, 1920, 1405, 260, 92)

    v(
        r,
        "tax-note",
        "PPN dan PPh ditampilkan sebagai arah pengembangan accounting formal. Saat ini sistem masih kuat di finance operasional, belum jurnal pajak formal penuh.",
        NOTE,
        2105,
        710,
        570,
        24,
    )
    v(
        r,
        "neraca-note",
        "Neraca penuh tetap membutuhkan penguatan aktiva tetap, penyusutan, modal, dan pajak. Karena itu blok abu-abu ditampilkan sebagai tahap pengembangan berikutnya.",
        NOTE,
        1700,
        1520,
        900,
        24,
    )

    # Sales edges
    e(r, "e-s1-i2", "s1", "i2", "tagihan customer")
    e(r, "e-s1-i1", "s1", "i1", "pendapatan dari tonase final")
    e(r, "e-s2-i2", "s2", "i2", "kurangi piutang", waypoints=[(505, 383), (505, 581), (340, 581)])
    e(r, "e-s2-i3", "s2", "i3", "lebih bayar?")
    e(r, "e-s2-m1", "s2", "m1", "kas / bank masuk", waypoints=[(620, 383), (620, 831), (520, 831)])
    e(r, "e-i3-m1", "i3", "m1", "refund / lebih bayar")

    # Purchase edges
    e(r, "e-p1-i4", "p1", "i4", "hutang supplier")
    e(r, "e-p2-i5", "p2", "i5", "stok masuk")
    e(r, "e-p3-i4", "p3", "i4", "kurangi hutang")
    e(r, "e-p3-m2", "p3", "m2", "kas / bank keluar")

    # Cash edges
    e(r, "e-c1-i7", "c1", "i7", "beban")
    e(r, "e-c1-m3", "c1", "m3", "pembayaran")
    e(r, "e-c2-i7", "c2", "i7", "beban trip / kendaraan")
    e(r, "e-c2-m3", "c2", "m3", "pembayaran")

    # Tax edges
    e(r, "e-t1-i8", "t1", "i8", "")
    e(r, "e-t2-i8", "t2", "i8", "")
    e(r, "e-i8-i9", "i8", "i9", "kewajiban pajak")

    # Mutations to cash/bank
    e(r, "e-m1-kas", "m1", "kasbank", "update kas / bank", waypoints=[(370, 950), (1520, 950), (1520, 1025)])
    e(r, "e-m2-kas", "m2", "kasbank", "update kas / bank", waypoints=[(1030, 950), (1520, 950), (1520, 1025)])
    e(r, "e-m3-kas", "m3", "kasbank", "update kas / bank")

    # To grouping
    e(r, "e-i2-g1", "i2", "g1", "masuk aktiva lancar", waypoints=[(230, 705), (230, 1206), (500, 1206)])
    e(r, "e-i5-g1", "i5", "g1", "masuk aktiva lancar", waypoints=[(1160, 705), (1160, 1206), (1040, 1206)])
    e(r, "e-kas-g1", "kasbank", "g1", "saldo lancar", waypoints=[(1330, 1107), (1330, 1206), (1040, 1206)])
    e(r, "e-i7-g2", "i7", "g2", "masuk beban", waypoints=[(1610, 705), (1610, 1206), (1470, 1206)])
    e(r, "e-i4-g3", "i4", "g3", "masuk pasiva lancar", waypoints=[(890, 705), (890, 1206), (1660, 1206)])
    e(r, "e-i9-g3", "i9", "g3", "masuk pasiva lancar", waypoints=[(2530, 705), (2530, 1206), (2160, 1206)])

    # To output reports
    e(r, "e-i1-o1", "i1", "o1", "pendapatan", waypoints=[(500, 705), (500, 1451), (1180, 1451)])
    e(r, "e-g2-o1", "g2", "o1", "beban", waypoints=[(1340, 1252), (1340, 1405)])
    e(r, "e-kas-o2", "kasbank", "o2", "mutasi kas / bank", waypoints=[(1600, 1107), (1600, 1405)])
    e(r, "e-g1-o3", "g1", "o3", "aktiva lancar", waypoints=[(770, 1252), (770, 1475), (1920, 1475)])
    e(r, "e-g3-o3", "g3", "o3", "pasiva lancar", waypoints=[(1910, 1252), (1910, 1405)])
    e(r, "e-g4-o3", "g4", "o3", "aktiva tetap", waypoints=[(2240, 1206), (2240, 1430), (2180, 1430)])
    e(r, "e-g5-o3", "g5", "o3", "modal", waypoints=[(2480, 1206), (2480, 1520), (2180, 1520)])
    e(r, "e-o1-o3", "o1", "o3", "laba / rugi berjalan", waypoints=[(1430, 1451), (1920, 1451)])


def build():
    root = mxfile()
    add_finance_page(root)
    ET.indent(root)
    OUT.write_text(ET.tostring(root, encoding="unicode"), encoding="utf-8")
    print("FINANCE_WORKFLOW_XML_OK")
    print(OUT)


if __name__ == "__main__":
    build()
