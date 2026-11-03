import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {DemoService} from './demo-service.mts';
import {existsSync} from 'node:fs';
import {ClaudeFundingInterpreter} from '../src/claude-funding-interpreter.mts';
import {PresentationService} from './presentation-service.mts';
import {t0StatementReader} from '../src/t0-statement-reader.mts';
const origin='http://127.0.0.1:4311',session=randomBytes(32).toString('hex');
const finalProof=process.argv.includes('--final-proof');
const presentation=process.argv.includes('--presentation');
if(presentation&&process.argv.includes('--authorize-final-eur1'))throw new Error('PRESENTATION_CANNOT_ENABLE_WRITES');
const writes=!presentation&&finalProof&&process.argv.includes('--authorize-final-eur1');
if(!presentation){process.loadEnvFile(resolve('.env'));if(!process.env.DUEGATE_SANDBOX_BENEFICIARY_ID)throw new Error('SANDBOX_BENEFICIARY_CONFIGURATION_REQUIRED');}
const claude=process.argv.includes('--claude');
const t0Recorded=process.argv.includes('--t0-recorded');
const liveStatements=process.argv.includes('--t0-statements');
if(liveStatements&&(presentation||claude))throw new Error('LIVE_STATEMENTS_NOT_AVAILABLE_IN_PRESENTATION');
if(t0Recorded&&(!presentation||claude))throw new Error('T0_RECORDED_REQUIRES_OFFLINE_PRESENTATION');
if(claude&&!presentation)throw new Error('CLAUDE_DEMO_REQUIRES_NO_WRITE_PRESENTATION');
let interpretation;
if(claude){if(existsSync(resolve('.env')))process.loadEnvFile(resolve('.env'));const interpreter=new ClaudeFundingInterpreter({apiKey:process.env.ANTHROPIC_API_KEY,model:process.env.ANTHROPIC_MODEL});interpretation={provider:'claude' as const,interpreter,model:/^claude-[a-zA-Z0-9._-]{1,90}$/.test(interpreter.model)?interpreter.model:'INVALID'};}
// Named takes isolate presentation evidence without deleting or altering an existing run.
const runArg=process.argv.find(arg=>arg.startsWith('--presentation-run='));
const run=runArg?.slice('--presentation-run='.length);
if(runArg&&(!presentation||claude||!run||!/^\w[\w-]{0,63}$/.test(run)))throw new Error('INVALID_OFFLINE_PRESENTATION_RUN');
const presentationDirectory=run?resolve('.presentation-runs',run):resolve(claude?'.presentation-claude-state':'.presentation-state');
const service=presentation?new PresentationService(presentationDirectory,'fixtures/recorded-proof.json',interpretation,{
  accountingEvidencePath:t0Recorded?'fixtures/t0-paid-bill.json':undefined,
  statementEvidencePath:t0Recorded?'fixtures/t0-statement-october.json':undefined
}):new DemoService(new (await import('../src/airwallex-sandbox.mts')).AirwallexSandbox(resolve('.env'),{financialWritesEnabled:writes}),resolve(finalProof?'.demo-final-proof':'.demo-state'),undefined,{finalProof,financialWritesEnabled:writes,beneficiaryId:process.env.DUEGATE_SANDBOX_BENEFICIARY_ID,
  statements:liveStatements?t0StatementReader(process.env.T0_API_KEY,process.env.T0_ENTITY_ID):undefined});
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
