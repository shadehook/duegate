import {renderCase,renderConfirmation} from './view.mts';
import type {CaseView} from './types.mts';
const root=document.querySelector<HTMLElement>('#app')!;
const notice=document.querySelector<HTMLElement>('#notice')!;
let confirmation:{action:'approve'|'execute';fingerprint:string}|null=null;
let fundingPreviousEta:string|undefined;
let returnFocusAction='approve';
let token='',view:CaseView|null=null,busy=false,text='The $4,000 customer payment expected Thursday has been delayed until Monday.';
function render(v:CaseView){const opened=[...root.querySelectorAll<HTMLDetailsElement>('details[open]')].map(d=>d.dataset.detail);const active=document.activeElement;const focusAction=active instanceof HTMLElement?active.closest<HTMLButtonElement>('button[data-action]')?.dataset.action:undefined;const editing=active instanceof HTMLTextAreaElement;const start=editing?active.selectionStart:0,end=editing?active.selectionEnd:0;if(v.finalProof&&v.fundingExample&&(!view?.fundingExample||view.fundingExample!==v.fundingExample))text=v.fundingExample;v={...v,fundingPreviousEta};view=v;if(confirmation&&v.approval?.execution_fingerprint!==confirmation.fingerprint)confirmation=null;root.innerHTML=renderCase(v)+(confirmation?renderConfirmation(v,confirmation.action):'');for(const d of root.querySelectorAll<HTMLDetailsElement>('details'))d.open=opened.includes(d.dataset.detail);const modal=root.querySelector<HTMLElement>('[role="dialog"]');root.querySelector<HTMLElement>('header')!.inert=Boolean(modal);root.querySelector<HTMLElement>('main')!.inert=Boolean(modal);document.body.style.overflow=modal?'hidden':'';if(modal)modal.querySelector<HTMLButtonElement>('[data-action="cancel-confirmation"]')?.focus();else if(focusAction)root.querySelector<HTMLButtonElement>('button[data-action="'+focusAction+'"]')?.focus({preventScroll:true});const input=document.querySelector<HTMLTextAreaElement>('#funding-text');if(input){input.value=text;if(editing&&!input.disabled){input.focus({preventScroll:true});input.setSelectionRange(start,end);}}}
async function request(action:string,body:object={}){
  if(busy)return;if(action==='interpret')fundingPreviousEta=view?.treasury.eta;busy=true;notice.textContent='Checking deterministic gates…';notice.hidden=false;
  root.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
  try{const response=await fetch('/api/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-DueGate-Session':token},body:JSON.stringify(body)});if(!response.ok)throw new Error();render(await response.json());notice.hidden=true;}
  catch{notice.textContent='The local service could not complete this request. Execution remains blocked until state is refreshed.';if(view){view={...view,canExecute:false,canApply:false};render(view);}}
  finally{busy=false;}
}
root.addEventListener('input',event=>{if(event.target instanceof HTMLTextAreaElement)text=event.target.value;});
root.addEventListener('click',async event=>{
  const button=(event.target as Element).closest<HTMLButtonElement>('button[data-action]');if(!button||button.disabled||busy)return;
  const action=button.dataset.action!;
  if(action==='cancel-confirmation'){closeConfirmation();return;}
  if(action==='confirm-approve'||action==='confirm-execute'){
    const saved=confirmation;confirmation=null;if(!view||!saved||saved.fingerprint!==view.approval?.execution_fingerprint)return;
    if(action==='confirm-approve'&&saved.action==='approve'&&view.canApprove)await request('approve',{fingerprint:saved.fingerprint});
    else if(action==='confirm-execute'&&saved.action==='execute'&&view.canExecute)await request('execute',{confirm:saved.fingerprint});return;
  }
  if(action==='approve'){if(view?.canApprove&&view.approval){returnFocusAction='approve';confirmation={action:'approve',fingerprint:view.approval.execution_fingerprint};render(view);}return;}
  if(action==='execute'){
    if(view?.presentationMode){await request('execute');return;}
    if(view?.canExecute&&view.preview){returnFocusAction='execute';confirmation={action:'execute',fingerprint:view.preview.digest};render(view);}
  }else await request(action,action==='interpret'?{text}:{});
});
async function start(){try{const r=await fetch('/api/state');if(!r.ok)throw new Error();const data=await r.json();token=data.session;render(data.view);await request('open');}catch{notice.hidden=false;notice.textContent='Local demo service unavailable. Run npm run demo and reload.';}}
void start();
setInterval(async()=>{if(busy||!view||confirmation)return;try{const r=await fetch('/api/state');if(r.ok){const d=await r.json();if(d.session!==token){notice.hidden=false;notice.textContent='Server restarted. Reload the page before continuing.';view={...view,canExecute:false,canApply:false};render(view);return;}render(d.view);if(!d.view.presentationMode&&d.view.finalProof&&d.view.executionState==='MISSING')await request('refresh-context');}}catch{if(view){view={...view,canExecute:false};render(view);}}},15000);

function closeConfirmation(){confirmation=null;if(view)render(view);root.querySelector<HTMLButtonElement>('button[data-action="'+returnFocusAction+'"]')?.focus({preventScroll:true});}
root.addEventListener('keydown',event=>{
 if(!confirmation)return;
 if(event.key==='Escape'){event.preventDefault();closeConfirmation();return;}
 if(event.key!=='Tab')return;
 const modal=root.querySelector<HTMLElement>('[role="dialog"]');
 const controls=[...modal?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],summary,textarea:not(:disabled),[tabindex="0"]')??[]];
 const first=controls[0],last=controls.at(-1);
 if(!first){event.preventDefault();modal?.focus();return;}
 if(event.shiftKey&&(document.activeElement===first||!modal?.contains(document.activeElement))){event.preventDefault();last?.focus();}
 else if(!event.shiftKey&&(document.activeElement===last||!modal?.contains(document.activeElement))){event.preventDefault();first.focus();}
});
