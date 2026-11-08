import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resetSyntheticRateLimits} from './target';
const api=process.env.TARJETAS_BROWSER_API_ORIGIN??'https://api.tarjetas-browser.test';
let users:Record<string,string>;
test.beforeAll(()=>{users=JSON.parse(execFileSync('php',['artisan','tarjetas:acceptance:historical-refund','--fresh','--env=browser-testing'],{cwd:fileURLToPath(new URL('../../backend/',import.meta.url)),encoding:'utf8'}));});
test.beforeEach(resetSyntheticRateLimits);
test('two owners associate/unlink historical evidence and confirm one full refund without an old purchase',async({page})=>{
  for(const owner of ['a','b']){
    await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(users[owner]);await page.getByLabel('Password',{exact:true}).fill('Synthetic-Acceptance-Only-2026!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Private ledger',exact:true})).toBeVisible();await page.goto('/super/charges');
    await expect(page.getByRole('heading',{name:'Receipts and charges',exact:true})).toBeVisible();
    const source=page.getByLabel('Historical original source',{exact:true});await source.selectOption({label:'2026-01-15 · Synthetic Visa A · COTO SYNTHETIC · $ 130,00'});
    const associate=page.waitForResponse(response=>response.url().includes('/historical-associations')&&response.request().method()==='POST');await page.getByRole('button',{name:'Associate historical evidence',exact:true}).click();expect((await associate).status()).toBe(200);await expect(page.getByRole('button',{name:'Unlink historical association',exact:true})).toBeVisible();
    const unlink=page.waitForResponse(response=>response.url().includes('/historical-associations')&&response.request().method()==='POST');await page.getByRole('button',{name:'Unlink historical association',exact:true}).click();expect((await unlink).status()).toBe(200);await expect(page.getByRole('button',{name:'Unlink historical association',exact:true})).toHaveCount(0);
    const original=page.getByLabel('Original acquisition',{exact:true});const refund=page.getByLabel('Refund source',{exact:true});
    await original.selectOption({index:1});await refund.selectOption({index:1});await page.getByLabel('I confirm this is the full refund').check();const post=page.waitForResponse(response=>response.url()===`${api}/api/v1/historical-refunds`&&response.request().method()==='POST');await page.getByRole('button',{name:'Record full refund',exact:true}).click();const response=await post;expect(response.status(),await response.text()).toBe(200);
    const accounting=await page.evaluate(async api=>{const response=await fetch(`${api}/api/v1/accounting`,{credentials:'include',headers:{Accept:'application/json'}});return response.json();},api);
    expect(accounting.meta.total).toBe(2);expect(accounting.accounts.find((row:{id:string})=>row.id==='expense:food:groceries:pantry').balances.ARS).toBe('-13000');expect(accounting.accounts.find((row:{id:string})=>row.id==='synthetic-visa-a:ARS:billed').balances.ARS).toBe('0');
    await page.goto('/');await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  }
});
