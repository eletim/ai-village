// Calendar days use the viewer's local timezone, including DST boundaries.
export function dayKey(value){if(!value)return '';const d=new Date(value);return Number.isNaN(+d)?'':`${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;}
export function dateDividers(now=new Date()){
 let previous='',hasToday=false;const today=dayKey(now),yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);
 const divider=value=>{const key=dayKey(value);if(key===today)hasToday=true;if(!key||key===previous)return '';previous=key;const d=new Date(value),label=key===today?'今日':key===dayKey(yesterday)?'昨日':`${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
 return `<div class="date-divider" role="separator" aria-label="${label}"><span>${label}</span></div>`;};
 divider.trailingToday=()=>hasToday?'':divider(now);
 return divider;
}
