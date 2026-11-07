import {expect,test} from 'vitest';
import {formatMoney,percent} from './model';
import vectors from './formatting.json';
test('report formatting preserves the frozen presentation vectors',()=>{
 for(const row of vectors.money)expect(formatMoney(row.input,row.value as 'nominal'|'usd')).toBe(row.expected);
 for(const row of vectors.cents)expect(formatMoney(row.input,row.value as 'nominal'|'usd',true)).toBe(row.expected);
 for(const row of vectors.percent)expect(percent(row.input)).toBe(row.expected);
});
