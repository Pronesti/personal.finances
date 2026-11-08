/** Only an authenticated, private ZIP export may bypass the bounded JSON buffer. */
export function exportStreamLength(method,path,status,headers){
 if(method!=='GET'||new URL(path,'http://private.invalid').pathname!=='/api/v1/exports/ledger'||status!==200)return null;
 if(headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/zip'||!/^attachment(?:;|$)/i.test(headers['content-disposition']??''))return null;
 const cache=headers['cache-control']??'';
 if(!cache.includes('private')||!cache.includes('no-store')||headers['x-content-type-options']!=='nosniff')return null;
 const length=headers['content-length'];if(typeof length!=='string'||!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length)))return null;
 return Number(length);
}
