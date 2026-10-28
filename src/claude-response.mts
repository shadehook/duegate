import {candidateSchema,uncertaintyCodes,validateCandidate} from './funding-v2.mts';
import type {KnownInflow} from './funding-update.mts';
import {reject,FundingDiagnosticError,safeDiagnostic} from './funding-diagnostics.mts';
export function responseMetadata(value:unknown):{stop_reason:string|null;content_block_types:string[]}{
 const v=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const stops=['end_turn','refusal','max_tokens','stop_sequence','tool_use','pause_turn','model_context_window_exceeded'];
 const blocks=['text','thinking','redacted_thinking','tool_use','server_tool_use'];
 return {stop_reason:typeof v.stop_reason==='string'?(stops.includes(v.stop_reason)?v.stop_reason:'UNKNOWN'):null,content_block_types:Array.isArray(v.content)?v.content.slice(0,20).map(b=>b&&typeof b==='object'&&blocks.includes(b.type)?b.type:'UNKNOWN'):[]};
}
export function parseClaudeResponse(value:unknown,raw:string,known:readonly KnownInflow[],reference:string,timezone:string){
 if(!value||typeof value!=='object'||Array.isArray(value))reject('INVALID_RESPONSE_ENVELOPE');
 const v=value as Record<string,unknown>;
 if(v.stop_reason==='refusal')reject('CLAUDE_REFUSAL');
 if(v.stop_reason==='max_tokens')reject('CLAUDE_MAX_TOKENS');
 if(v.stop_reason!=='end_turn')reject('UNSUPPORTED_STOP_REASON');
 if(!Array.isArray(v.content))reject('NO_TEXT_CONTENT');
 if(v.content.length===0)reject('EMPTY_CONTENT');
 // Thinking payloads/signatures are opaque and never read, parsed, retained or displayed.
 const textBlocks:Record<string,unknown>[]=[];
 for(const item of v.content){
  if(!item||typeof item!=='object'||Array.isArray(item))reject('UNSUPPORTED_CONTENT_BLOCK');
  if(item.type==='thinking'||item.type==='redacted_thinking')continue;
  if(item.type!=='text')reject('UNSUPPORTED_CONTENT_BLOCK');
  textBlocks.push(item);
 }
 if(textBlocks.length===0)reject('NO_TEXT_CONTENT');
 // Count all text blocks, even empty/malformed ones; never select or concatenate ambiguously.
 if(textBlocks.length!==1)reject('MULTIPLE_CONTENT_BLOCKS');
 const block=textBlocks[0];
 if(typeof block.text!=='string')reject('NO_TEXT_CONTENT');if(!block.text.trim())reject('EMPTY_CONTENT');
 let parsed:unknown;try{parsed=JSON.parse(block.text);}catch{reject('JSON_PARSE_FAILED');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))reject('SCHEMA_VALIDATION_FAILED');
 const c=parsed as Record<string,unknown>,fields:readonly string[]=candidateSchema.required;
 if(Object.keys(c).some(k=>!fields.includes(k)))reject('UNEXPECTED_FIELD','$.*'); // Never echo arbitrary model keys.
 for(const field of fields)if(!Object.hasOwn(c,field))reject('MISSING_FIELD',field);
 const normalize=(field:string,values:readonly string[],code:'UNSUPPORTED_EVENT_TYPE'|'UNSUPPORTED_CURRENCY'|'INVALID_TEMPORAL_TYPE')=>{
  const x=c[field];if(typeof x!=='string')reject(code,field);const canonical=values.find(v=>v.toUpperCase()===x.toUpperCase());if(!canonical)reject(code,field);c[field]=canonical;
 };
 try{normalize('classification',candidateSchema.properties.classification.enum,'UNSUPPORTED_EVENT_TYPE');normalize('eta_precision',candidateSchema.properties.eta_precision.enum,'INVALID_TEMPORAL_TYPE');if(c.currency!==null)normalize('currency',['USD','EUR'],'UNSUPPORTED_CURRENCY');}
 catch(e){throw new FundingDiagnosticError(safeDiagnostic(e,'NORMALIZATION_FAILED'));}
 if(c.amount_minor!==null&&(!Number.isSafeInteger(c.amount_minor)||Number(c.amount_minor)<0))reject('INVALID_AMOUNT');
 if(c.expected_inflow_id!==null&&(typeof c.expected_inflow_id!=='string'||!/^INFLOW-[A-Z0-9_-]{1,80}$/.test(c.expected_inflow_id)))reject('INVALID_INFLOW_ID');
 if(!Array.isArray(c.ambiguities)||c.ambiguities.length>10)reject('INVALID_AMBIGUITIES');
 c.ambiguities=c.ambiguities.map(x=>{if(typeof x!=='string')reject('INVALID_AMBIGUITIES');const canonical=uncertaintyCodes.find(v=>v.toUpperCase()===x.toUpperCase());if(!canonical)reject('INVALID_AMBIGUITIES');return canonical;});
 for(const f of ['new_eta_exact','new_eta_date','eta_window_start','eta_window_end'])if(c[f]!==null&&typeof c[f]!=='string')reject('INVALID_TEMPORAL_TYPE',f);
 try{return validateCandidate(c,raw,known,reference,timezone);}catch(e){throw new FundingDiagnosticError(safeDiagnostic(e));}
}
