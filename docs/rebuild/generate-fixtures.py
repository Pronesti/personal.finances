#!/usr/bin/env python3
"""Generate deterministic, wholly invented PDFs and parser inputs. No app data access."""
from pathlib import Path
import json
from reportlab.pdfgen.canvas import Canvas

ROOT = Path(__file__).resolve().parent / "fixtures"
PDF = ROOT / "pdf"


def save(name, value):
    target = ROOT / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def canvas(name, width=720, height=900):
    PDF.mkdir(parents=True, exist_ok=True)
    c = Canvas(str(PDF / name), pagesize=(width, height), invariant=1, pageCompression=0)
    c.setTitle("SYNTHETIC TEST DOCUMENT - NOT VALID FOR PAYMENT")
    c.setAuthor("Tarjetas synthetic acceptance fixtures")
    c.setFont("Helvetica", 10)
    return c


def line(c, y, text, x=30):
    c.drawString(x, y, text)


def bbva(brand):
    name = f"synthetic_{brand}_2026_02.pdf"
    c = canvas(name)
    for y, text in [(870, "SYNTHETIC TEST DOCUMENT - NO REAL ACCOUNT"),
                    (845, "Tarjetas de Credito"), (825, f"{brand.title()} Gold cuenta 99000001"),
                    (805, "OCASA"), (785, "SYNTHETIC PERSON")]:
        line(c, y, text)
    headers = ["CIERRE ACTUAL", "VENCIMIENTO ACTUAL", "SALDO ACTUAL $", "SALDO ACTUAL U$S", "PAGO MINIMO $"]
    xs = [30, 165, 325, 460, 595]
    c.setFont("Helvetica", 8)
    for x, h, v in zip(xs, headers, ["01-feb-26", "10-feb-26", "100,00", "5,00", "10,00"]):
        line(c, 750, h, x); line(c, 730, v, x)
    for x, h in zip([30, 200, 390, 590], ["DE COMPRA", "DE FINANCIACION", "DE ADELANTO", "CUOTAS"]):
        line(c, 700, h, x); line(c, 680, "10.000,00", x)
    for x, h, v in zip([30, 200, 390, 590],
                       ["CIERRE ANTERIOR", "VENCIMIENTO ANTERIOR", "PROXIMO CIERRE", "PROXIMO VENCIMIENTO"],
                       ["01-ene-26", "10-ene-26", "01-mar-26", "10-mar-26"]):
        line(c, 650, h, x); line(c, 630, v, x)
    for x, h, v in zip([30, 200, 390, 590], ["TNA $", "TNA U$S", "TEM $", "TEM U$S"], ["60,00", "10,00", "5,00", "1,00"]):
        line(c, 600, h, x); line(c, 580, v, x)
    c.setFont("Helvetica", 10)
    line(c, 550, "Pesos", 530); line(c, 550, "Dolares", 640)
    for y, text, ars, usd in [(530, "SALDO ANTERIOR", "0,00", "0,00"), (510, "SALDO ACTUAL", "100,00", "5,00")]:
        line(c, y, text); c.drawRightString(558, y, ars); c.drawRightString(675, y, usd)
    line(c, 480, "TOTAL DE CUOTAS A VENCER")
    line(c, 460, "MARZO/26", 30); line(c, 460, "ABRIL/26", 200)
    line(c, 440, "30,00", 30); line(c, 440, "20,00", 200)
    c.showPage(); c.setFont("Helvetica", 10)
    line(c, 870, "Consumos SYNTHETIC PERSON")
    for x, h in [(30, "FECHA"), (125, "DESCRIPCION"), (445, "NRO."), (482, "CUPON"), (550, "PESOS"), (640, "DOLARES")]:
        line(c, 845, h, x)
    for y, date, desc, voucher, ars, usd in [
        (820, "15-ene-26", "SYNTHETIC SHOP", "990001", "100,00", None),
        (795, "16-ene-26", "SYNTHETIC USD SHOP", "990002", None, "5,00")]:
        line(c, y, date); line(c, y, desc, 125); line(c, y, voucher, 445)
        if ars: c.drawRightString(585, y, ars)
        if usd: c.drawRightString(685, y, usd)
    line(c, 770, "TOTAL CONSUMOS DE SYNTHETIC PERSON")
    c.drawRightString(585, 770, "100,00"); c.drawRightString(685, 770, "5,00")
    line(c, 745, "SALDO ACTUAL"); c.drawRightString(585, 745, "100,00"); c.drawRightString(685, 745, "5,00")
    line(c, 720, "Legales y avisos"); c.save()


def mercadopago():
    c = canvas("synthetic_mercadopago_2026_02.pdf")
    for y, text in [(870,"SYNTHETIC TEST DOCUMENT - NO REAL ACCOUNT"), (840,"Este es tu resumen"),
                    (810,"El minimo a pagar es$ 1000"), (780,"Consolidado"),
                    (755,"Saldo del periodo anterior $ 0,00"), (730,"Consumos $ 140,00 US$ 0,00"),
                    (705,"Impuestos e intereses $ 0,00"), (680,"Total a pagar $ 140,00 US$ 0,00")]:
        line(c,y,text)
    c.showPage(); c.setFont("Helvetica",10)
    for y,text in [(870,"DETALLE DE MOVIMIENTOS"),(840,"Consumos"),
                   (810,"15/ene SYNTHETIC SHOP 990001 $ 100,00 US$ 0,00"),
                   (780,"16/ene SYNTHETIC PLAN 1 de 3 990003 $ 40,00 US$ 0,00")]:
        line(c,y,text)
    c.showPage();c.setFont("Helvetica",10)
    for y,text in [(870,"INFORMACION ADICIONAL"),(840,"Ciclo de facturacion"),
                   (810,"Cierre actual 1 de febrero"),(780,"Vencimiento actual 10 de febrero"),
                   (750,"Cierre anterior 1 de enero"),(720,"Limite $ 0,00 de $ 10.000,00"),
                   (690,"financiacion del resumen actual"),(660,"TNA 60,00% TEA 100,00%")]:
        line(c,y,text)
    line(c,620,"Este resumen pertenece a SYNTHETIC PERSON, CUIT 00-00000000-0")
    c.save()


def receipt():
    rows = """## page 1
COTO
SUC 999 SYNTHETIC STORE
CUIT:00-00000000-0
15/01/2026 09:00:00 NRO.T.:9999-00000001
NRO.CAJA:0001 NRO.TERM:0001 NRO.TRAN:0001
FACTURA B
SYNTHETIC RICE PAQ 1 KG
0000000001 00000000000000	100,00
1 *SYNTHETIC OFFER [M]	-20,00
SYNTHETIC SOAP
0000000002 00000000000000	50,00
SUBTOT. SIN DESCUENTOS	150,00
DESCUENTOS POR PROMOCIONES	-20,00
TOTAL	130,00
MERCADO PAG 990000000001	130,00
SU VUELTO	0,00
C.A.E.Nro.:00000000000000 Vto.:20260201
"""
    ROOT.mkdir(exist_ok=True,parents=True)
    (ROOT/"receipt-valid.rows.txt").write_text(rows)
    # Deliberate simulated OCR error, not a claim that Vision always makes this mistake.
    (ROOT/"receipt-one-cent-error.rows.txt").write_text(rows.replace("TOTAL\t130,00", "TOTAL\t130,01"))
    (ROOT/"receipt-corrected.rows.txt").write_text(rows)
    c=canvas("synthetic_coto.pdf",width=400,height=850)
    c.setFont("Helvetica",10)
    for i,text in enumerate(rows.splitlines()[1:]):
        if "\t" in text:
            label,amount=text.split("\t");line(c,810-i*28,label,15);c.drawRightString(385,810-i*28,amount)
        else:line(c,810-i*28,text,15)
    line(c,55,"SYNTHETIC FIXTURE - NOT A FISCAL DOCUMENT",15);c.save()


if __name__ == "__main__":
    bbva("visa");bbva("mastercard");mercadopago();receipt()
    c=canvas("unsupported-layout.pdf");line(c,850,"SYNTHETIC UNSUPPORTED DOCUMENT");c.save()
    save("references.json",{"cpi":{"2026-01":100,"2026-02":110,"2026-03":121},"mep":{"2026-01":1000,"2026-02":1100,"2026-03":1210}})
    save("cards.json",[{"id":"synthetic-visa-a","displayName":"Synthetic Visa A","brand":"visa"},
                        {"id":"synthetic-visa-b","displayName":"Synthetic Visa B","brand":"visa"},
                        {"id":"synthetic-mp","displayName":"Synthetic Mercado Pago","brand":"mercadopago"},
                        {"id":"synthetic-mastercard","displayName":"Synthetic Mastercard","brand":"mastercard"}])
    print("Created 5 deterministic synthetic PDFs, 3 receipt transcripts, cards, and reference tables.")
