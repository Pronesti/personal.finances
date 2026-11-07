import { test, expect, type Page } from '@playwright/test';
import { resetSyntheticRateLimits } from './target';
test.beforeEach(resetSyntheticRateLimits);
import { readFileSync } from 'node:fs';
const api = process.env.TARJETAS_BROWSER_API_ORIGIN ?? 'https://api.tarjetas-browser.test';
async function login(page: Page, who: string) {
  await page.goto('/login'); await page.getByLabel('Email',{exact:true}).fill(`synthetic-${who}@example.invalid`); await page.getByLabel('Password',{exact:true}).fill('Synthetic-Acceptance-Only-2026!'); await page.getByRole('button',{name:'Sign in',exact:true}).click(); await expect(page.getByRole('heading',{name:'Private ledger',exact:true})).toBeVisible();
}
test('actual Vision upload, item review, partial/full allocation and duplicate bytes',async({page})=>{
  test.setTimeout(120_000);
  await login(page,'a'); await page.getByRole('link',{name:'Receipts',exact:true}).click();
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
  await page.getByRole('link',{name:'Receipts',exact:true}).click(); await page.getByLabel('Coto receipt PDF').setInputFiles('../docs/rebuild/fixtures/pdf/synthetic_coto.pdf'); const replay=page.waitForResponse(response=>response.url()===`${api}/api/v1/receipts`&&response.request().method()==='POST'); await page.getByRole('button',{name:'Import receipt',exact:true}).click(); const duplicate=await(await replay).json(); expect(duplicate.duplicate).toBe(true); expect(duplicate.receiptId).toBe(body.receiptId);
});
test('retained one-cent rejection, correction history and foreign receipt access',async({page})=>{
  await login(page,'b'); await page.getByRole('link',{name:'Receipts',exact:true}).click(); await page.getByRole('link',{name:'2026-01-15',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'Receipt detail',exact:true})).toBeVisible(); const receiptUrl=page.url();
  await page.locator('summary').filter({hasText:'rejected'}).first().click(); await page.getByRole('button',{name:'Original OCR transcript',exact:true}).first().click(); await expect(page.getByLabel('Editable transcript')).toHaveValue(/130,01/);
  await page.getByLabel('Editable transcript').fill(readFileSync('../docs/rebuild/fixtures/receipt-corrected.rows.txt','utf8')); await page.getByRole('button',{name:'Verify correction',exact:true}).click(); await expect(page.getByRole('status').filter({hasText:/Evidence retained.|Change recorded./})).toBeVisible();
  await page.locator('summary').filter({hasText:'accepted'}).last().click(); await page.getByRole('button',{name:'Accepted corrected transcript',exact:true}).click(); await expect(page.getByLabel('Editable transcript')).toHaveValue(/130,00/);
  await page.setViewportSize({width:390,height:844}); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.goto('/'); await page.getByRole('button',{name:'Sign out',exact:true}).click(); await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible(); await login(page,'a'); await page.goto(receiptUrl); await expect(page.getByRole('alert')).toHaveText('Receipt not found.');
});
