from pathlib import Path
import xml.etree.ElementTree as ET

OUT = Path(r"c:\LOGISTIK\app\WORKFLOW.drawio")
EDGE = "edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;endArrow=block;endFill=1;jettySize=auto;orthogonalLoop=1;fontSize=11;labelBackgroundColor=#ffffff;align=center;verticalAlign=middle;"
TEXT = "text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;"
TITLE = TEXT + "fontSize=24;fontStyle=1;"
NOTE = TEXT + "fontSize=11;fontColor=#666666;"
TERM = "ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontStyle=1;"
DEC = "rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontStyle=1;"
RED = "rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;"
BLUE = "rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;"
GREEN = "rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;"
YELLOW = "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;"
ORANGE = "rounded=1;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;"
PURPLE = "rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;"
PINK = "rounded=1;whiteSpace=wrap;html=1;fillColor=#ead1dc;strokeColor=#c27ba0;"
GREY = "rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;"
PANEL = "rounded=1;whiteSpace=wrap;html=1;fillColor=#fafafa;strokeColor=#b3b3b3;dashed=1;"
LANE = "swimlane;html=1;rounded=1;startSize=34;fillColor=#fafafa;strokeColor=#666666;fontStyle=1;"
REF = "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff7e6;strokeColor=#999999;dashed=1;"
GEOMS = {}

def mxfile():
    return ET.Element("mxfile", host="app.diagrams.net", modified="2026-04-05T14:00:00.000Z", agent="Codex", version="24.7.17", type="device")

def diagram(root, diag_id, name, page_w=2400, page_h=1400):
    diag = ET.SubElement(root, "diagram", id=diag_id, name=name)
    model = ET.SubElement(diag, "mxGraphModel", dx="1800", dy="1000", grid="1", gridSize="10", guides="1", tooltips="1", connect="1", arrows="1", fold="1", page="1", pageScale="1", pageWidth=str(page_w), pageHeight=str(page_h), math="0", shadow="0")
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
    attrs = {"id": cid, "style": EDGE + _anchor_style(root, source, target) + style_extra, "edge": "1", "parent": "1", "source": source, "target": target}
    if label:
        attrs["value"] = label
    cell = ET.SubElement(root, "mxCell", **attrs)
    geom = ET.SubElement(cell, "mxGeometry", relative="1", **{"as": "geometry"})
    if waypoints:
        arr = ET.SubElement(geom, "Array", **{"as": "points"})
        for x, y in waypoints:
            ET.SubElement(arr, "mxPoint", x=str(x), y=str(y))

def add_page_0(root):
    r = diagram(root, "master-setup-flow", "00 Master Setup", 1800, 1850)
    v(r, "t0", "FLOWCHART MASTER SETUP SEBELUM OPERASIONAL", TITLE, 40, 20, 860, 30)
    v(r, "n0", "Urutannya dibuat dari atas ke bawah agar mudah dimasukkan ke Word. Semua master inti harus beres dulu sebelum flow harian dimulai.", NOTE, 40, 55, 1120, 20)
    nodes = [
        ("s","Mulai setup sistem",TERM,815,110,170,60),
        ("p1","Setup Company / branding / user policy",BLUE,790,210,220,80),
        ("p2","Setup Rekening / Kas",BLUE,805,315,190,80),
        ("p3","Setup Customer",BLUE,810,420,180,80),
        ("p4","Setup Pengirim / Penerima",BLUE,795,525,210,80),
        ("p5","Setup Barang Customer",BLUE,800,630,200,80),
        ("p6","Setup Driver",GREEN,815,735,170,80),
        ("p7","Setup Kendaraan",GREEN,810,840,180,80),
        ("p8","Setup Tarif Rute Trip",YELLOW,805,945,190,80),
        ("p9","Setup Kategori Expense",YELLOW,790,1050,220,80),
        ("d1","Master inti lengkap?",DEC,800,1175,200,140),
        ("p10","Lengkapi master yang belum siap",ORANGE,420,1205,230,90),
        ("p11","Lanjut ke Flow 01&#xa;End-to-End Main Flow",REF,1140,1210,220,90),
        ("end","Siap operasional",TERM,1170,1360,160,60),
    ]
    for n in nodes: v(r, *n)
    edges = [
        ("e1","s","p1",""),("e2","p1","p2",""),("e3","p2","p3",""),("e4","p3","p4",""),("e5","p4","p5",""),
        ("e6","p5","p6",""),("e7","p6","p7",""),("e8","p7","p8",""),("e9","p8","p9",""),("e10","p9","d1",""),
        ("e11","d1","p10","Belum lengkap"),("e12","d1","p11","Lengkap"),("e13","p10","p1","Lengkapi lalu cek lagi"),("e14","p11","end",""),
    ]
    for x in edges[:-2]:
        e(r, *x)
    e(r, "e13", "p10", "p1", "Lengkapi lalu cek lagi", waypoints=[(360, 1250), (360, 250), (790, 250)])
    e(r, "e14", "p11", "end", "")


def add_page_1(root):
    r = diagram(root, "end-to-end-main", "01 End-to-End Main Flow", 1800, 2200)
    v(r, "t1", "FLOWCHART UTAMA END-TO-END", TITLE, 40, 20, 520, 30)
    v(r, "n1", "Halaman utama ini dibuat top-down. Cabang yang rumit tetap dipisah ke flow detail agar halaman inti tetap rapi untuk Word.", NOTE, 40, 55, 980, 20)
    nodes = [
        ("s","Masuk dari Flow 00&#xa;Master Setup selesai",TERM,800,120,200,70),
        ("d1","Master inti masih lengkap?",DEC,810,240,180,130),
        ("r0","Balik ke Flow 00&#xa;Master Setup",REF,430,265,190,80),
        ("p1","Buat Order / Resi",RED + "fontStyle=1;",800,430,200,80),
        ("r1","Lihat Flow 02&#xa;Order and Delivery Order",REF,1130,430,230,80),
        ("p2","DO siap jalan",RED + "fontStyle=1;",810,590,180,80),
        ("p3","Eksekusi trip + tracking",PURPLE,790,760,220,80),
        ("r2","Lihat Flow 03&#xa;Delivery Execution and Tracking",REF,1130,760,240,80),
        ("d2","Perlu bon trip / borongan?",DEC,810,930,180,130),
        ("r3","Lihat Flow 04&#xa;Trip Cash and Borongan",REF,1130,955,220,80),
        ("d3","DO sudah delivered?",DEC,810,1110,180,130),
        ("p4","Buat Nota / tagihan",BLUE + "fontStyle=1;",800,1290,200,80),
        ("r4","Lihat Flow 05&#xa;Invoice to Receipt and Refund",REF,1130,1290,240,80),
        ("p5","Ledger / cashflow / laporan",BLUE + "fontStyle=1;",790,1470,220,80),
        ("r5","Lihat Flow 06&#xa;Ledger and Cashflow",REF,1130,1470,210,80),
        ("d4","Ada event armada yang perlu diproses?",DEC,805,1640,190,140),
        ("r6","Lihat Flow 07&#xa;Fleet Operations",REF,1130,1670,210,80),
        ("end","Selesai&#xa;Operasional dan finance sinkron",TERM,800,1850,200,70),
    ]
    for n in nodes: v(r, *n)
    edges = [
        ("e1","s","d1",""),("e2","d1","r0","Belum"),("e3","d1","p1","Lengkap"),("e4","p1","r1",""),
        ("e5","r1","p2","Lanjut proses"),("e6","p2","p3",""),("e7","p3","r2",""),
        ("e8","r2","d2","Lanjut"),("e9","d2","r3","Ya"),("e10","d2","d3","Tidak"),
        ("e11","r3","d3","Setelah diproses"),("e12","d3","p4","Sudah"),("e14","p4","r4",""),("e15","r4","p5","Setelah billing"),("e16","p5","r5",""),
        ("e17","r5","d4","Lanjut"),("e18","d4","r6","Ya"),("e19","d4","end","Tidak"),("e20","r6","end","Setelah diproses"),
    ]
    for x in edges:
        e(r, *x)
    e(r, "e13", "d3", "p3", "Belum", waypoints=[(520, 1175), (520, 800), (790, 800)])

def add_page_2(root):
    r = diagram(root, "order-do-flow", "02 Order and Delivery Order Flow", 1900, 2200)
    v(r, "t2", "FLOWCHART ORDER / RESI SAMPAI SURAT JALAN", TITLE, 40, 20, 740, 30)
    v(r, "n2", "Halaman ini diubah jadi alur vertikal. Cabang edit, partial, dan lock finance ditaruh di samping agar panah tidak saling silang.", NOTE, 40, 55, 1080, 20)
    nodes = [
        ("s","Mulai oleh Owner / Operasional",TERM,820,120,220,60),
        ("d1","Master customer, pickup, recipient, produk, dan armada sudah siap?",DEC,835,220,190,130),
        ("p1","Lengkapi / perbaiki master dulu",BLUE,470,245,220,80),
        ("p2","Buat Order / Resi + item muatan",RED + "fontStyle=1;",810,420,240,80),
        ("d2","Order masih fleksibel?&#xa;Belum punya DO, progress, assign, atau hold blocker",DEC,835,545,190,140),
        ("p3","Edit order penuh masih boleh&#xa;header + item + pengirim / penerima",GREEN,1160,470,240,90),
        ("p4","Edit massal diblok&#xa;Tersisa revisi target / hold / aksi aman saja",ORANGE,1160,610,240,90),
        ("d3","Perlu hold item atau revisi target?",DEC,835,740,190,130),
        ("p5","Set hold / release hold / revise target",ORANGE,1160,765,230,80),
        ("d4","Sudah siap dibuat DO?",DEC,835,930,190,130),
        ("p6","Order tetap open sambil tunggu data / keputusan operasional",GREY,470,955,250,90),
        ("p7","Buat DO + isi driver, kendaraan, no SJ pengirim, dan route fee snapshot",RED + "fontStyle=1;",790,1115,280,90),
        ("d5","Validasi create DO lolos?",DEC,835,1270,190,130),
        ("p8","Perbaiki data / master / alasan override lalu ulangi create DO",BLUE,1160,1295,250,90),
        ("d6","Trip partial?",DEC,835,1465,170,130),
        ("p9","Semua item terambil di 1 DO",GREEN,470,1485,220,80),
        ("d7","Hold sisa muatan?",DEC,1165,1455,180,130),
        ("p10","Sisa item ditahan",ORANGE,1435,1405,240,80),
        ("p11","Sisa order tetap bisa diproses lagi",BLUE,1435,1515,240,80),
        ("d8","Perlu koreksi DO setelah terbit?",DEC,835,1665,200,130),
        ("d9","DO sudah terhubung ke voucher / finance lock?",DEC,835,1855,200,130),
        ("p12","Masih boleh ubah assign, ref, shipper, dan field aman lain sesuai guard",GREEN,1160,1790,250,90),
        ("p13","Field yang memengaruhi finance terkunci&#xa;Tersisa update status / referensi aman",RED,1160,1920,250,90),
        ("end","Selesai&#xa;DO siap ke eksekusi trip",TERM,810,2060,240,70),
    ]
    for n in nodes: v(r, *n)
    edges = [
        ("e1","s","d1",""),("e2","d1","p1","Belum"),("e3","d1","p2","Siap"),("e4","p1","p2","Setelah lengkap"),
        ("e5","p2","d2",""),("e6","d2","p3","Ya"),("e7","d2","p4","Tidak"),("e8","p3","d3",""),("e9","p4","d3",""),
        ("e10","d3","p5","Ya"),("e11","d3","d4","Tidak"),("e12","p5","d4",""),("e13","d4","p6","Belum"),("e14","d4","p7","Siap"),
        ("e15","p7","d5",""),("e16","d5","p8","Gagal"),("e17","d5","d6","Lolos"),("e19","d6","p9","Tidak"),("e20","d6","d7","Ya"),
        ("e21","d7","p10","Ya"),("e22","d7","p11","Tidak"),("e23","p9","d8",""),("e24","p10","d8",""),("e25","p11","d8",""),
        ("e26","d8","end","Tidak"),("e27","d8","d9","Ya"),("e28","d9","p12","Belum lock"),("e29","d9","p13","Sudah lock"),("e30","p12","end",""),("e31","p13","end","")
    ]
    for x in edges:
        e(r, *x)
    e(r, "e18", "p8", "p7", "Perbaiki lalu ulangi", waypoints=[(1490, 1340), (1490, 1160), (1070, 1160)])

def add_page_3(root):
    r = diagram(root, "delivery-tracking-flow", "03 Delivery Execution and Tracking", 2400, 1300)
    v(r, "t3", "FLOWCHART EKSEKUSI DO DAN TRACKING DRIVER", TITLE, 40, 20, 760, 30)
    v(r, "n3", "Alur dari driver login sampai delivered approval. Patokan dari route driver tracking dan update status DO aktif.", NOTE, 40, 55, 1020, 20)
    nodes = [("s","Driver login dan buka DO aktif",TERM,70,190,180,60),("d1","Ada DO assigned / active untuk driver ini?",DEC,320,155,190,130),("p1","Tunggu assign baru dari admin / operasional",GREY,590,180,210,80),("d2","Start / resume valid?&#xa;Driver pemilik DO, GPS valid, DO tidak cancelled, lock tidak bentrok",DEC,880,145,220,150),("p2","Tolak request&#xa;(409 / 400 sesuai guard)",RED,1180,180,180,80),("p3","Start / resume tracking&#xa;+ lock driver ke DO aktif",BLUE + "fontStyle=1;",1440,180,210,80),("p4","Heartbeat dan update status live&#xa;ON_DELIVERY / ARRIVED",PURPLE,1730,180,220,80),("d3","Pause diminta?",DEC,880,455,170,130),("p5","Set tracking PAUSED",ORANGE,1130,480,170,80),("d4","DO sudah closed&#xa;(DELIVERED / CANCELLED)?",DEC,1370,445,190,150),("p6","Release activeTrackingDeliveryOrderRef",GREEN,1640,480,210,80),("p7","Tetap pause pada DO yang sama",GREY,1640,610,210,80),("d5","Resume lagi?",DEC,1910,570,170,130),("p8","Resume tracking dan lanjut heartbeat",BLUE,2140,595,210,80),("d6","Driver mengajukan delivered + POD?",DEC,880,840,190,130),("p9","Lanjut perjalanan / update status berikutnya",GREY,1150,865,210,80),("p10","Kirim delivered request&#xa;+ data POD",ORANGE,1440,865,190,80),("d7","Owner / Operasional approve?",DEC,1710,830,180,150),("p11","Reject request&#xa;Driver kembali ke flow trip",RED,1970,865,200,80),("p12","Mark DELIVERED&#xa;+ close tracking + siap ditagihkan",GREEN + "fontStyle=1;",1970,1005,200,80),("end","Selesai",TERM,2010,1150,120,60)]
    for n in nodes: v(r, *n)
    edges = [("e1","s","d1",""),("e2","d1","p1","Tidak ada"),("e3","d1","d2","Ada"),("e4","d2","p2","Tidak valid"),("e5","d2","p3","Valid"),("e6","p3","p4",""),("e7","p2","d2","Perbaiki lalu coba lagi"),("e8","p4","d3",""),("e9","d3","p5","Ya"),("e10","d3","d6","Tidak"),("e11","p5","d4",""),("e12","d4","p6","Ya"),("e13","d4","p7","Belum"),("e14","p7","d5",""),("e15","d5","p8","Ya"),("e16","d5","d6","Tidak"),("e17","p8","p4",""),("e18","p6","end","Rilis lock lalu selesai"),("e19","d6","p9","Belum"),("e20","d6","p10","Sudah"),("e21","p9","p4",""),("e22","p10","d7",""),("e23","d7","p11","Tolak"),("e24","d7","p12","Setuju"),("e25","p11","p4","Balik eksekusi"),("e26","p12","end","")]
    for x in edges: e(r, *x)

def add_page_4(root):
    r = diagram(root, "trip-cash-borongan-flow", "04 Trip Cash and Borongan Flow", 2100, 1950)
    v(r, "t4", "FLOWCHART UANG JALAN TRIP DAN BORONGAN SUPIR", TITLE, 40, 20, 820, 30)
    v(r, "n4", "Dua panel dipertahankan, tapi masing-masing sudah dibuat top-down agar tetap kebaca saat ditempel ke Word.", NOTE, 40, 55, 1080, 20)
    v(r, "left_panel", "A. UANG JALAN TRIP", PANEL, 40, 110, 930, 1720)
    v(r, "right_panel", "B. BORONGAN SUPIR", PANEL, 1030, 110, 930, 1720)
    nodes = [
        ("ls","Mulai dari DO eligible",TERM,380,180,220,60),
        ("ld1","DO sudah punya voucher?",DEC,395,285,190,130),
        ("lp1","Tolak create voucher",RED,120,310,200,80),
        ("lp2","Buat voucher dari DO&#xa;+ upah trip snapshot read-only",ORANGE + "fontStyle=1;",370,480,240,90),
        ("ld2","Perlu top up?",DEC,400,620,180,130),
        ("lp3","Top up dari rekening / kas&#xa;wajib saldo cukup",ORANGE,670,645,220,80),
        ("ld3","Ada biaya jalan?",DEC,400,800,180,130),
        ("lp4","Tambah / hapus item biaya&#xa;selama voucher belum settle",ORANGE,670,825,220,80),
        ("lp5","Proses settlement",BLUE + "fontStyle=1;",380,990,220,80),
        ("ld4","DO bentrok borongan / lock lain?",DEC,395,1120,190,140),
        ("lp6","Block settlement sampai bentrok selesai",RED,120,1150,220,80),
        ("ld5","Net settlement?",DEC,395,1320,180,140),
        ("lp7","Perusahaan bayar driver",GREEN,90,1500,210,80),
        ("lp8","Tutup tanpa mutasi tambahan",GREY,380,1500,220,80),
        ("lp9","Driver setor balik / repair issue",RED,670,1500,220,80),
        ("lend","Voucher settled&#xa;Top up / item / edit finansial terkunci",TERM,360,1670,260,70),

        ("rs","Owner pilih DO delivered / row manual",TERM,1330,180,260,60),
        ("rd1","Sumber row dari DO atau manual?",DEC,1365,285,190,130),
        ("rp1","Ambil data DO valid&#xa;dan cek belum bentrok",PINK,1100,475,220,80),
        ("rp2","Tambah row manual yang valid",PINK,1410,475,220,80),
        ("rp3","Buat slip borongan",PINK + "fontStyle=1;",1320,650,240,80),
        ("rd2","Bayar sekarang?",DEC,1365,785,190,130),
        ("rp4","Tetap unpaid&#xa;menunggu pembayaran owner",GREY,1080,810,240,80),
        ("rd3","Saldo rekening / kas cukup?",DEC,1360,980,200,140),
        ("rp5","Tolak bayar&#xa;overdraft tidak boleh",RED,1080,1015,230,80),
        ("rp6","Bayar borongan + mutasi ledger",BLUE + "fontStyle=1;",1410,1010,240,90),
        ("rend","Slip borongan PAID / UNPAID",TERM,1315,1195,260,70),
    ]
    for n in nodes: v(r, *n)
    edges = [
        ("e1","ls","ld1",""),("e2","ld1","lp1","Sudah"),("e3","ld1","lp2","Belum"),("e4","lp2","ld2",""),
        ("e5","ld2","lp3","Ya"),("e6","ld2","ld3","Tidak"),("e7","lp3","ld3",""),("e8","ld3","lp4","Ya"),("e9","ld3","lp5","Tidak"),
        ("e10","lp4","lp5",""),("e11","lp5","ld4",""),("e12","ld4","lp6","Ya"),("e13","ld4","ld5","Tidak"),
        ("e15","ld5","lp7","&gt; 0"),("e16","ld5","lp8","= 0"),("e17","ld5","lp9","&lt; 0"),("e18","lp7","lend",""),("e19","lp8","lend",""),("e20","lp9","lend",""),
        ("e21","rs","rd1",""),("e22","rd1","rp1","DO"),("e23","rd1","rp2","Manual"),("e24","rp1","rp3",""),("e25","rp2","rp3",""),
        ("e26","rp3","rd2",""),("e27","rd2","rp4","Belum"),("e28","rd2","rd3","Bayar"),("e29","rd3","rp5","Tidak"),("e30","rd3","rp6","Cukup"),
        ("e31","rp4","rend",""),("e32","rp5","rend",""),("e33","rp6","rend","")
    ]
    for x in edges:
        e(r, *x)
    e(r, "e14", "lp6", "lp5", "Coba lagi nanti", waypoints=[(90, 1190), (90, 1030), (380, 1030)])

def add_page_5(root):
    r = diagram(root, "invoice-receipt-refund", "05 Invoice to Receipt and Refund", 1950, 2200)
    v(r, "t5", "FLOWCHART NOTA, KLAIM, PAYMENT, RECEIPT, KELEBIHAN BAYAR, REFUND", TITLE, 40, 20, 1100, 30)
    v(r, "n5", "Halaman ini dibuat vertikal dari create nota sampai refund. Sumber kelebihan bayar dan pilihan input payment dipisah ke samping agar cabang tetap jelas.", NOTE, 40, 55, 1120, 20)
    nodes = [
        ("s","Mulai dari DO delivered",TERM,850,120,180,60),
        ("d1","DO valid untuk ditagihkan?&#xa;Belum pernah masuk nota, customer konsisten",DEC,840,220,200,130),
        ("p1","Perbaiki data DO / customer / billing dulu",RED,470,245,230,80),
        ("p2","Buat Nota&#xa;+ hitung tagihan awal",BLUE + "fontStyle=1;",830,420,220,80),
        ("d2","Ada claim / potongan?",DEC,850,545,180,130),
        ("p3","Create / edit / void / hapus klaim aktif&#xa;boleh sebelum atau sesudah pembayaran",ORANGE,1160,565,250,90),
        ("p4","Tagihan Final = Tagihan Awal - Potongan",GREEN,830,750,220,80),
        ("d3","Input uang masuk via?",DEC,850,875,180,130),
        ("p5","Payment langsung ke 1 nota",BLUE,1160,810,210,80),
        ("p6","Customer receipt&#xa;alokasi ke 1 atau banyak nota",BLUE,1160,920,230,90),
        ("p7","Total paid / allocated updated",GREEN + "fontStyle=1;",830,1085,220,80),
        ("d4","Bandingkan Total Dibayar vs Tagihan Final",DEC,835,1215,210,130),
        ("p8","Catat sisa piutang nota",RED,470,1240,250,80),
        ("p9","Tutup nota sebagai lunas",GREEN,835,1395,210,80),
        ("p10","Buat kasus kelebihan bayar",ORANGE,1160,1240,220,80),
        ("d5","Sumber kelebihan bayar?",DEC,1165,1385,200,130),
        ("p11","Receipt remainder&#xa;uang masuk lebih besar dari alokasi",YELLOW,470,1510,240,90),
        ("p12","Invoice overpaid&#xa;claim turun setelah payment",YELLOW,780,1510,220,90),
        ("p13","Catat kasus kelebihan bayar&#xa;+ tanggal deteksi + tindak lanjut",RED + "fontStyle=1;",1115,1520,260,90),
        ("d6","Refund sekarang?",DEC,1140,1715,190,130),
        ("p14","Biarkan kasus tetap terbuka",GREY,470,1740,220,80),
        ("d7","Saldo rekening / kas cukup?",DEC,1140,1900,200,140),
        ("p15","Tahan refund sampai saldo cukup",RED,780,1930,230,80),
        ("p16","Proses refund + audit log + ledger outflow",BLUE + "fontStyle=1;",1380,1930,280,90),
        ("end","Selesai&#xa;List nota, queue overpayment, bank detail, dan reports ikut berubah",TERM,1120,2105,240,70),
    ]
    for n in nodes: v(r, *n)
    edges = [
        ("e1","s","d1",""),("e2","d1","p1","Tidak"),("e3","d1","p2","Ya"),("e4","p1","p2","Setelah beres"),("e5","p2","d2",""),
        ("e6","d2","p3","Ya"),("e7","d2","p4","Tidak"),("e8","p3","p4",""),("e9","p4","d3",""),("e10","d3","p5","Payment"),
        ("e11","d3","p6","Receipt"),("e12","p5","p7",""),("e13","p6","p7",""),("e14","p7","d4",""),("e15","d4","p8","Kurang"),
        ("e16","d4","p9","Pas"),("e17","d4","p10","Lebih"),("e18","p10","d5",""),("e19","d5","p11","Receipt sisa"),
        ("e20","d5","p12","Claim sesudah bayar"),("e21","p11","p13",""),("e22","p12","p13",""),("e23","p13","d6",""),
        ("e24","d6","p14","Belum"),("e25","d6","d7","Refund"),("e26","d7","p15","Tidak cukup"),("e27","d7","p16","Cukup"),
        ("e28","p8","end",""),("e29","p9","end",""),("e30","p14","end",""),("e31","p15","end",""),("e32","p16","end","")
    ]
    for x in edges:
        e(r, *x)

def add_page_6(root):
    r = diagram(root, "ledger-cashflow-flow", "06 Ledger and Cashflow Flow", 1800, 1900)
    v(r, "t6", "FLOWCHART LEDGER REKENING / KAS DAN CASHFLOW", TITLE, 40, 20, 780, 30)
    v(r, "n6", "Semua mutasi uang masuk / keluar berujung ke bank transaction. Saldo akun diturunkan dari ledger, bukan percaya snapshot mentah.", NOTE, 40, 55, 1050, 20)
    nodes = [
        ("s","Mulai dari transaksi finance / operasional",TERM,760,120,280,60),
        ("ref1","Sumber mutasi bisa berasal dari:&#xa;Receipt / Payment&#xa;Expense&#xa;Transfer antar rekening&#xa;Voucher / Top Up / Settlement&#xa;Borongan payment&#xa;Refund overpayment",REF,100,190,300,180),
        ("d1","Role boleh aksi dan source doc valid?",DEC,810,265,180,130),
        ("p1","Reject / 404 / 403",RED,500,290,180,80),
        ("d2","Mutasi mengurangi saldo akun sumber?",DEC,810,470,220,140),
        ("d3","Saldo akun sumber cukup?",DEC,815,675,210,140),
        ("p2","Block overdraft",RED,500,705,200,80),
        ("d4","Transfer internal antar akun?",DEC,810,900,220,140),
        ("p3","Buat 1 bank transaction&#xa;sesuai source doc",BLUE,470,930,220,90),
        ("p4","Buat debit + credit pair&#xa;pakai transfer id unik",BLUE + "fontStyle=1;",1120,925,240,100),
        ("p5","Hitung ulang saldo akun dari ledger",GREEN + "fontStyle=1;",780,1140,270,90),
        ("p6","Propagasikan ke detail rekening, arus kas, dashboard, laporan, dan audit",PURPLE,740,1320,350,100),
        ("end","Selesai",TERM,845,1500,140,60),
    ]
    for n in nodes: v(r, *n)
    for x in [
        ("e1","s","d1",""),("e2","d1","p1","Tidak"),("e3","d1","d2","Valid"),
        ("e4","d2","d3","Ya"),("e5","d2","d4","Tidak"),
        ("e6","d3","p2","Tidak cukup"),("e7","d3","d4","Cukup"),
        ("e8","d4","p3","Bukan transfer"),("e9","d4","p4","Ya"),
        ("e10","p3","p5",""),("e11","p4","p5",""),
        ("e12","p5","p6",""),("e13","p6","end",""),
        ("e14","p1","end",""),("e15","p2","end","")
    ]:
        e(r, *x)

def add_page_7(root):
    r = diagram(root, "fleet-operations-flow", "07 Fleet Operations Flow", 2100, 1900)
    v(r, "t7", "FLOWCHART ARMADA, DRIVER, MAINTENANCE, INSIDEN, DAN BAN", TITLE, 40, 20, 900, 30)
    v(r, "n7", "Tiga panel tetap dipisah, tetapi tiap panel sekarang top-down agar pola visualnya konsisten dengan flow utama dan finance.", NOTE, 40, 55, 1100, 20)
    v(r, "panelA", "A. KESIAPAN DRIVER DAN KENDARAAN", PANEL, 40, 110, 620, 1600)
    v(r, "panelB", "B. MAINTENANCE DAN INSIDEN", PANEL, 740, 110, 620, 1600)
    v(r, "panelC", "C. BAN DAN HISTORI UNIT", PANEL, 1440, 110, 620, 1600)
    nodes = [
        ("a1","Mulai setup trip",TERM,245,180,200,60),("a2","Kendaraan aktif?",DEC,260,285,170,130),("a3","Driver aktif?",DEC,260,470,170,130),("a4","Aktifkan / perbaiki master unit dulu",RED,90,315,210,80),("a5","Aktifkan / perbaiki master driver dulu",RED,90,500,220,80),("a6","Resource boleh dipakai di DO",GREEN,230,685,230,80),("a7","Buka histori driver / kendaraan / trip terkait",BLUE,210,825,270,80),
        ("b1","Buat maintenance",TERM,925,180,220,60),("b2","Tentukan basis jadwal maintenance&#xa;date atau odometer",YELLOW,905,290,260,90),("b3","Kerjakan maintenance",GREEN,940,435,190,80),("b4","Perlu expense?",DEC,945,565,180,130),("b5","Buat expense terkait maintenance",ORANGE,900,735,270,80),("b6","Buat incident",TERM,940,930,190,60),("b7","Driver & kendaraan valid?",DEC,940,1030,190,130),("b8","Tolak incident sampai master valid",RED,760,1060,220,80),("b9","Incident open",RED,940,1215,190,80),("b10","Perlu expense / perbaikan?",DEC,935,1340,200,130),("b11","Buat expense terkait incident",ORANGE,760,1370,230,80),("b12","Resolve incident",GREEN,1070,1370,200,80),
        ("c1","Register ban",TERM,1630,180,220,60),("c2","Ban dipasang ke unit?",DEC,1645,285,190,130),("c3","Masuk stok ban",GREY,1480,470,200,80),("c4","Catat posisi ban di kendaraan",GREEN,1780,470,220,80),("c5","Ada event pindah / scrap / rusak?",DEC,1645,650,210,130),("c6","Update histori ban dan posisi",BLUE,1625,825,250,80),("c7","Histori unit, ban, maintenance, incident tetap konsisten",TERM,1595,980,310,70)
    ]
    for n in nodes: v(r, *n)
    for x in [("e1","a1","a2",""),("e2","a2","a4","Tidak"),("e3","a2","a3","Aktif"),("e4","a3","a5","Tidak"),("e5","a3","a6","Aktif"),("e6","a4","a6","Setelah beres"),("e7","a5","a6","Setelah beres"),("e8","a6","a7",""),("e9","b1","b2",""),("e10","b2","b3",""),("e11","b3","b4",""),("e12","b4","b5","Ya"),("e13","b4","b6","Tidak"),("e14","b5","b6",""),("e15","b6","b7",""),("e16","b7","b8","Tidak"),("e17","b7","b9","Valid"),("e19","b9","b10",""),("e20","b10","b11","Ya"),("e21","b10","b12","Tidak"),("e22","b11","b12",""),("e23","c1","c2",""),("e24","c2","c3","Belum"),("e25","c2","c4","Pasang"),("e26","c3","c5",""),("e27","c4","c5",""),("e28","c5","c6","Ya"),("e29","c5","c7","Tidak"),("e30","c6","c7","")]:
        e(r, *x)
    e(r, "e18", "b8", "b6", "Perbaiki lalu ulangi", waypoints=[(720, 1100), (720, 960), (940, 960)])

def add_page_8(root):
    r = diagram(root, "role-swimlane-flow", "08 Role Swimlane End-to-End", 2600, 1500)
    v(r, "t8", "FLOWCHART LINTAS ROLE END-TO-END", TITLE, 40, 20, 620, 30)
    v(r, "n8", "Setiap lane menunjukkan siapa yang memegang langkah utama. Ini bukan daftar akses, tapi perjalanan proses dari kiri ke kanan.", NOTE, 40, 55, 1040, 20)
    lanes = [("lane_owner", "OWNER", 40, 110, 500, 1180, "#fff2cc", "#d6b656"),("lane_ops", "OPERASIONAL", 560, 110, 500, 1180, "#f8cecc", "#b85450"),("lane_armada", "ARMADA", 1080, 110, 500, 1180, "#d5e8d4", "#82b366"),("lane_driver", "DRIVER", 1600, 110, 420, 1180, "#e1d5e7", "#9673a6"),("lane_finance", "FINANCE", 2040, 110, 500, 1180, "#dae8fc", "#6c8ebf")]
    for lid, title, x, y, w, h, fill, stroke in lanes: v(r, lid, title, LANE + f"fillColor={fill};strokeColor={stroke};", x, y, w, h)
    nodes = [("o1","Set company policy, master global, audit",TERM,120,200,220,60),("o2","Approve override penting / pantau dashboard",YELLOW,120,420,240,80),("ops1","Buat order / resi",TERM,650,200,180,60),("ops2","Siapkan DO",RED + "fontStyle=1;",650,360,190,80),("ops3","Buat voucher / nota bila role izinnya ada",ORANGE,650,560,220,90),("arm1","Pastikan driver & kendaraan siap",TERM,1180,220,230,60),("arm2","Kelola maintenance / incident / tire",GREEN,1180,500,230,90),("drv1","Jalankan trip + tracking",TERM,1690,320,210,60),("drv2","Ajukan delivered / kirim POD",PURPLE,1690,540,210,80),("fin1","Buat nota / receipt / payment",TERM,2140,240,230,60),("fin2","Kelola cashflow, refund, reports",BLUE,2140,500,230,90),("end","Semua modul sinkron ke ledger, audit, dan laporan",TERM,1160,1070,320,70)]
    for n in nodes: v(r, *n)
    for x in [("e1","o1","ops1","brief operasional"),("e2","ops1","arm1","butuh resource"),("e3","arm1","ops2","resource siap"),("e4","ops2","drv1","DO terbit"),("e5","drv1","drv2",""),("e6","drv2","fin1","DO delivered"),("e7","fin1","fin2","uang masuk / keluar"),("e8","ops2","ops3","bila perlu bon"),("e9","ops3","fin2","mutasi uang"),("e10","arm2","fin2","expense terkait"),("e11","o2","fin2","monitor & policy"),("e12","fin2","end","")]: e(r, *x)

def add_page_9(root):
    r = diagram(root, "guard-lock-flow", "09 Guard and Lock Flow", 2500, 1400)
    v(r, "t9", "FLOWCHART GUARD DAN LOCK UTAMA", TITLE, 40, 20, 560, 30)
    v(r, "n9", "Bukan semua error message, tapi guard besar yang paling memengaruhi alur edit / delete / settlement / refund.", NOTE, 40, 55, 980, 20)
    v(r, "panel1", "ORDER / RESI", PANEL, 40, 110, 560, 1180)
    v(r, "panel2", "SURAT JALAN", PANEL, 640, 110, 560, 1180)
    v(r, "panel3", "VOUCHER & CLAIM", PANEL, 1240, 110, 560, 1180)
    v(r, "panel4", "REFUND & REKENING", PANEL, 1840, 110, 560, 1180)
    nodes = [("a1","Edit order?",TERM,100,200,140,60),("a2","Sudah ada DO / progress / hold blocker?",DEC,320,165,180,130),("a3","Buka edit penuh",GREEN,100,380,180,80),("a4","Batasi ke revisi target / hold",ORANGE,300,380,200,80),("b1","Edit DO?",TERM,700,200,140,60),("b2","Sudah ada voucher / finance link?",DEC,900,165,180,130),("b3","Buka edit field aman",GREEN,700,380,180,80),("b4","Kunci field finance",RED,900,380,180,80),("c1","Ubah voucher / claim?",TERM,1300,200,170,60),("c2","Sudah settled / refunded / locked?",DEC,1540,165,180,130),("c3","Lanjut aksi voucher / klaim",GREEN,1300,380,210,80),("c4","Blok aksi voucher / klaim",RED,1540,380,180,80),("d1","Mutasi debit dari rekening?",TERM,1900,200,190,60),("d2","Saldo cukup?",DEC,2140,165,160,130),("d3","Jalankan mutasi",GREEN,1900,380,170,80),("d4","Blok overdraft",RED,2140,380,170,80)]
    for n in nodes: v(r, *n)
    for x in [("e1","a1","a2",""),("e2","a2","a3","Belum"),("e3","a2","a4","Sudah"),("e4","b1","b2",""),("e5","b2","b3","Belum"),("e6","b2","b4","Sudah"),("e7","c1","c2",""),("e8","c2","c3","Belum"),("e9","c2","c4","Sudah"),("e10","d1","d2",""),("e11","d2","d3","Cukup"),("e12","d2","d4","Tidak")]: e(r, *x)

def add_page_10(root):
    r = diagram(root, "delete-void-deactivate", "10 Delete, Void, and Deactivate Flow", 2500, 1400)
    v(r, "t10", "FLOWCHART DELETE, VOID, DAN DEACTIVATE", TITLE, 40, 20, 720, 30)
    v(r, "n10", "Halaman ini memisahkan kapan data masih boleh dihapus, kapan harus void / nonaktif, dan kapan wajib ditolak.", NOTE, 40, 55, 980, 20)
    pages = [("p1", "ORDER / CUSTOMER", 40), ("p2", "DO / VOUCHER / CLAIM", 650), ("p3", "MASTER ARMADA / REKENING", 1260), ("p4", "BORONGAN / FINANCE", 1870)]
    for pid, title, x in pages: v(r, pid, title, PANEL, x, 110, 560, 1180)
    nodes = [("a1","Hapus customer / order?",TERM,110,220,170,60),("a2","Ada dokumen turunan / legacy ref?",DEC,320,185,180,130),("a3","Hapus data",GREEN,110,410,170,80),("a4","Tolak hapus",RED,320,410,170,80),("b1","Hapus DO / voucher / claim?",TERM,720,220,200,60),("b2","Sudah jalan / settled / refunded?",DEC,970,185,180,130),("b3","Hapus klaim aktif yang aman",ORANGE,720,410,180,80),("b4","Pakai void / cancel / lock",RED,970,410,180,80),("c1","Nonaktifkan kendaraan / rekening?",TERM,1330,220,210,60),("c2","Masih punya saldo / histori / relasi aktif?",DEC,1580,185,190,130),("c3","Nonaktifkan master",GREEN,1330,410,180,80),("c4","Tolak nonaktif",RED,1580,410,180,80),("d1","Void / delete finance doc?",TERM,1940,220,190,60),("d2","Sudah ada pembayaran / refund / ledger effect?",DEC,2180,185,190,130),("d3","Hapus dokumen yang belum berdampak",GREEN,1940,410,210,80),("d4","Pakai void / block",RED,2180,410,170,80)]
    for n in nodes: v(r, *n)
    for x in [("e1","a1","a2",""),("e2","a2","a3","Tidak"),("e3","a2","a4","Ada"),("e4","b1","b2",""),("e5","b2","b3","Belum"),("e6","b2","b4","Sudah"),("e7","c1","c2",""),("e8","c2","c3","Tidak"),("e9","c2","c4","Ada"),("e10","d1","d2",""),("e11","d2","d3","Belum"),("e12","d2","d4","Sudah")]: e(r, *x)

def add_page_11(root):
    r = diagram(root, "role-access-decisions", "11 Role Access Decision Flow", 2500, 1400)
    v(r, "t11", "FLOWCHART KEPUTUSAN AKSES ROLE", TITLE, 40, 20, 640, 30)
    v(r, "n11", "Menjelaskan kenapa beberapa link tampil clickable untuk satu role, tapi hanya teks biasa atau redirect untuk role lain.", NOTE, 40, 55, 1040, 20)
    nodes = [("s","User buka halaman / detail",TERM,70,240,180,60),("d1","Role punya izin halaman?",DEC,320,205,180,130),("p1","Redirect / block query sensitif",RED,580,230,220,80),("p2","Buka halaman",GREEN,880,230,180,80),("d2","Role punya izin dokumen relasi?",DEC,1130,205,190,130),("p3","Render hyperlink aktif",BLUE,1400,170,190,80),("p4","Render teks / summary aman",GREY,1400,290,210,80),("d3","Data finance sensitif?",DEC,1700,205,180,130),("p5","Render nominal penuh",GREEN,1950,170,180,80),("p6","Sembunyikan nominal sensitif",YELLOW,1950,290,220,80),("end","UI tetap nyambung tanpa bocor akses",TERM,2240,235,190,70)]
    for n in nodes: v(r, *n)
    for x in [("e1","s","d1",""),("e2","d1","p1","Tidak"),("e3","d1","p2","Ya"),("e4","p2","d2",""),("e5","d2","p3","Punya"),("e6","d2","p4","Tidak"),("e7","p3","d3",""),("e8","p4","d3",""),("e9","d3","p5","Boleh"),("e10","d3","p6","Sensitif"),("e11","p1","end",""),("e12","p5","end",""),("e13","p6","end","")]: e(r, *x)

def add_page_12(root):
    r = diagram(root, "master-dependency-flow", "12 Master Dependency Appendix", 1900, 1900)
    v(r, "t12", "APPENDIX FLOW DEPENDENCY MASTER DAN MODUL", TITLE, 40, 20, 860, 30)
    v(r, "n12", "Halaman appendix ini tetap bersifat referensi, tetapi saya ubah jadi flow dependency agar lebih konsisten dengan halaman flowchart lain.", NOTE, 40, 55, 1160, 20)
    nodes = [
        ("s","Mulai dari kebutuhan modul operasional",TERM,810,120,280,60),
        ("ref1","Master global yang menopang banyak modul:&#xa;Company / branding&#xa;Rekening / kas&#xa;User policy / akses",REF,100,180,290,150),
        ("p1","Lengkapi customer, pickup / recipient, dan produk customer",BLUE,760,300,380,90),
        ("p2","Order / Resi siap dipakai",RED + "fontStyle=1;",820,430,260,80),
        ("p3","Lengkapi driver, kendaraan, dan tarif rute trip",GREEN,775,560,350,90),
        ("p4","DO / Surat Jalan siap dipakai",RED + "fontStyle=1;",820,695,260,80),
        ("d1","Modul turunan mana yang perlu berjalan?",DEC,815,835,270,150),
        ("p5","Voucher / Borongan",ORANGE,470,1045,220,80),
        ("p6","Nota / Receipt / Refund",BLUE + "fontStyle=1;",805,1045,290,80),
        ("p7","Expense / Maintenance / Incident / Tire",GREEN,1200,1040,320,90),
        ("p8","Ledger / Reports / Audit membaca semua mutasi dan dependency master",PURPLE + "fontStyle=1;",770,1265,360,100),
        ("end","Semua surface admin dan driver membaca dependency ini",TERM,810,1450,280,70),
    ]
    for n in nodes:
        v(r, *n)
    for x in [
        ("e1","s","p1",""),
        ("e2","p1","p2",""),
        ("e3","p2","p3",""),
        ("e4","p3","p4",""),
        ("e5","p4","d1",""),
        ("e6","d1","p5","Trip"),
        ("e7","d1","p6","Finance"),
        ("e8","d1","p7","Fleet"),
        ("e9","p5","p8",""),
        ("e10","p6","p8",""),
        ("e11","p7","p8",""),
        ("e12","p8","end",""),
    ]:
        e(r, *x)

def build():
    root = mxfile()
    for fn in [add_page_0, add_page_1, add_page_2, add_page_3, add_page_4, add_page_5, add_page_6, add_page_7, add_page_8, add_page_9, add_page_10, add_page_11, add_page_12]:
        fn(root)
    tree = ET.ElementTree(root)
    ET.indent(tree, space="  ")
    tree.write(OUT, encoding="utf-8", xml_declaration=False)
    xml = OUT.read_text(encoding="utf-8")
    xml = xml.replace("&amp;#xa;", "&#xa;").replace("&amp;gt;", "&gt;").replace("&amp;lt;", "&lt;")
    OUT.write_text(xml, encoding="utf-8")

if __name__ == "__main__":
    build()
