import messages from '../messages.json';
export const DICTIONARIES=messages.dictionaries;
export const DEFAULT_LOCALE='en';
export function translate(locale,key,vars){const raw=DICTIONARIES[locale][key]??DICTIONARIES.en[key]??key;return vars?raw.replace(/\{(\w+)\}/g,(whole,name)=>name in vars?String(vars[name]):whole):raw;}
export function translator(locale){const t=(key,vars)=>translate(locale,key,vars);t.locale=locale;t.plural=(key,count,vars)=>translate(locale,`${key}.${count===1?'one':'other'}`,{count,...vars});return t;}
