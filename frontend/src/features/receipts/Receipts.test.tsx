import {cleanup,render,screen,waitFor,within,fireEvent,act} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {AxiosError} from 'axios';
import {LocaleProvider} from '../../i18n/LocaleProvider';
import {ReceiptPage} from './Receipts';
import type {ReceiptDetail} from './api';

const mocks=vi.hoisted(()=>({get:vi.fn(),command:vi.fn()}));
vi.mock('../../api/client',()=>({api:{get:mocks.get},setRequestLocale:vi.fn()}));
vi.mock('../../api/OriginalDocument',()=>({OriginalDocument:()=>null}));
vi.mock('../../auth/SessionProvider',()=>({useSession:()=>({session:{ledger:{id:'owner-a'}}})}));
vi.mock('./api',()=>({command:mocks.command}));
beforeEach(()=>{mocks.get.mockReset();mocks.command.mockReset();document.cookie='lang=en; Path=/';});
afterEach(cleanup);
function receipt(action:'link'|'unlink',purchaseVersion:number,partial=false,invalidated=false,history:ReceiptDetail['history']=[]){
 const item={sourceLineId:'line-1',accountId:'expense:food:groceries:pantry',purposeId:'food',minor:8000};
 const data={receiptId:1,revisionId:'revision-1',purchaseVersion,date:'2026-01-15',fiscalId:'synthetic',totalMinor:8000,documentHash:'synthetic',report:{ok:true,checks:[],errors:[],warnings:[]},parsed:{header:{paymentMethod:'Synthetic',paymentCents:8000}},items:[{id:'line-1',item:{descPrinted:'Synthetic rice',qtyMilli:1000,unit:'un',lineTotalCents:8000,discounts:[]},product:{id:'product-1',name:'Synthetic rice',category:'pantry',unit:'un',reviewed:true,seq:1},match:{seq:1,productId:'product-1',reviewed:true}}],link:{id:'decision-1',action,purchaseId:'purchase-1',cardId:'card-a',itemAllocations:[item]},history};
 if(invalidated)data.items[0].match.reviewed=false;
 if(partial){data.totalMinor=13000;data.items.push({...data.items[0],id:'line-2',item:{...data.items[0].item,descPrinted:'Unreviewed soap',lineTotalCents:5000},product:{...data.items[0].product,id:'product-2',reviewed:false},match:{...data.items[0].match,productId:'product-2',reviewed:false}});}
 mocks.get.mockImplementation((path:string)=>Promise.resolve({data:path.startsWith('/receipts/')?data:{cards:[{id:'card-a',display_name:'Synthetic card'}],catalog:[{id:item.accountId,type:'expense',posting:true,enabled:true,currency:null,primary_purpose_id:'food',custom_name:'Pantry'}]}}));
 render(<MemoryRouter initialEntries={['/receipts/1']}><LocaleProvider><Routes><Route path="/receipts/:id" element={<ReceiptPage/>}/></Routes></LocaleProvider></MemoryRouter>);
 return item;
}
it('submits the displayed purchase version and retains the form after a stale allocation rejection',async()=>{
 const error=new AxiosError('Conflict');Object.assign(error,{response:{status:409,data:{error:{code:'stale_purchase_version'}}}});mocks.command.mockRejectedValue(error);
 const item=receipt('link',7);await userEvent.setup().click(await screen.findByRole('button',{name:'Apply reviewed item allocations'}));
 await waitFor(()=>expect(mocks.command).toHaveBeenCalledWith('/receipts/1/reconciliation',expect.objectContaining({expectedPurchaseVersion:7,expectedPreviousDecisionId:'decision-1',purchaseId:'purchase-1',itemAllocations:[item]}),expect.any(String),false));
 expect(await screen.findByRole('alert')).toHaveTextContent('This evidence changed. Reload before confirming.');
 expect(screen.getByRole('combobox',{name:'Account'})).toHaveValue(item.accountId);
});
it('keeps retained item selections when reopening unlinked evidence and relinks without resubmitting allocations',async()=>{
 mocks.command.mockRejectedValue(new Error('stop after submission'));const item=receipt('unlink',8);const user=userEvent.setup();
 expect(await screen.findByRole('combobox',{name:'Account'})).toHaveValue(item.accountId);
 await user.click(screen.getByRole('checkbox'));await user.click(screen.getByRole('button',{name:'Record supported purchase'}));
 await waitFor(()=>expect(mocks.command).toHaveBeenCalled());const body=mocks.command.mock.calls[0][1];expect(body).toMatchObject({expectedPurchaseVersion:8,purchaseId:null,allocation:null});expect(body).not.toHaveProperty('itemAllocations');
});

it('can explicitly reset the final allocated item to Unallocated with the displayed purchase version',async()=>{
 mocks.command.mockRejectedValue(new Error('stop after submission'));receipt('link',7);const user=userEvent.setup();
 await user.selectOptions(await screen.findByRole('combobox',{name:'Account'}),'expense:unallocated');
 const apply=screen.getByRole('button',{name:'Apply reviewed item allocations'});expect(apply).toBeEnabled();await user.click(apply);
 await waitFor(()=>expect(mocks.command).toHaveBeenCalled());expect(mocks.command.mock.calls[0][1]).toMatchObject({expectedPurchaseVersion:7,allocation:[{accountId:'expense:unallocated',purposeId:'unallocated',minor:8000}],itemAllocations:[]});
});

it('can reset a partially reviewed receipt without approving its untouched remainder',async()=>{
 mocks.command.mockRejectedValue(new Error('stop after submission'));receipt('link',7,true);const user=userEvent.setup();
 const accounts=await screen.findAllByRole('combobox',{name:'Account'});expect(accounts[1]).toBeDisabled();await user.selectOptions(accounts[0],'expense:unallocated');
 const apply=screen.getByRole('button',{name:'Apply reviewed item allocations'});expect(apply).toBeEnabled();await user.click(apply);
 await waitFor(()=>expect(mocks.command).toHaveBeenCalled());expect(mocks.command.mock.calls[0][1]).toMatchObject({expectedPurchaseVersion:7,allocation:[{accountId:'expense:unallocated',purposeId:'unallocated',minor:13000}],itemAllocations:[]});
});

it('explains rejected allocation-only relinking and retains item selections without checking payment',async()=>{
 const error=new AxiosError('Bad request');Object.assign(error,{response:{status:400,data:{error:{code:'receipt_payment_unresolved'}}}});mocks.command.mockRejectedValue(error);
 const item=receipt('unlink',7);await userEvent.setup().click(await screen.findByRole('button',{name:'Apply reviewed item allocations'}));
 await waitFor(()=>expect(mocks.command).toHaveBeenCalled());expect(mocks.command.mock.calls[0][1]).toMatchObject({paymentVerified:false,itemAllocations:[item]});
 expect(await screen.findByRole('alert')).toHaveTextContent('Verify full payment with this card and record the supported purchase before relinking the receipt.');expect(screen.getByRole('checkbox')).not.toBeChecked();expect(screen.getByRole('combobox',{name:'Account'})).toHaveValue(item.accountId);
});

it('clears an earlier payment confirmation after unlinking',async()=>{
 receipt('link',7);const user=userEvent.setup();await user.click(await screen.findByRole('checkbox'));expect(screen.getByRole('checkbox')).toBeChecked();
 const get=mocks.get.getMockImplementation()!;mocks.command.mockImplementation(async()=>{mocks.get.mockImplementation(async(path:string)=>{const result=await get(path);if(path.startsWith('/receipts/'))result.data.link.action='unlink';return result;});return {};});
 await user.click(screen.getByRole('button',{name:'Unlink evidence'}));await screen.findByText('Current link: Unlinked');expect(screen.getByRole('checkbox')).not.toBeChecked();
});

it('lets an invalidated allocated item be cleared but prevents assigning an account until reapproval',async()=>{
 mocks.command.mockRejectedValue(new Error('stop after submission'));receipt('link',7,false,true);const user=userEvent.setup();
 const account=await screen.findByRole('combobox',{name:'Account'});expect(account).toBeEnabled();expect(screen.getByRole('option',{name:'Pantry'})).toBeDisabled();await user.selectOptions(account,'expense:unallocated');
 expect(account).toBeDisabled();await user.click(screen.getByRole('button',{name:'Apply reviewed item allocations'}));await waitFor(()=>expect(mocks.command).toHaveBeenCalled());expect(mocks.command.mock.calls[0][1]).toMatchObject({expectedPurchaseVersion:7,itemAllocations:[],allocation:[{accountId:'expense:unallocated',purposeId:'unallocated',minor:8000}]});
});

it('corrects the selected history PDF and retains its identity after rejection',async()=>{
 const history=[
  {facts:{revisionId:'revision-a',originalRowsObject:{sha256:'rows-a'},correctedRowsObject:null},source:{admission:'accepted',recordedAt:'2026-01-16',documentHash:'pdf-a'}},
  {facts:{revisionId:'revision-b',originalRowsObject:{sha256:'rows-b'},correctedRowsObject:{sha256:'corrected-b'}},source:{admission:'pending',recordedAt:'2026-01-17',documentHash:'pdf-b'}},
 ];
 mocks.command.mockRejectedValue(new Error('Retain editor for retry'));
 receipt('link',7,false,false,history);
 const get=mocks.get.getMockImplementation()!;
 mocks.get.mockImplementation((path:string,...args:unknown[])=>path.startsWith('/documents/')?Promise.resolve({data:path.endsWith('rows-a')?'Original A':path.endsWith('corrected-b')?'Stored corrected B':'Original B'}):get(path,...args));
 const user=userEvent.setup();
 await user.click(await screen.findByText('2026-01-17 · pending'));
 await user.click(within(screen.getByText('2026-01-17 · pending').parentElement!).getByRole('button',{name:'Original OCR transcript'}));
 const editor=await screen.findByLabelText('Editable transcript');await waitFor(()=>expect(editor).toHaveValue('Original B'));
 fireEvent.change(editor,{target:{value:'Corrected B'}});await user.click(screen.getByRole('button',{name:'Verify correction'}));
 await waitFor(()=>expect(mocks.command).toHaveBeenCalledWith('/receipts/corrections',{sha256:'pdf-b',rowsText:'Corrected B'},expect.any(String),true));
 await user.click(screen.getByRole('button',{name:'Verify correction'}));expect(mocks.command.mock.calls[1][1]).toEqual({sha256:'pdf-b',rowsText:'Corrected B'});
 await user.click(screen.getByRole('button',{name:'Corrected transcript'}));await waitFor(()=>expect(screen.getByLabelText('Editable transcript')).toHaveValue('Stored corrected B'));await user.click(screen.getByRole('button',{name:'Verify correction'}));expect(mocks.command.mock.calls[2][1]).toEqual({sha256:'pdf-b',rowsText:'Stored corrected B'});
 await user.click(screen.getByText('2026-01-16 · accepted'));await user.click(within(screen.getByText('2026-01-16 · accepted').parentElement!).getByRole('button',{name:'Original OCR transcript'}));
 await waitFor(()=>expect(screen.getByLabelText('Editable transcript')).toHaveValue('Original A'));
 await user.click(screen.getByRole('button',{name:'Verify correction'}));expect(mocks.command.mock.calls[3][1]).toEqual({sha256:'pdf-a',rowsText:'Original A'});
});

it('ignores a superseded history transcript response and submits the latest selected PDF',async()=>{
 const history=['a','b'].map(name=>({facts:{revisionId:'revision-'+name,originalRowsObject:{sha256:'rows-'+name},correctedRowsObject:null},source:{admission:'pending',recordedAt:name,documentHash:'pdf-'+name}}));
 mocks.command.mockRejectedValue(new Error('Retain editor'));
 receipt('link',7,false,false,history);
 const get=mocks.get.getMockImplementation()!;let resolveOld!:(value:{data:string})=>void;let oldSignal:AbortSignal|undefined;
 mocks.get.mockImplementation((path:string,options?:{signal?:AbortSignal})=>{
  if(path==='/documents/rows-b'){oldSignal=options?.signal;return new Promise(resolve=>{resolveOld=resolve;});}
  if(path==='/documents/rows-a')return Promise.resolve({data:'Original A'});
  return get(path,options);
 });
 const user=userEvent.setup();await user.click(await screen.findByText('b · pending'));await user.click(within(screen.getByText('b · pending').parentElement!).getByRole('button',{name:'Original OCR transcript'}));
 await user.click(screen.getByText('a · pending'));await user.click(within(screen.getByText('a · pending').parentElement!).getByRole('button',{name:'Original OCR transcript'}));
 await waitFor(()=>expect(screen.getByLabelText('Editable transcript')).toHaveValue('Original A'));expect(oldSignal?.aborted).toBe(true);
 await act(async()=>resolveOld({data:'Late B'}));expect(screen.getByLabelText('Editable transcript')).toHaveValue('Original A');
 await user.click(screen.getByRole('button',{name:'Verify correction'}));expect(mocks.command.mock.calls[0][1]).toEqual({sha256:'pdf-a',rowsText:'Original A'});
});


it.each([
 ['en','rejected','Corrected transcript','Editable transcript'],
 ['en','accepted','Corrected transcript','Editable transcript'],
 ['es','rejected','Transcripción corregida','Transcripción editable'],
 ['es','accepted','Transcripción corregida','Transcripción editable'],
])('labels %s %s correction history without implying admission',async(locale,admission,label,editorLabel)=>{
 document.cookie=`lang=${locale}; Path=/`;
 const history=[{facts:{revisionId:'correction-1',originalRowsObject:{sha256:'original-rows'},correctedRowsObject:{sha256:'corrected-rows'}},source:{admission,recordedAt:'2026-01-17',documentHash:'original-pdf'}}];
 receipt('link',7,false,false,history);
 const get=mocks.get.getMockImplementation()!;
 mocks.get.mockImplementation((path:string,...args:unknown[])=>path==='/documents/corrected-rows'?Promise.resolve({data:'Retained corrected evidence'}):get(path,...args));
 const summary=await screen.findByText(`2026-01-17 · ${admission}`);
 const user=userEvent.setup();await user.click(summary);
 const entry=within(summary.parentElement!);
 expect(entry.queryByRole('button',{name:/Accepted corrected transcript|Transcripción corregida aceptada/})).not.toBeInTheDocument();
 await user.click(entry.getByRole('button',{name:label}));
 await waitFor(()=>expect(screen.getByLabelText(editorLabel)).toHaveValue('Retained corrected evidence'));
 expect(mocks.get).toHaveBeenCalledWith('/documents/corrected-rows',expect.objectContaining({responseType:'text'}));
 expect(summary).toHaveTextContent(admission);
});
