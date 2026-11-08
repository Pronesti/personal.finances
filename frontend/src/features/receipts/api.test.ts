import {afterEach,expect,it,vi} from 'vitest';
import {AxiosError} from 'axios';
import {api} from '../../api/client';
import {command} from './api';
afterEach(()=>{vi.restoreAllMocks();window.dispatchEvent(new Event('tarjetas:session-cleared'));});
it('keeps the same command identity after a rejected concurrency response until explicit meaning changes',async()=>{
 const post=vi.spyOn(api,'post');const rejected=new AxiosError('Conflict');Object.assign(rejected,{response:{status:409,data:{error:{code:'command_conflict'}}}});post.mockRejectedValue(rejected);
 await expect(command('/merchant-review',{version:1},'same-meaning')).rejects.toBe(rejected);
 await expect(command('/merchant-review',{version:1},'same-meaning')).rejects.toBe(rejected);
 expect(post.mock.calls[1][2]?.headers?.['Idempotency-Key']).toBe(post.mock.calls[0][2]?.headers?.['Idempotency-Key']);
 await expect(command('/merchant-review',{version:2},'changed-meaning')).rejects.toBe(rejected);
 expect(post.mock.calls[2][2]?.headers?.['Idempotency-Key']).not.toBe(post.mock.calls[0][2]?.headers?.['Idempotency-Key']);
});
