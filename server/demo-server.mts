import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {DemoService} from './demo-service.mts';
import {PresentationService} from './presentation-service.mts';
const origin='http://127.0.0.1:4311',session=randomBytes(32).toString('hex');
const finalProof=process.argv.includes('--final-proof');
const presentation=process.argv.includes('--presentation');
if(presentation&&process.argv.includes('--authorize-final-eur1'))throw new Error('PRESENTATION_CANNOT_ENABLE_WRITES');
const writes=!presentation&&finalProof&&process.argv.includes('--authorize-final-eur1');
if(!presentation){process.loadEnvFile(resolve('.env'));if(!process.env.DUEGATE_SANDBOX_BENEFICIARY_ID)throw new Error('SANDBOX_BENEFICIARY_CONFIGURATION_REQUIRED');}
const service=presentation?new PresentationService(resolve('.presentation-state')):new DemoService(new (await import('../src/airwallex-sandbox.mts')).AirwallexSandbox(resolve('.env'),{financialWritesEnabled:writes}),resolve(finalProof?'.demo-final-proof':'.demo-state'),undefined,{finalProof,financialWritesEnabled:writes,beneficiaryId:process.env.DUEGATE_SANDBOX_BENEFICIARY_ID});
const assets:Record<string,[string,string]>={'/':['index.html','text/html'],'/styles.css':['styles.css','text/css'],'/app.mjs':['app.mjs','text/javascript'],'/view.mjs':['view.mjs','text/javascript'],'/types.mjs':['types.mjs','text/javascript']};
createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const json=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  try{
    if(req.headers.host!=='127.0.0.1:4311')return json(403,{error:'Invalid local host'});
    if(req.method==='GET'&&req.url==='/api/state')return json(200,{session,view:service.view()});
    if(req.method==='GET'&&req.url==='/api/audit'){res.setHeader('Content-Disposition','attachment; filename="duegate-audit.json"');return json(200,service.exportAudit());}
    if(req.method==='GET'&&assets[req.url??'']){const [file,type]=assets[req.url!];res.writeHead(200,{'Content-Type':type});res.end(readFileSync(resolve('dist',file)));return;}
    const action=req.url?.match(/^\/api\/(open|interpret|apply|funded|approve|invalidate|refresh-context|execute|refresh-status|show-recorded)$/)?.[1];
    if(req.method!=='POST'||!action)return json(404,{error:'Not found'});
    if(req.headers.origin!==origin||req.headers['x-duegate-session']!==session||req.headers['content-type']!=='application/json')return json(403,{error:'Local session required'});
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>4096)return json(413,{error:'Request too large'});}
    const parsed=JSON.parse(body);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return json(400,{error:'Invalid request'});
    return json(200,await service.action(action,parsed));
  }catch{json(400,{error:'Local request could not be completed safely'});}
}).listen(4311,'127.0.0.1',()=>console.log('DueGate demo: '+origin+' · '+(writes?'EUR 1 financial writes explicitly enabled':'financial writes DISABLED')));
