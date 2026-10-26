import {localDay,TIMEZONE} from './rules.mjs';
import {searchReady,reserveSearch,claim,recordJobs,finish} from './db.mjs';
import {queries,parseResult,webSearch} from './search.mjs';
export async function runScheduled(env,{now=new Date(),fetcher=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  if(!searchReady(env))return {state:'not_configured',processed:0};
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:TIMEZONE,hour:'2-digit',hourCycle:'h23'}).format(now));
  if(hour<9)return {state:'before_window',processed:0};
  const day=localDay(now);
  // Bounded batches leave room for API timeouts and DB work; later ticks resume pending users.
  const profiles=await env.DB.prepare(`SELECT p.* FROM search_profiles p LEFT JOIN scheduler_claims c
    ON c.user_id=p.user_id AND c.day=? WHERE p.enabled=1 AND
    (c.user_id IS NULL OR (c.state!='done' AND c.lease_until<=? AND c.attempts<2))
    ORDER BY COALESCE(c.attempts,0),p.updated_at,p.user_id LIMIT 2`).bind(day,now.toISOString()).all();
  let processed=0;
  for(const p of profiles.results) {
    const token=await claim(env,p,day,now);if(!token)continue;
    let error=null;
    try {
      const old=await env.DB.prepare('SELECT linkedin_id FROM daily_jobs WHERE user_id=?').bind(p.user_id).all();
      const seen=new Set(old.results.map(j=>j.linkedin_id)),list=[];
      const variants=queries(p);if(!variants.length)throw new Error('请保存至少一个岗位关键词。');
      for(let i=0;i<3&&list.length<10;i++) {
        const current=await env.DB.prepare('SELECT enabled,revision FROM search_profiles WHERE user_id=?').bind(p.user_id).first();
        if(!current?.enabled||current.revision!==p.revision)throw new Error('偏好已更改或检索已暂停；本次结果未继续录入。');
        if(!await reserveSearch(env,day))throw new Error('本站今日搜索额度已用完；请管理员调整预算或等待明天。');
        if(i)await sleep(1100);
        const results=await webSearch(env,variants[i%variants.length],Math.floor(i/variants.length),fetcher);
        for(const r of results) {
          const job=parseResult(r,p);if(!job||seen.has(job.linkedinId))continue;
          seen.add(job.linkedinId);list.push(job);if(list.length===10)break;
        }
      }
      await recordJobs(env,p,day,token,list,now);
    }catch(e) {
      error=e.name==='TimeoutError'?'搜索服务超时，将在后续批次重试。':
        /^搜索服务|^本站今日|^偏好已|^请保存/.test(e.message)?e.message:'检索暂时失败，将在后续批次重试。';
    }
    await finish(env,p,day,token,error,now);processed++;
  }
  return {state:'complete',processed};
}
