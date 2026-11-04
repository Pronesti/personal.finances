import { createElement } from "react";
import { renderToPipeableStream } from "react-dom/server";
import { PassThrough } from "node:stream";
import { I18nProvider } from "@/components/I18nProvider";
import { beforeEach,expect,it,vi } from "vitest";
import { translator } from "@/lib/i18n";
import { createMemoryLedger } from "./memory";
import { createMemoryReader } from "./read-model";
import { createMemoryDocuments } from "./documents";
import { baseCatalog,cardAccounts } from "./catalog";
import { importReceipt } from "./receipt-import";
import { receiptExtraction } from "./receipt-test-support";
import type { AccountingContext } from "@/lib/backend";
const state=vi.hoisted(()=>({locale:"en" as "en"|"es",context:null as unknown as AccountingContext,sqlite:vi.fn()}));
vi.mock("@/lib/backend",()=>({selectedBackend:()=>"postgres",withAccounting:async<T>(work:(context:AccountingContext)=>Promise<T>)=>work(state.context)}));
vi.mock("@/components/accounting-gate",()=>({postgresPageGate:async()=>null}));
vi.mock("@/lib/params",async original=>({...await original<object>(),valueOpts:(modes:{spend:"cash"|"accrual";value:"real"|"nominal"|"usd";tax:"excl"|"incl"})=>({...modes,cpi:{"2026-01":100},mep:{"2026-01":1000}})}));
vi.mock("@/lib/locale",()=>({getT:async()=>translator(state.locale),getLocale:async()=>state.locale}));
vi.mock("@/lib/db",async original=>({...await original<object>(),getDb:state.sqlite}));
import Receipts from "@/app/receipts/page";
import Receipt from "@/app/receipts/[id]/page";
import Super from "@/app/super/page";
import Products from "@/app/super/products/page";
import Categories from "@/app/super/categories/page";
import Charges from "@/app/super/charges/page";
import ProductReview from "@/app/super/review/page";
import Upload from "@/app/upload/page";
import Review from "@/app/review/page";
import { AccountingMerchantReview } from "@/app/review/accounting-review";
beforeEach(async()=>{
 state.locale="en";vi.clearAllMocks();state.sqlite.mockImplementation(()=>{throw new Error("SQLITE_BOUNDARY_VIOLATION");});
 const accounts=[...baseCatalog(),...cardAccounts("card-a","Actual configured card")],ledger=Object.assign(createMemoryLedger({accounts,cardIds:["card-a"]}),{close:async()=>{}}),documents=createMemoryDocuments();
 await importReceipt(ledger,documents,{key:"fixture",bytes:Buffer.from("%PDF-page-fixture"),extraction:receiptExtraction(),correctedRowsText:null,recordedAt:"2026-01-16T12:00:00Z",appRevision:"synthetic:test"});
 state.context={ledger,documents,documentRoot:"/unused",appRevision:"synthetic:test",reader:createMemoryReader({receipts:[{id:1,date:"2026-01-15",time:"09:42:15",subtotalCents:10000,discountsCents:-2000,totalCents:8000}],inspection:{journals:[],accounts,cards:[{id:"card-a",displayName:"Actual configured card"}]}})};
});
it("uses the PostgreSQL receipt identity for list/detail/reconciliation/product-review pages without opening SQLite",async()=>{
 expect(await Receipts()).toBeTruthy();expect(await Receipt({params:Promise.resolve({id:"1"})})).toBeTruthy();expect(await Charges()).toBeTruthy();expect(await ProductReview()).toBeTruthy();expect(state.sqlite).not.toHaveBeenCalled();
});
it("keeps all supermarket analytic views on one reader backend",async()=>{
 const params={searchParams:Promise.resolve({value:"nominal"})};expect(await Super(params)).toBeTruthy();expect(await Products(params)).toBeTruthy();expect(await Categories(params)).toBeTruthy();expect(state.sqlite).not.toHaveBeenCalled();
});
it("uses PostgreSQL sources, configured cards and explicit account-review scopes for upload/review pages",async()=>{
 expect(await Upload()).toBeTruthy();expect(await Review({searchParams:Promise.resolve({})})).toBeTruthy();expect(await AccountingMerchantReview({searchParams:{}})).toBeTruthy();expect(state.sqlite).not.toHaveBeenCalled();
});

async function render(element: Parameters<typeof renderToPipeableStream>[0]): Promise<string> {
 return new Promise((resolve,reject)=>{const output=new PassThrough();let html="";output.on("data",chunk=>html+=chunk.toString());output.on("end",()=>resolve(html));const stream=renderToPipeableStream(element,{onAllReady(){stream.pipe(output);},onError:reject});});
}
it("renders actual receipt detail controls, exact source cents and transcript in both languages",async()=>{
 for(const locale of ["en","es"] as const){state.locale=locale;const content=await Receipt({params:Promise.resolve({id:"1"})});const html=await render(createElement(I18nProvider,{locale,children:content}));
 expect(html).toContain("SYNTHETIC ITEM 1");expect(html).toContain("80,00");expect(html).toContain("20,00");expect(html).toContain("Actual configured card");expect(html).toContain("account:");expect(html).not.toContain("accounting.receipts.");expect(state.sqlite).not.toHaveBeenCalled();
 }
});
it("keeps reviewed products maintainable and exposes article-code moves in both languages",async()=>{
 await state.context.ledger.transaction(async tx=>{
  const products=await tx.reviewSubjects("product");for(const product of products)if(product.kind==="product")await tx.appendReviewSubject({...product,reviewed:true,name:"Known canonical product"});
  await tx.appendReviewSubject({kind:"product",id:await tx.nextProductId(),name:"Other canonical identity",category:"other",unit:"un",reviewed:true,redirectId:null});
 });
 for(const locale of ["en","es"] as const){state.locale=locale;const html=await render(createElement(I18nProvider,{locale,children:await ProductReview()}));expect(html).toContain("Known canonical product");expect(html).toContain("Other canonical identity");expect(html).toContain("0000000001");expect(html).toContain(locale==="en"?"Move article code":"Mover código de artículo");expect(html).toContain('name="sku"');expect(html).not.toContain("accounting.receipts.");}
 expect(state.sqlite).not.toHaveBeenCalled();
});
it("offers explicit future-only acceptance for a retained proposal without a posted purchase association",async()=>{
 await state.context.ledger.transaction(async tx=>{
  await tx.appendReviewSubject({kind:"merchant",id:"historical-merchant",normalizedName:"HISTORICAL SHOP",redirectId:null});
  await tx.appendReviewSubject({kind:"proposal",id:"retained-proposal",merchantId:"historical-merchant",sanitizedMerchant:"HISTORICAL SHOP",state:"pending",evidence:{sent:"HISTORICAL SHOP",confidence:"high",legacyCategory:"food"}});
 });
 for(const locale of ["en","es"] as const){state.locale=locale;const html=await render(createElement(I18nProvider,{locale,children:await AccountingMerchantReview({searchParams:{}})}));expect(html).toContain('name="scope" value="future_rule"');expect(html).toContain('name="accountId"');expect(html).toContain('value="retained-proposal"');expect(html).not.toContain('name="purchaseId"');expect(html).toContain(locale==="en"?"Future matching purchases":"Compras futuras coincidentes");expect(html).not.toContain("accounting.receipts.");}
});
