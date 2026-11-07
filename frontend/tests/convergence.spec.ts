import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resetSyntheticRateLimits} from './target';
const api=process.env.TARJETAS_BROWSER_API_ORIGIN??'https://api.tarjetas-browser.test';
const cwd=fileURLToPath(new URL('../../backend/',import.meta.url));
const original=readFileSync('../docs/rebuild/fixtures/pdf/synthetic_visa_2026_02.pdf');
// Equal-length printed-text substitutions preserve PDF offsets and frozen originals.
const statement=Buffer.from(original.toString('latin1').replaceAll('SYNTHETIC SHOP','COTO QA STORE ').replaceAll('(100,00)','(130,00)'),'latin1');
const receipt=readFileSync('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf');
const competitor=Buffer.from(receipt.toString('latin1').replaceAll('9999-00000001','9999-00000003'),'latin1');
test.beforeEach(resetSyntheticRateLimits);
async function login(page:Page,email:string){await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('Synthetic-Acceptance-Only-2026!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Private ledger',exact:true})).toBeVisible();}
async function importStatement(page:Page,name='synthetic_coto_visa_2026_02.pdf'){
 await page.goto('/upload');await page.getByLabel('Actual card',{exact:true}).selectOption('synthetic-visa-a');await page.getByLabel('Statement PDF (max. 10 MiB)',{exact:true}).setInputFiles({name,mimeType:'application/pdf',buffer:statement});
 const posted=page.waitForResponse(r=>r.url()===api+'/api/v1/statements'&&r.request().method()==='POST');await page.getByRole('button',{name:'Import statement',exact:true}).click();const response=await posted;expect(response.status(),await response.text()).toBe(200);return response.json();
}
async function importReceipt(page:Page,buffer=receipt){
 await page.goto('/receipts');await page.getByLabel('Coto receipt PDF (max. 40 MiB)',{exact:true}).setInputFiles({name:'synthetic_coto.pdf',mimeType:'application/pdf',buffer});
 const posted=page.waitForResponse(r=>r.url()===api+'/api/v1/receipts'&&r.request().method()==='POST');await page.getByRole('button',{name:'Import receipt',exact:true}).click();const response=await posted;expect(response.status(),await response.text()).toBe(200);return response.json();
}
async function fund(page:Page){
 await page.getByLabel('Actual card',{exact:true}).selectOption('synthetic-visa-a');await page.getByLabel('I verified that this receipt').check();
 const posted=page.waitForResponse(r=>r.url().endsWith('/reconciliation')&&r.request().method()==='POST');await page.getByRole('button',{name:'Record supported purchase',exact:true}).click();const response=await posted;expect(response.status(),await response.text()).toBe(200);return response.json();
}
async function inspect(page:Page){return page.evaluate(async api=>{const get=async(path:string)=>{const r=await fetch(api+'/api/v1/'+path,{credentials:'include',headers:{Accept:'application/json'}});if(!r.ok)throw new Error(path+':'+r.status);return r.json();};return {accounting:await get('accounting'),review:await get('merchant-review'),matching:await get('receipt-charges')};},api);}
for(const order of ['receipt-first','statement-first'])test(`${order} actual PDFs converge for two owners with replay, allocations, unlink history and competing receipt protection`,async({page})=>{
 test.setTimeout(180000);expect(statement.length).toBe(original.length);expect(statement.equals(original)).toBe(false);expect(competitor.length).toBe(receipt.length);
 const users=JSON.parse(execFileSync('php',['artisan','tarjetas:acceptance:document-users','--env=browser-testing'],{cwd,encoding:'utf8'}));let foreignReceipt='';
 for(const owner of ['a','b']){
  await login(page,users[owner]);if(foreignReceipt){await page.goto(foreignReceipt);await expect(page.getByRole('alert')).toHaveText('Receipt not found.');}
  if(order==='statement-first')await importStatement(page);
  const imported=await importReceipt(page);await page.getByRole('link',{name:'Open retained receipt',exact:true}).click();const receiptUrl=page.url();await fund(page);
  const items=page.locator('.receipt-item');await expect(items).toHaveCount(2);
  for(let i=0;i<2;i++){
   const item=items.nth(i);await item.locator('summary').click();await item.getByRole('button',{name:'Confirm canonical product',exact:true}).click();await expect(item.getByRole('button',{name:"Confirm this item's product",exact:true})).toBeEnabled();await item.getByRole('button',{name:"Confirm this item's product",exact:true}).click();await expect(item.getByRole('button',{name:'Item confirmed',exact:true})).toBeDisabled();
  }
  await items.nth(0).getByLabel('Account',{exact:true}).selectOption('expense:food:groceries:pantry');let allocation=page.waitForResponse(r=>r.url().endsWith('/reconciliation')&&r.request().method()==='POST');await page.getByRole('button',{name:'Apply reviewed item allocations',exact:true}).click();expect((await allocation).status()).toBe(200);
  let state=await inspect(page);expect(state.accounting.accounts.find((a:any)=>a.id==='expense:food:groceries:pantry').balances.ARS).toBe('8000');expect(state.accounting.accounts.find((a:any)=>a.id==='expense:unallocated').balances.ARS).toBe('5000');
  await expect(items.nth(1).getByLabel('Account',{exact:true})).toBeEnabled();await items.nth(1).getByLabel('Account',{exact:true}).selectOption('expense:personal:hygiene');allocation=page.waitForResponse(r=>r.url().endsWith('/reconciliation')&&r.request().method()==='POST');await page.getByRole('button',{name:'Apply reviewed item allocations',exact:true}).click();expect((await allocation).status()).toBe(200);
  if(order==='receipt-first')await importStatement(page);
  state=await inspect(page);const ars=state.review.purchases.filter((p:any)=>p.purchase.currency==='ARS');expect(ars).toHaveLength(1);const purchase=ars[0];expect(purchase.purchase.principalMinor).toBe(13000);const purchaseId=purchase.id;
  expect(purchase.purchase.allocations.map((a:any)=>[a.accountId,a.minor])).toEqual([['expense:food:groceries:pantry',8000],['expense:personal:hygiene',5000]]);
  const balance=(id:string)=>state.accounting.accounts.find((a:any)=>a.id===id).balances.ARS;expect(balance('synthetic-visa-a:ARS:billed')).toBe('13000');expect(balance('synthetic-visa-a:ARS:unbilled')).toBe('0');expect(balance('expense:food:groceries:pantry')).toBe('8000');expect(balance('expense:personal:hygiene')).toBe('5000');
  expect(state.matching.charges).toHaveLength(1);expect(state.matching.financialLinks.find((l:any)=>l.receiptId===imported.receiptId).purchaseId).toBe(purchaseId);
  const journals=state.accounting.meta.total;const replay=await importStatement(page,'renamed_synthetic_coto_2026_02.pdf');expect(replay.duplicate).toBe(true);expect(replay.postedJournalIds).toEqual([]);expect((await importReceipt(page)).duplicate).toBe(true);
  const other=await importReceipt(page,competitor);await page.getByRole('link',{name:'Open retained receipt',exact:true}).click();const conflict=await fund(page);expect(conflict.reviews.some((r:any)=>r.code==='purchase_already_linked')).toBe(true);
  state=await inspect(page);expect(state.accounting.meta.total).toBe(journals);expect(state.review.purchases.filter((p:any)=>p.purchase.currency==='ARS')).toHaveLength(1);expect(state.matching.financialLinks.some((l:any)=>l.receiptId===other.receiptId)).toBe(false);expect(state.matching.financialLinks.find((l:any)=>l.receiptId===imported.receiptId).purchaseId).toBe(purchaseId);
  await page.goto(receiptUrl);const unlink=page.waitForResponse(r=>r.url().endsWith('/unlink')&&r.request().method()==='POST');await page.getByRole('button',{name:'Unlink evidence',exact:true}).click();expect((await unlink).status()).toBe(200);await expect(page.getByText('Current link: Unlinked',{exact:true})).toBeVisible();await fund(page);
  state=await inspect(page);expect(state.accounting.meta.total).toBe(journals);expect(state.matching.financialLinks.find((l:any)=>l.receiptId===imported.receiptId).purchaseId).toBe(purchaseId);
  await page.goto('/super/charges');const linked=page.locator('article.receipt-item').filter({has:page.locator(`a[href="/receipts/${imported.receiptId}"]`)});await expect(linked).toContainText('Financial link');await linked.locator('summary').click();await expect(linked).toContainText('Financial · Unlinked');await expect(linked).toContainText('Financial · Linked');await expect(page.getByText('Receipt linked',{exact:true})).toBeVisible();await page.screenshot({path:`../qa-output/qa-gaps-20261107/convergence-${order}-${owner}.png`,fullPage:true});
  foreignReceipt=receiptUrl;await page.goto('/');await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
 }
});
