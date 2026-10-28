import {spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync} from 'node:fs';
const built=spawnSync(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.web.json'],{stdio:'inherit'});
if(built.status!==0)process.exit(built.status??1);
mkdirSync('dist',{recursive:true});
for(const file of ['index.html','styles.css'])copyFileSync('web/'+file,'dist/'+file);
console.log('Frontend built in dist (browser-only modules).');
