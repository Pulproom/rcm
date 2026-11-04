import { formatStoryTime, parseStoryTime } from './story-time.js';
import { landmarkLabel } from './occasions.js';
import type { StoredLandmarkKind } from './index.js';

export interface PromiseFirstMade {
  storyTime?: string;
  daysAgo?: number;
  landmark?: Pick<StoredLandmarkKind,'kind'|'label'|'userDefined'>;
  occasion?: {name:string;yearsAgo?:number};
}

const leadingYear=/^(\d{4})(?:년|年)?\s+([^\d].*)$/;
const trailingYear=/^([^\d].*?)\s+(\d{4})(?:년|年)?$/;

/** Read labels literally from the stored time field. No holiday calendar or
 * prose vocabulary: bare names, year + name, and dated parenthetical labels. */
export function storedTimeOccasion(value:string,current?:string):PromiseFirstMade['occasion'] {
  const raw=value.trim(),parsed=parseStoryTime(raw),asOf=parseStoryTime(current);
  let name:string|undefined,year=parsed.year;
  const annotated=/^(.+?)\s*\(([^()]+)\)\s*$/.exec(raw);
  const leading=leadingYear.exec(raw),trailing=trailingYear.exec(raw);
  if(annotated && parseStoryTime(annotated[1]).calendar==='numeric') name=annotated[2]!.trim();
  else if(parsed.calendar==='unknown' && !parsed.daypart && parsed.minute===undefined) {
    if(leading) {year=Number(leading[1]);name=leading[2]!.trim();}
    else if(trailing) {year=Number(trailing[2]);name=trailing[1]!.trim();}
    else if(!/\d/u.test(raw)) name=raw;
  }
  if(!name) return undefined;
  const currentYear=asOf.calendar==='numeric' ? asOf.year : asOf.calendar==='unknown'
    ? Number(leadingYear.exec(current ?? '')?.[1] ?? trailingYear.exec(current ?? '')?.[2]) : undefined;
  const yearsAgo=year!==undefined && currentYear!==undefined && currentYear>=year ? currentYear-year : undefined;
  return {name,...(yearsAgo!==undefined?{yearsAgo}:{})};
}

/** One label, ordered by evidence strength; shared by packet and both skins. */
export function formatPromiseTime(origin:PromiseFirstMade,language:'en'|'ko'):string {
  if(origin.landmark) {
    const mark=origin.landmark;
    if(language==='ko') return mark.kind==='romantic_relationship_established' && !mark.userDefined ? '사귄 날' : landmarkLabel(mark);
    return mark.label || ({first_met:'first meeting day',romantic_relationship_established:'relationship began'} as Record<string,string>)[mark.kind] || mark.kind.replaceAll('_',' ');
  }
  if(origin.occasion) {
    const {name,yearsAgo}=origin.occasion;
    if(!yearsAgo) return name;
    return language==='ko' ? `${yearsAgo===1?'작년':`${yearsAgo}년 전`} ${name}` : `${yearsAgo===1?"last year's":`${yearsAgo}y ago ·`} ${name}`;
  }
  const days=origin.daysAgo;
  if(days!==undefined && days>=0) {
    if(days===0) return language==='ko'?'오늘':'today';
    return language==='ko' ? `${days%7===0?`${days/7}주`:`${days}일`} 전` : `${days%7===0?`${days/7}w`:`${days}d`} ago`;
  }
  return language==='ko' ? formatStoryTime(origin.storyTime) : origin.storyTime ?? '';
}
