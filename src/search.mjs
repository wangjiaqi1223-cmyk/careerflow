import {normalizeLinkedIn,selectionIssue} from './rules.mjs';
export const terms=s=>String(s||'').split(/[,，\n]/).map(x=>x.trim()).filter(Boolean);
function text(s) {return String(s||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();}
const norm=s=>s.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim();
function includes(hay,needle) {
  hay=norm(hay);needle=norm(needle);
  if(!needle)return false;
  const escaped=needle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return /[a-z0-9]/i.test(needle)?new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`,'i').test(hay):hay.includes(needle);
}
export function parseResult(result,profile) {
  try {
    const link=normalizeLinkedIn(result.url);
    const heading=text(result.title).replace(/\s*\|\s*LinkedIn.*$/i,'').trim();
    // Only extract fields present in a recognizable result title. Never invent a company/location.
    const english=heading.match(/^(.+?) hiring (.+?) in (.+)$/i);
    const chinese=heading.match(/^(.+?)(?:正在招聘|招聘)(.+?)[（(]([^()（）]+)[）)]$/);
    const m=english||chinese;if(!m)return null;
    const company=m[1].trim(),title=m[2].trim(),location=m[3].trim();
    const description=text([result.description,...(Array.isArray(result.extra_snippets)?result.extra_snippets:[])].join(' ')).slice(0,2500);
    if(!description||[company,title,location].some(x=>!x||x.length>160))return null;
    const job={linkedinId:link.id,url:link.url,title,company,location,description,verification:'search_result'};
    if(!terms(profile.keywords).some(t=>includes(title,t)))return null;
    if(terms(profile.location).length&&!terms(profile.location).some(t=>includes(location,t)))return null;
    const content=`${title} ${location} ${description}`;
    if(/no longer accepting applications|job is no longer available|职位已关闭|停止接受申请/i.test(content))return null;
    if(profile.remote&&(!/\bremote\b|远程/i.test(`${title} ${location}`)||/not remote|no remote|on[- ]site only|不支持远程/i.test(content)))return null;
    if(selectionIssue(job,profile))return null;
    return job;
  }catch{return null;}
}
export function queries(profile) {
  // Three alternative directions per run; all configured terms still participate in filtering.
  const clean=s=>s.replace(/["<>]/g,' ').replace(/\b(site|filetype|inurl):/gi,'').trim();
  return terms(profile.keywords).slice(0,3).map(t=>
    ['site:linkedin.com/jobs/view/',`"${clean(t)}"`,terms(profile.location).map(clean).join(' OR '),profile.remote?'remote':''].filter(Boolean).join(' ').slice(0,600));
}
export async function webSearch(env,query,offset,fetcher=fetch) {
  const url=new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q',query);url.searchParams.set('count','20');url.searchParams.set('offset',String(offset));
  url.searchParams.set('extra_snippets','true');url.searchParams.set('freshness','pm');
  const response=await fetcher(url,{headers:{Accept:'application/json','X-Subscription-Token':env.BRAVE_SEARCH_API_KEY},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`搜索服务返回 HTTP ${response.status}，请检查 API 额度与密钥配置。`);
  const body=await response.json();
  if(!body||typeof body!=='object'||!body.web||!Array.isArray(body.web.results)) {
    if(body?.query&&body?.web===undefined)return [];
    throw new Error('搜索服务响应格式异常');
  }
  return body.web.results;
}
