import { parseRows } from "@/lib/receipts/parse";
import { parseRowsText } from "@/lib/receipts/rows";
import { verify } from "@/lib/receipts/verify";
import type { ReceiptExtraction } from "./receipt-import";
const amount=(minor:number)=>`${Math.floor(Math.abs(minor)/100)},${String(Math.abs(minor)%100).padStart(2,"0")}`;
export function receiptExtraction(options:{totalCents?:number;fiscalNumber?:string;itemNetAmounts?:number[];paymentCents?:number}={}):ReceiptExtraction {
  const nets=options.itemNetAmounts??[8000],gross=options.itemNetAmounts?nets.reduce((s,n)=>s+n,0):10000,discount=options.itemNetAmounts?0:-2000,total=options.totalCents??nets.reduce((s,n)=>s+n,0);
  const rowsText=`## page 1
COTO
SUC 90 SYNTHETIC STORE
CUIT:30-54808315-6
15/01/2026 09:42:15 NRO.T.:${options.fiscalNumber??"0001-00000001"}
NRO.CAJA:0012 NRO.TERM:3791 NRO.TRAN:5001
FACTURA B
${nets.map((net,i)=>`SYNTHETIC ITEM ${i+1}\n${String(i+1).padStart(10,"0")} 07798140550143\t${amount(options.itemNetAmounts?net:gross)}${!options.itemNetAmounts?"\n1 *SYNTHETIC OFFER [M]\\t-20,00".replace("\\t","\t"):""}`).join("\n")}
SUBTOT. SIN DESCUENTOS\t${amount(gross)}
DESCUENTOS POR PROMOCIONES\t${discount<0?"-":""}${amount(discount)}
TOTAL\t${amount(total)}
MERCADO PAG 123456789\t${amount(options.paymentCents??total)}
SU VUELTO\t0,00
C.A.E.Nro.:86361418114641 Vto.:20260914
`;
  const parsed=parseRows(parseRowsText(rowsText));return {parsed,rowsText,report:verify(parsed),scale:3};
}
