import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resetSyntheticRateLimits} from './target';
test.beforeEach(resetSyntheticRateLimits);
const api=process.env.TARJETAS_BROWSER_API_ORIGIN??'https://api.tarjetas-browser.test';
test('actual issuer PDF upload for each card, renamed replay and card identity refusal',async({page})=>{
  await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill('synthetic-a@example.invalid');await page.getByLabel('Password',{exact:true}).fill('Synthetic-Acceptance-Only-2026!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Private ledger',exact:true})).toBeVisible();await page.getByRole('link',{name:'Import statements',exact:true}).click();
  for(const [brand,card] of [['visa','synthetic-visa-a'],['mastercard','synthetic-mastercard'],['mercadopago','synthetic-mp']]){
    const fixture=JSON.parse(readFileSync(`../docs/rebuild/fixtures/${brand}.expected.json`,'utf8'));
    await page.getByLabel('Actual card',{exact:true}).selectOption(card);await page.getByLabel('Statement PDF').setInputFiles(`../docs/rebuild/fixtures/pdf/${fixture.file}`);
    const result=page.waitForResponse(response=>response.url()===`${api}/api/v1/statements`&&response.request().method()==='POST');await page.getByRole('button',{name:'Import statement',exact:true}).click();const response=await result;expect(response.status(),await response.text()).toBe(200);
    await expect(page.locator('.receipt-item').filter({hasText:fixture.file})).toHaveCount(1);
  }
  const bytes=readFileSync('../docs/rebuild/fixtures/pdf/synthetic_visa_2026_02.pdf');
  await page.getByLabel('Actual card',{exact:true}).selectOption('synthetic-visa-a');await page.getByLabel('Statement PDF').setInputFiles({name:'renamed_synthetic_visa_2026_02.pdf',mimeType:'application/pdf',buffer:bytes});
  const result=page.waitForResponse(response=>response.url()===`${api}/api/v1/statements`&&response.request().method()==='POST');await page.getByRole('button',{name:'Import statement',exact:true}).click();const replay=await(await result).json();expect(replay.duplicate).toBe(true);expect(replay.postedJournalIds).toEqual([]);
  await page.getByLabel('Actual card',{exact:true}).selectOption('synthetic-visa-b');await page.getByRole('button',{name:'Import statement',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('These document bytes already belong to another selected card.');
  await page.reload();await expect(page.locator('.receipt-item')).toHaveCount(3);
});
