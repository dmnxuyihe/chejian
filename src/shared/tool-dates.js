// Zoned instants are displayed in the browser's local timezone. Older local
// values retain their wall-clock meaning; date-only facts stay date-only.
const zoned=value=>/T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(value))
const pad=n=>String(n).padStart(2,'0')
export function toolDateInput(value){
 if(!value)return ''
 if(!zoned(value))return String(value).slice(0,10)
 const d=new Date(value)
 return Number.isFinite(d.getTime())?`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`:''
}
export function toolDateTimeInput(value){
 if(!value)return ''
 if(!zoned(value))return String(value).slice(0,16)+(String(value).length===10?'T00:00':'')
 const d=new Date(value)
 return Number.isFinite(d.getTime())?`${toolDateInput(value)}T${pad(d.getHours())}:${pad(d.getMinutes())}`:''
}
export function toolDateTime(value,empty='—'){
 if(!value)return empty
 return String(value).length===10?String(value):toolDateTimeInput(value).replace('T',' ')||empty
}
export function toolTimeValue(input,original){
 // Retain the original precision and timezone when an editor did not change it.
 if(input===toolDateTimeInput(original))return original||''
 if(!input)return ''
 const d=new Date(input)
 return Number.isFinite(d.getTime())?d.toISOString():input
}
export function toolDayValue(input,original){
 return input===toolDateInput(original)?original||'':input
}
