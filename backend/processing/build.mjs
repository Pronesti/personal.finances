import {build} from 'esbuild';
const result=await build({entryPoints:['src/receipt.ts','src/reports.ts'],bundle:true,platform:'node',format:'cjs',outdir:'dist',outExtension:{'.js':'.cjs'},metafile:true});
for(const file of Object.keys(result.metafile.inputs))if(file.includes('/web/')||file.includes('next/')||file.includes('better-sqlite')||file.startsWith('../'))throw new Error('Independent private-helper build boundary violated');
