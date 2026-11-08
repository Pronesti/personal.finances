import { test, expect, type Page } from '@playwright/test';
import { resetSyntheticRateLimits } from './target';
test.beforeEach(resetSyntheticRateLimits);
import { readFileSync } from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
let users:Record<string,string>;
test.beforeAll(()=>{users=JSON.parse(execFileSync('php',['artisan','tarjetas:acceptance:receipt-rejection','--fresh','--env=browser-testing'],{cwd:fileURLToPath(new URL('../../backend/',import.meta.url)),encoding:'utf8'}));});
const api = process.env.TARJETAS_BROWSER_API_ORIGIN ?? 'https://api.tarjetas-browser.test';
async function login(page: Page, who: string) {
  await page.goto('/login'); await page.getByLabel('Email',{exact:true}).fill(users[who]); await page.getByLabel('Password',{exact:true}).fill('Synthetic-Acceptance-Only-2026!'); await page.getByRole('button',{name:'Sign in',exact:true}).click(); await expect(page.getByRole('heading',{name:'Private ledger',exact:true})).toBeVisible(); const menu=page.getByRole('button',{name:'Explore sections',exact:true});if(await menu.isVisible())await menu.click();const group=page.getByRole('navigation',{name:'Sections'}).getByRole('button',{name:'Supermarket',exact:true});if(await group.getAttribute('aria-expanded')!=='true')await group.click();
}
test('actual Vision upload, item review, partial/full allocation and duplicate bytes',async({page})=>{
  test.setTimeout(120_000);
  await login(page,'a'); await page.getByRole('link',{name:'Receipts',exact:true}).first().click();
  await page.getByLabel('Coto receipt PDF').setInputFiles('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf');
  const upload=page.waitForResponse(response=>response.url()===`${api}/api/v1/receipts`&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Import receipt',exact:true}).click();
  const result=await upload; expect(result.status(),await result.text()).toBe(200); const body=await result.json();
  await page.getByRole('link',{name:'Open retained receipt',exact:true}).click(); await expect(page.getByRole('heading',{name:'Receipt detail',exact:true})).toBeVisible();
  await page.getByLabel('Actual card',{exact:true}).selectOption('synthetic-visa-a'); await page.getByLabel('I verified that this receipt').check();
  await page.getByRole('button',{name:'Record supported purchase',exact:true}).click(); await expect(page.getByRole('status').filter({hasText:'Change recorded.'})).toBeVisible();
  const items=page.locator('.receipt-item');
  for(let i=0;i<2;i++) {
    const item=items.nth(i); await item.locator('summary').click(); await item.getByRole('button',{name:'Confirm canonical product',exact:true}).click(); await expect(page.getByRole('status').filter({hasText:'Change recorded.'})).toBeVisible();
    await item.getByRole('button',{name:"Confirm this item's product",exact:true}).click(); await expect(item.getByRole('button',{name:'Item confirmed',exact:true})).toBeDisabled();
  }
  await items.nth(0).getByLabel('Account',{exact:true}).selectOption('expense:food:groceries:pantry'); await page.getByRole('button',{name:'Apply reviewed item allocations',exact:true}).click(); await expect(page.getByRole('status').filter({hasText:'Change recorded.'})).toBeVisible();
  await items.nth(1).getByLabel('Account',{exact:true}).selectOption('expense:personal:hygiene'); await page.getByRole('button',{name:'Apply reviewed item allocations',exact:true}).click(); await expect(page.getByRole('status').filter({hasText:'Change recorded.'})).toBeVisible();
  await page.reload(); await expect(items).toHaveCount(2); await expect(items.nth(0).getByLabel('Account',{exact:true})).toHaveValue('expense:food:groceries:pantry'); await expect(items.nth(1).getByLabel('Account',{exact:true})).toHaveValue('expense:personal:hygiene');
  await page.getByRole('link',{name:'Receipts',exact:true}).first().click(); await page.getByLabel('Coto receipt PDF').setInputFiles('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf'); const replay=page.waitForResponse(response=>response.url()===`${api}/api/v1/receipts`&&response.request().method()==='POST'); await page.getByRole('button',{name:'Import receipt',exact:true}).click(); const duplicate=await(await replay).json(); expect(duplicate.duplicate).toBe(true); expect(duplicate.receiptId).toBe(body.receiptId);
});
test('retained one-cent rejection, correction history and foreign receipt access',async({page})=>{
  test.setTimeout(120000);
  await login(page,'b'); await page.getByRole('link',{name:'Receipts',exact:true}).first().click(); await page.getByRole('link',{name:'2026-01-15',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'Receipt detail',exact:true})).toBeVisible(); const receiptUrl=page.url();
  await page.locator('summary').filter({hasText:'rejected'}).first().click(); await page.getByRole('button',{name:'Original OCR transcript',exact:true}).first().click(); await expect(page.getByLabel('Editable transcript')).toHaveValue(/130,01/);
  await page.getByLabel('Editable transcript').fill(readFileSync('../docs/rebuild/fixtures/receipt-corrected.rows.txt','utf8')); await page.getByRole('button',{name:'Verify correction',exact:true}).click(); await expect(page.getByRole('status').filter({hasText:/Evidence retained.|Change recorded./})).toBeVisible();
  await page.locator('summary').filter({hasText:'accepted'}).last().click(); const transcriptResponse=page.waitForResponse(r=>r.url().includes('/api/v1/documents/')&&r.request().method()==='GET'); await page.getByRole('button',{name:'Accepted corrected transcript',exact:true}).click(); const retainedRows=await(await transcriptResponse).text(); await expect(page.getByLabel('Editable transcript')).toHaveValue(retainedRows.replace(/\r\n?/g,'\n'));
  const rows=await page.getByLabel('Editable transcript').inputValue();const history=page.locator('summary').filter({hasText:/ · (accepted|rejected|pending)$/});const historyCount=await history.count();const keys:string[]=[];const payloads:string[]=[];let lost=false;
  await page.route('**/api/v1/receipts/corrections',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}keys.push(route.request().headers()['idempotency-key']);payloads.push(route.request().postDataJSON().rowsText);const headers={...route.request().headers(),'idempotency-key':'synthetic-duplicate-correction'};if(!lost){lost=true;const response=await route.fetch({headers});expect(response.status()).toBe(200);expect((await response.json()).duplicate).toBe(true);await route.abort('failed');}else{await route.continue({headers});}});
  await page.getByRole('button',{name:'Verify correction',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect.poll(async()=>(await page.getByLabel('Editable transcript').inputValue()).trimEnd()).toBe(rows.trimEnd());
  let response=page.waitForResponse(r=>r.url().endsWith('/api/v1/receipts/corrections')&&r.request().method()==='POST');await page.getByRole('button',{name:'Verify correction',exact:true}).click();const replay=await response;expect(replay.status()).toBe(200);expect((await replay.json()).duplicate).toBe(true);expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);expect(payloads[0]).toBe(payloads[1]);
  await page.getByLabel('Editable transcript').fill(rows.replace('SYNTHETIC RICE','SYNTHETIC ALTERED RICE'));response=page.waitForResponse(r=>r.url().endsWith('/api/v1/receipts/corrections')&&r.request().method()==='POST');await page.getByRole('button',{name:'Verify correction',exact:true}).click();const conflict=await response;expect(conflict.status()).toBe(409);expect((await conflict.json()).error.code).toBe('command_conflict');await expect.poll(async()=>(await page.getByLabel('Editable transcript').inputValue()).trimEnd()).toBe(rows.replace('SYNTHETIC RICE','SYNTHETIC ALTERED RICE').trimEnd());await page.reload();await expect(history).toHaveCount(historyCount);
  await page.setViewportSize({width:390,height:844}); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.goto('/'); await page.getByRole('button',{name:'Sign out',exact:true}).click(); await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible(); await login(page,'a'); await page.goto(receiptUrl); await expect(page.getByRole('alert')).toHaveText('Receipt not found.');
});

test('missing fiscal number retains correction history and the accepted receipt', async ({page}) => {
  test.setTimeout(120000);
  users=JSON.parse(execFileSync('php',['artisan','tarjetas:acceptance:receipt-rejection','--fresh','--env=browser-testing'],{cwd:fileURLToPath(new URL('../../backend/',import.meta.url)),encoding:'utf8'}));
  await login(page,'b');
  await page.getByRole('link',{name:'Receipts',exact:true}).first().click();
  await page.getByRole('link',{name:'2026-01-15',exact:true}).first().click();
  await page.locator('summary').filter({hasText:'rejected'}).first().click();
  await page.getByRole('button',{name:'Original OCR transcript',exact:true}).first().click();
  const valid=readFileSync('../docs/rebuild/fixtures/receipt-corrected.rows.txt','utf8');
  async function correct(rowsText:string, status:number) {
    await page.getByLabel('Editable transcript').fill(rowsText);
    const response=page.waitForResponse(r=>r.url().endsWith('/api/v1/receipts/corrections')&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Verify correction',exact:true}).click();
    const result=await response;
    expect(result.status(),await result.text()).toBe(status);
    return result.json();
  }
  const accepted=await correct(valid,200);
  const history=page.locator('summary').filter({hasText:/ · (accepted|rejected|pending)$/});
  await expect(history).toHaveCount(2);
  for (const [index,rowsText] of [
    valid.replace(' NRO.T.:9999-00000001',''),
    valid.replace('SYNTHETIC RICE','SYNTHETIC RICE REPAIRED'),
    valid.replace(' NRO.T.:9999-00000001','').replace('SYNTHETIC RICE','SYNTHETIC RICE RETRY'),
  ].entries()) {
    await page.reload();
    await expect(history).toHaveCount(2+index);
    await page.locator('summary').filter({hasText:/ · accepted$/}).click();
    await page.getByRole('button',{name:'Accepted corrected transcript',exact:true}).click();
    await expect.poll(async()=>(await page.getByLabel('Editable transcript').inputValue()).trimEnd()).toBe(valid.trimEnd());
    const result=await correct(rowsText,index===1?200:422);
    expect(result.receiptId).toBe(accepted.receiptId);
    if(index!==1) {
      expect(result.error.code).toBe('verification_failed');
      expect(result.report.ok).toBe(false);
      expect(result.rowsText.trimEnd()).toBe(rowsText.trimEnd());
      await expect.poll(async()=>(await page.getByLabel('Editable transcript').inputValue()).trimEnd()).toBe(rowsText.trimEnd());
    }
  }
  await page.reload();
  await expect(history).toHaveCount(5);
  await expect(history.filter({hasText:/ · rejected$/})).toHaveCount(3);
  await expect(history.filter({hasText:/ · pending$/})).toHaveCount(1);
  await page.locator('summary').filter({hasText:/ · accepted$/}).click();
  await page.getByRole('button',{name:'Accepted corrected transcript',exact:true}).click();
  await expect.poll(async()=>(await page.getByLabel('Editable transcript').inputValue()).trimEnd()).toBe(valid.trimEnd());
});

test('correction from a second history PDF retains that PDF and its original OCR',async({page})=>{
  test.setTimeout(120000);
  users=JSON.parse(execFileSync('php',['artisan','tarjetas:acceptance:document-users','--env=browser-testing'],{cwd:fileURLToPath(new URL('../../backend/',import.meta.url)),encoding:'utf8'}));
  await login(page,'a');
  const bytesA=readFileSync('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf');
  const bytesB=Buffer.from(bytesA.toString('latin1').replaceAll('SYNTHETIC RICE','SYNTHETIC BEAN'),'latin1');
  expect(bytesB.length).toBe(bytesA.length);expect(bytesB.equals(bytesA)).toBe(false);
  const hashA=createHash('sha256').update(bytesA).digest('hex');const hashB=createHash('sha256').update(bytesB).digest('hex');
  async function upload(buffer:Buffer,name:string) {
    await page.goto('/receipts');await page.getByLabel('Coto receipt PDF').setInputFiles({name,mimeType:'application/pdf',buffer});
    const posted=page.waitForResponse(r=>r.url()===api+'/api/v1/receipts'&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Import receipt',exact:true}).click();const response=await posted;expect(response.status(),await response.text()).toBe(200);return response.json();
  }
  const first=await upload(bytesA,'synthetic-a.pdf');const second=await upload(bytesB,'synthetic-b.pdf');expect(second.receiptId).toBe(first.receiptId);
  await page.getByRole('link',{name:'Open retained receipt',exact:true}).click();
  const receiptUrl=page.url();
  await page.locator('summary').filter({hasText:/ · pending$/}).last().click();
  await page.getByRole('button',{name:'Original OCR transcript',exact:true}).last().click();
  const editor=page.getByLabel('Editable transcript');await expect(editor).toHaveValue(/SYNTHETIC BEAN/);const originalB=await editor.inputValue();
  const rows=originalB.replace('SYNTHETIC BEAN','SYNTHETIC BEAN REVIEWED');await editor.fill(rows);
  const posted=page.waitForResponse(r=>r.url().endsWith('/api/v1/receipts/corrections')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Verify correction',exact:true}).click();const response=await posted;
  expect(response.request().postDataJSON().sha256).toBe(hashB);expect(response.status(),await response.text()).toBe(200);const result=await response.json();
  await page.reload();await expect(page.locator('summary').filter({hasText:/ · (accepted|rejected|pending)$/})).toHaveCount(3);
  const retained=await page.evaluate(async({api,id,revision})=>{
    const get=async(path:string)=>{const response=await fetch(api+'/api/v1/'+path,{credentials:'include'});if(!response.ok)throw new Error(path+':'+response.status);return response;};
    const detail=await(await get('receipts/'+id)).json();const history=detail.history.find((row:any)=>row.facts.revisionId===revision);
    return {detail,history,original:await(await get('documents/'+history.facts.originalRowsObject.sha256)).text(),corrected:await(await get('documents/'+history.facts.correctedRowsObject.sha256)).text()};
  },{api,id:first.receiptId,revision:result.sourceRevisionId});
  expect(retained.detail.revisionId).toBe(first.sourceRevisionId);expect(retained.detail.documentHash).toBe(hashA);
  expect(retained.history.source.documentHash).toBe(hashB);expect(retained.history.source.previousRevisionId).toBe(second.sourceRevisionId);
  expect(retained.original.replace(/\r\n?/g,'\n').trimEnd()).toBe(originalB.trimEnd());expect(retained.corrected.trimEnd()).toBe(rows.trimEnd());
  await page.goto('/');await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();await login(page,'b');await page.goto(receiptUrl);await expect(page.getByRole('alert')).toHaveText('Receipt not found.');
});

test('over-discounted item remains rejected and correctable while financial reports stay usable',async({page})=>{
 test.setTimeout(120000);
 users=JSON.parse(execFileSync('php',['artisan','tarjetas:acceptance:receipt-rejection','--fresh','--env=browser-testing'],{cwd:fileURLToPath(new URL('../../backend/',import.meta.url)),encoding:'utf8'}));
 await login(page,'b');await page.goto('/receipts');await page.getByRole('link',{name:'2026-01-15',exact:true}).first().click();
 await page.locator('summary').filter({hasText:/ · rejected$/}).first().click();await page.getByRole('button',{name:'Original OCR transcript',exact:true}).click();
 const valid=readFileSync('../docs/rebuild/fixtures/receipt-corrected.rows.txt','utf8');const negative=valid.replaceAll('-20,00','-110,00').replaceAll('130,00','40,00');
 await page.getByLabel('Editable transcript').fill(negative);
 let posted=page.waitForResponse(r=>r.url().endsWith('/api/v1/receipts/corrections')&&r.request().method()==='POST');await page.getByRole('button',{name:'Verify correction',exact:true}).click();
 const rejected=await posted;expect(rejected.status(),await rejected.text()).toBe(422);const retained=await rejected.json();expect(retained.report.errors).toContain('item 1 has a negative net amount');expect(retained.report.checks.every((check:any)=>check.ok)).toBe(true);
 await expect(page.getByLabel('Editable transcript')).toHaveValue(negative.replace(/\r\n?/g,'\n'));
 await page.getByLabel('Editable transcript').fill(valid);posted=page.waitForResponse(r=>r.url().endsWith('/api/v1/receipts/corrections')&&r.request().method()==='POST');await page.getByRole('button',{name:'Verify correction',exact:true}).click();const corrected=await posted;expect(corrected.status(),await corrected.text()).toBe(200);expect((await corrected.json()).receiptId).toBe(retained.receiptId);
 await page.reload();await expect(page.locator('summary').filter({hasText:/ · rejected$/})).toHaveCount(2);await expect(page.locator('summary').filter({hasText:/ · accepted$/})).toHaveCount(1);
 const report=page.waitForResponse(r=>r.url().includes('/api/v1/reports/super-categories')&&r.request().method()==='GET');await page.goto('/super/categories?value=nominal');const reports=await report;expect(reports.status(),await reports.text()).toBe(200);await expect(page.getByRole('heading',{name:'Supermarket categories',exact:true})).toBeVisible();await expect(page.getByRole('row').filter({has:page.locator(`a[href="/receipts/${retained.receiptId}"]`)})).toContainText('130,00');
});
