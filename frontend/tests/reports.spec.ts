import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resetSyntheticRateLimits} from './target';
const api=process.env.TARJETAS_BROWSER_API_ORIGIN??'https://api.tarjetas-browser.test';
const controls:Record<string,{title:string;toggles?:{spend?:boolean;tax?:boolean};granularities?:string[];period?:string}>=JSON.parse(readFileSync('../docs/rebuild/fixtures/routes.json','utf8'));
const reports=['/','/anomalies','/trends','/categories','/merchants','/movers','/compare','/sankey','/calendar','/habits','/pace','/recurring','/currency','/inflation','/taxes','/credits','/float','/future','/installments','/bank','/super','/super/products','/super/categories'];
const dictionary=JSON.parse(readFileSync('../docs/rebuild/fixtures/localization.json','utf8')).dictionaries;
let reportAccounts:Record<string,string>;
async function login(page:Page,email=reportAccounts.a){await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill('Synthetic-Acceptance-Only-2026!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Private ledger',exact:true})).toBeVisible();}
test.beforeAll(()=>{execFileSync('php',['artisan','tarjetas:acceptance:references','--env=browser-testing'],{cwd:fileURLToPath(new URL('../../backend/',import.meta.url)),stdio:'pipe'});reportAccounts=JSON.parse(execFileSync('php',['artisan','tarjetas:acceptance:report-users','--env=browser-testing'],{cwd:fileURLToPath(new URL('../../backend/',import.meta.url)),encoding:'utf8'}));});
test.beforeEach(resetSyntheticRateLimits);
test('all 23 analytical destinations use direct owned reports and the exact route control matrix',async({page})=>{
 test.setTimeout(120_000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await login(page);
 for(const path of reports){const report=path==='/'?'overview':path.slice(1).replaceAll('/','-');const response=page.waitForResponse(response=>response.url().startsWith(`${api}/api/v1/reports/${report}`)&&response.request().method()==='GET');await page.goto(path+'?value=nominal');const result=await response;expect(result.status(),`${path}: ${await result.text()}`).toBe(200);await expect(page.locator('#main h1')).toBeVisible();await expect(page.getByText('Page unavailable',{exact:true})).toHaveCount(0);const config=controls[path];
  await expect(page.getByLabel('Display amounts',{exact:true})).toHaveCount(config.toggles===undefined?0:1);await expect(page.getByLabel('Count spending',{exact:true})).toHaveCount(config.toggles!==undefined&&config.toggles.spend!==false?1:0);await expect(page.getByLabel('Taxes & fees',{exact:true})).toHaveCount(config.toggles!==undefined&&config.toggles.tax!==false?1:0);await expect(page.getByLabel('Period shown',{exact:true})).toHaveCount(config.period?1:0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),path).toBe(true);
 }
 expect(errors).toEqual([]);
});
test('report controls retain URL modes, source navigation, bilingual text and mobile keyboard navigation',async({page})=>{
 await login(page);await page.goto('/trends?value=nominal');await expect(page.locator('.recharts-wrapper')).toBeVisible();await page.getByLabel('Display amounts',{exact:true}).selectOption('usd');await expect(page).toHaveURL(/value=usd/);await page.getByLabel('Count spending',{exact:true}).selectOption('cash');await page.getByLabel('Taxes & fees',{exact:true}).selectOption('incl');await page.getByRole('button',{name:'quarter',exact:true}).click();await expect(page).toHaveURL(/g=quarter/);await page.getByRole('navigation',{name:'Sections'}).getByRole('link',{name:'Categories',exact:true}).click();await expect(page).toHaveURL(/value=usd/);await expect(page).toHaveURL(/spend=cash/);await expect(page).toHaveURL(/tax=incl/);await page.getByRole('button',{name:'Cambiar a español'}).click();await expect(page.locator('html')).toHaveAttribute('lang','es');await expect(page.locator('#main h1')).toContainText(dictionary.es['categories.title']);
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await page.goto('/trends?value=nominal');await expect(page.locator('.recharts-wrapper')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'../qa-output/reports-trends-es-dark-390.png',fullPage:true});
 const menu=page.getByRole('button',{name:dictionary.es['nav.menu']});for(let i=0;i<20&&!await menu.evaluate(element=>element===document.activeElement);i++)await page.keyboard.press('Tab');await expect(menu).toBeFocused();await page.keyboard.press('Enter');await expect(menu).toHaveAttribute('aria-expanded','true');const categoryLink=page.getByRole('navigation',{name:dictionary.es['nav.aria']}).getByRole('link',{name:dictionary.es['nav.categories'],exact:true});for(let i=0;i<30&&!await categoryLink.evaluate(element=>element===document.activeElement);i++)await page.keyboard.press('Tab');await expect(categoryLink).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('#main h1')).toContainText(dictionary.es['categories.title']);
});
test('fresh private ledger financial routes render usable empty states',async({page})=>{
 const accounts=JSON.parse(execFileSync('php',['artisan','tarjetas:acceptance:document-users','--env=browser-testing'],{cwd:fileURLToPath(new URL('../../backend/',import.meta.url)),encoding:'utf8'}));await login(page,accounts.a);for(const path of ['/','/trends','/future','/super']){await page.goto(path);await expect(page.locator('.empty-state')).toBeVisible();await expect(page.getByRole('link',{name:'Import a statement',exact:true})).toBeVisible();}
});

test('six-month native factory corpus proves recurring, forecast, receipt prices and owner-specific alert actions',async({page})=>{
 await login(page);const fetchReport=async(name:string)=>(await page.request.get(`${api}/api/v1/reports/${name}?value=nominal`,{headers:{Origin:'https://app.tarjetas-browser.test',Accept:'application/json'}})).json();
 const overview=await fetchReport('overview');expect(overview.data.spentThisMonth).toBe(24350);
 const recurring=await fetchReport('recurring');expect(recurring.data.some((row:{merchant:string;confidence:string;status:string})=>row.merchant==='SYNTHETIC SUBSCRIPTION'&&row.confidence==='high'&&row.status==='active')).toBe(true);
 const future=await fetchReport('future');expect(future.data.forecast).toHaveLength(6);expect(future.data.forecast[0].certain).toBe(90);
 const supermarket=await fetchReport('super');expect(supermarket.data.kpis.accumulatedTotalCents).toBe(28500);expect(supermarket.data.kpis.accumulatedSavingsCents).toBe(4500);expect(supermarket.data.products.find((row:{name:string})=>row.name==='Synthetic Rice').lastChange.netPct).toBe(25);
 await page.goto('/anomalies?value=nominal');const duplicate=page.locator('article').filter({has:page.getByRole('heading',{name:'SYNTHETIC NEW MERCHANT',exact:true})}).filter({hasText:'charged twice'});await expect(duplicate).toHaveCount(1);const review=page.waitForResponse(response=>response.url().includes('/alerts/')&&response.request().method()==='POST');await duplicate.getByRole('button',{name:'Mark reviewed',exact:true}).click();const decisionResponse=await review;expect(decisionResponse.status(),await decisionResponse.text()).toBe(200);const decision=await decisionResponse.json();await page.reload();await expect(duplicate.getByRole('button',{name:'Mark reviewed',exact:true})).toBeDisabled();await duplicate.getByRole('button',{name:'Reopen',exact:true}).click();await expect(duplicate.getByRole('button',{name:'Reopen',exact:true})).toBeDisabled();
 await page.goto('/');await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();await login(page,reportAccounts.b);const foreign=await page.request.post(`${api}/api/v1/alerts/${encodeURIComponent(decision.alertId)}/state`,{headers:{Origin:'https://app.tarjetas-browser.test',Accept:'application/json','Idempotency-Key':'foreign-alert','X-XSRF-TOKEN':decodeURIComponent((await page.context().cookies()).find(cookie=>cookie.name==='XSRF-TOKEN')!.value)},data:{state:'reviewed',expectedPreviousDecisionId:null}});expect(foreign.status()).toBe(404);
});
test('all analytical layouts fit every required width, language and appearance scheme',async({page})=>{
 test.setTimeout(360_000);await login(page);const failures:string[]=[];page.on('pageerror',error=>failures.push(error.message));page.on('console',message=>{if(message.type()==='error')failures.push(message.text());});page.on('response',response=>{if(response.status()>=400)failures.push(`${response.status()} ${response.url()}`);});
 for(const locale of ['en','es'] as const){
  if(locale==='es')await page.getByRole('button',{name:'Cambiar a español',exact:true}).click();
  for(const colorScheme of ['light','dark'] as const){await page.emulateMedia({colorScheme,reducedMotion:'reduce'});for(const width of [390,1280,1920]){
   await page.setViewportSize({width,height:900});
   for(const path of reports){const report=path==='/'?'overview':path.slice(1).replaceAll('/','-');const loaded=page.waitForResponse(response=>response.url().startsWith(`${api}/api/v1/reports/${report}`)&&response.request().method()==='GET');await page.goto(path+'?value=nominal');const response=await loaded;expect(response.status(),`${path} ${locale}`).toBe(200);await expect(page.locator('.report-toolbar')).toBeAttached();await expect(page.locator('html')).toHaveAttribute('lang',locale);await expect(page.locator('#main h1')).toBeVisible();if(path!=='/'){let expected=dictionary[locale][controls[path].title];if(path==='/sankey'){const period=await page.getByLabel(dictionary[locale]['period.shown'],{exact:true}).inputValue();expected=expected.replace('{period}',period==='all'?dictionary[locale]['sankey.everything']:period);}await expect(page.locator('#main h1')).toContainText(expected);}await expect(page.locator('#main h1')).not.toContainText(/\{(?:period|date)\}/);expect((await page.locator('figcaption').allTextContents()).some(value=>value.includes('{period}'))).toBe(false);await expect(page.getByRole('alert')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),`${path} ${locale} ${width} ${colorScheme}`).toBe(true);}
   await page.goto('/trends?value=nominal');await expect(page.locator('.recharts-wrapper')).toBeVisible();await page.screenshot({path:`../qa-output/reports-trends-${locale}-${colorScheme}-${width}.png`,fullPage:true});console.info(`Verified 23 report layouts: ${locale}, ${colorScheme}, ${width}px`);
  }}
 }
 expect(failures).toEqual([]);
});
test('native recurring money, group expansion, period changes and journal drill links preserve their meaning',async({page})=>{
 await login(page);await page.goto('/recurring?value=usd');const usd=page.getByRole('row').filter({hasText:'SYNTHETIC USD SERVICE'});await expect(usd.getByRole('cell',{name:'US$ 5.00',exact:true})).toHaveCount(2);const ars=page.getByRole('row').filter({hasText:'SYNTHETIC SUBSCRIPTION'});await expect(ars).not.toContainText('US$ 100.00');await expect(page.getByRole('columnheader',{name:'Currency history',exact:true})).toBeVisible();
 await page.goto('/categories?value=nominal&account=expense%3Afood&period=2026-02');await expect(page.getByLabel('Period shown',{exact:true})).toHaveValue('2026-02');await page.getByRole('button',{name:'quarter',exact:true}).click();await expect(page).toHaveURL(/g=quarter/);expect(new URL(page.url()).searchParams.has('period')).toBe(false);expect(new URL(page.url()).searchParams.get('account')).toBe('expense:food');
 const navigation=page.getByRole('navigation',{name:'Sections'});const group=navigation.getByRole('button',{name:'Spending',exact:true});await expect(group).toHaveAttribute('aria-expanded','true');await group.click();await expect(navigation.getByRole('link',{name:'Trends',exact:true})).toBeHidden();await group.click();await expect(navigation.getByRole('link',{name:'Trends',exact:true})).toBeVisible();
 const journal=page.getByRole('link',{name:'Financial entries',exact:true}).first();await expect(journal).toBeVisible();const target=await journal.getAttribute('href');await journal.click();await expect(page).toHaveURL(/journal=/);await expect(page.locator('details.journal[open]')).toHaveCount(1);expect(new URL(page.url()).searchParams.get('journal')).toBe(new URL(target!,page.url()).searchParams.get('journal'));await page.reload();await expect(page.locator('details.journal[open]')).toHaveCount(1);
 await page.goto('/habits?value=nominal');await expect(page.locator('.recharts-wrapper')).toHaveCount(2);await expect(page.getByText('Weekend share',{exact:true})).toBeVisible();
 await page.goto('/upload');await expect(page.getByText('CPI/MEP references are stale:',{exact:false})).toBeVisible();
 await page.goto('/sankey?value=nominal&g=all');await expect(page.locator('#main h1')).toHaveText(dictionary.en['sankey.title'].replace('{period}',dictionary.en['sankey.everything']));await expect(page.locator('figcaption')).toHaveText(dictionary.en['sankey.title'].replace('{period}',dictionary.en['sankey.everything']));await page.getByRole('button',{name:'Cambiar a español',exact:true}).click();await expect(page.locator('#main h1')).toHaveText(dictionary.es['sankey.title'].replace('{period}',dictionary.es['sankey.everything']));
});

test('report filters retain keyboard focus through refresh and advance to the next control in both languages',async({page})=>{
 await login(page);
 for(const locale of ['en','es'] as const){
  if(locale==='es')await page.getByRole('button',{name:'Cambiar a español',exact:true}).click();
  const words=dictionary[locale];await page.goto('/trends?value=real');
  const unit=page.getByLabel(words['mode.value.label'],{exact:true});await expect(unit).toHaveValue('real');
  await unit.focus();await unit.selectOption('nominal');await expect(unit).toHaveValue('nominal');
  await expect(page.getByText(locale==='es'?'Cargando informe…':'Loading report…',{exact:true})).toHaveCount(0);
  await expect(unit).toBeFocused();await page.keyboard.press('Tab');
  const spending=page.getByLabel(words['mode.spend.label'],{exact:true});await expect(spending).toBeFocused();
  await spending.selectOption('cash');await expect(spending).toHaveValue('cash');
  await expect(page.getByText(locale==='es'?'Cargando informe…':'Loading report…',{exact:true})).toHaveCount(0);
  await expect(spending).toBeFocused();await page.keyboard.press('Tab');
  const taxes=page.getByLabel(words['mode.tax.label'],{exact:true});await expect(taxes).toBeFocused();
  await taxes.selectOption('incl');await expect(taxes).toHaveValue('incl');
  await expect(page.getByText(locale==='es'?'Cargando informe…':'Loading report…',{exact:true})).toHaveCount(0);
  await expect(taxes).toBeFocused();
  const quarter=page.getByRole('button',{name:words['granularity.quarter'],exact:true});await quarter.focus();await page.keyboard.press('Enter');
  await expect(quarter).toHaveAttribute('aria-pressed','true');await expect(quarter).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:words['granularity.year'],exact:true})).toBeFocused();
  await page.screenshot({path:`../qa-output/manual-qa-fixes-20261107/keyboard-${locale}.png`,fullPage:true});
 }
});

test('Unallocated purpose labels are translated on categories and accounting in both languages',async({page})=>{
 await login(page);
 for(const locale of ['en','es'] as const){
  if(locale==='es')await page.getByRole('button',{name:'Cambiar a español',exact:true}).click();
  const label=locale==='es'?'Compras sin asignar':'Unallocated purchases';
  for(const path of ['/categories','/accounting']){
   await page.goto(path);await expect(page.getByRole('rowheader',{name:label,exact:true}).first()).toBeVisible();
   await expect(page.getByText('accounting.group.unallocated',{exact:true})).toHaveCount(0);
   await page.screenshot({path:`../qa-output/manual-qa-fixes-20261107/${path.slice(1)}-${locale}.png`,fullPage:true});
  }
 }
});
