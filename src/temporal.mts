export interface EtaWindow { precision: 'DATE' | 'TIME_WINDOW'; start: string; end: string; date: string | null; timezone: string }
export const isTimestamp = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)
  && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
export const isDate = (s: unknown): boolean => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && isTimestamp(s+'T00:00:00.000Z');
export function parts(ms: number, timezone: string): Record<string,string> {
  if (!timezone) throw new Error('TIMEZONE_REQUIRED');
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(ms).map(p=>[p.type,p.value]));
}
export function localInstant(date: string, time: string, timezone: string): string {
  const wall = `${date}T${time}:00.000Z`; if (!isTimestamp(wall)) throw new Error('INVALID_LOCAL_TIME');
  const matches: string[]=[];
  for(let offset=-840;offset<=840;offset+=15){
    const ms=Date.parse(wall)-offset*60000,p=parts(ms,timezone);
    if(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`===`${date}T${time}`) matches.push(new Date(ms).toISOString());
  }
  if(matches.length!==1) throw new Error('NON_UNIQUE_LOCAL_TIME'); return matches[0];
}
/** Full local day, half-open [start, next local midnight). Never assumes 24 hours. */
export function dateWindow(date:string,timezone:string): EtaWindow {
  if(!isDate(date)) throw new Error('INVALID_DATE');
  const next=new Date(date+'T00:00:00.000Z');next.setUTCDate(next.getUTCDate()+1);
  return {precision:'DATE',date,timezone,start:localInstant(date,'00:00',timezone),end:localInstant(next.toISOString().slice(0,10),'00:00',timezone)};
}
export function resolveDay(day:string,reference:string,timezone:string):string {
  if(!isTimestamp(reference)) throw new Error('INVALID_REFERENCE');
  const p=parts(Date.parse(reference),timezone);
  if(isDate(day)) return day;
  const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const d=new Date(`${p.year}-${p.month}-${p.day}T00:00:00.000Z`), name=day.toLowerCase();
  if(!weekdays.includes(name)&&name!=='tomorrow') throw new Error('UNSUPPORTED_DAY');
  d.setUTCDate(d.getUTCDate()+(name==='tomorrow'?1:(weekdays.indexOf(name)-d.getUTCDay()+7)%7));return d.toISOString().slice(0,10);
}
export function validateWindow(w: EtaWindow):void {
  if(!w || Object.keys(w).sort().join('|')!=='date|end|precision|start|timezone' || !isTimestamp(w.start)||!isTimestamp(w.end)||Date.parse(w.start)>=Date.parse(w.end)) throw new Error('INVALID_WINDOW');
  parts(Date.parse(w.start),w.timezone);
  if(w.precision==='DATE') {const expected=dateWindow(w.date!,w.timezone);if(w.start!==expected.start||w.end!==expected.end)throw new Error('INVALID_DAY_BOUNDARIES');}
  else if(w.precision!=='TIME_WINDOW'||w.date!==null)throw new Error('INVALID_WINDOW_PRECISION');
}
