import {cleanText, DAILY_LIMIT, localDay, TIMEZONE} from './rules.mjs';
export function searchReady(env) {
  return env.SEARCH_ENABLED === '1' && !!env.BRAVE_SEARCH_API_KEY && !env.BRAVE_SEARCH_API_KEY.startsWith('replace_');
}
export async function dashboard(env, id) {
  const db=env.DB;
  const [profile,jobs,history,count]=await Promise.all([
    db.prepare('SELECT * FROM search_profiles WHERE user_id=?').bind(id).first(),
    db.prepare("SELECT * FROM daily_jobs WHERE user_id=? AND status!='dismissed' ORDER BY discovered_at DESC LIMIT 300").bind(id).all(),
    db.prepare('SELECT * FROM search_runs WHERE user_id=? ORDER BY day DESC LIMIT 7').bind(id).all(),
    db.prepare('SELECT COUNT(*) AS n FROM daily_jobs WHERE user_id=? AND day=?').bind(id,localDay()).first()
  ]);
  return {workspaceReady:true,userId:id,profile,jobs:jobs.results,history:history.results,todayAdded:count.n,
    scheduleReady:searchReady(env),dailyLimit:DAILY_LIMIT,timezone:TIMEZONE,scheduledTime:'09:00 起分批'};
}
export async function saveProfile(env, id, data) {
  const keywords=cleanText(data.keywords,'岗位关键词',300),location=cleanText(data.location,'地点',160,false),excluded=cleanText(data.excluded,'排除关键词',300,false);
  if(typeof data.enabled!=='boolean'||typeof data.remote!=='boolean')throw new Error('开关必须为布尔值');
  await env.DB.prepare(`INSERT INTO search_profiles (user_id,keywords,location,excluded,remote,enabled,revision,updated_at)
    VALUES (?,?,?,?,?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET keywords=excluded.keywords,location=excluded.location,
    excluded=excluded.excluded,remote=excluded.remote,enabled=excluded.enabled,revision=search_profiles.revision+1,updated_at=excluded.updated_at`)
    .bind(id,keywords,location,excluded,+data.remote,+data.enabled,new Date().toISOString()).run();
  return dashboard(env,id);
}
export async function reserveSearch(env,day) {
  const parsed=Number(env.DAILY_SEARCH_BUDGET||300);
  const budget=Number.isSafeInteger(parsed)&&parsed>0?Math.min(parsed,100000):300;
  const r=await env.DB.prepare(`INSERT INTO search_budget(day,requests) VALUES (?,1)
    ON CONFLICT(day) DO UPDATE SET requests=requests+1 WHERE requests<?`).bind(day,budget).run();
  return r.meta.changes>0;
}
export async function claim(env,profile,day,now) {
  const token=crypto.randomUUID(),until=new Date(now.getTime()+10*60000).toISOString();
  const r=await env.DB.prepare(`INSERT INTO scheduler_claims(user_id,day,state,token,lease_until,attempts)
    VALUES (?,?,'running',?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET state='running',token=excluded.token,
    lease_until=excluded.lease_until,attempts=attempts+1
    WHERE scheduler_claims.state!='done' AND scheduler_claims.lease_until<=? AND scheduler_claims.attempts<2`)
    .bind(profile.user_id,day,token,until,now.toISOString()).run();
  return r.meta.changes?token:null;
}
export async function recordJobs(env,p,day,token,jobs,now) {
  // Quota, preference revision and lease ownership are checked in the same SQL write.
  const statements=jobs.map(j=>env.DB.prepare(`INSERT OR IGNORE INTO daily_jobs
    (id,user_id,linkedin_id,title,company,location,url,description,verification,published_at,discovered_at,day,status,search_revision)
    SELECT ?,?,?,?,?,?,?,?,'search_result',NULL,?,?,'draft',?
    WHERE (SELECT COUNT(*) FROM daily_jobs WHERE user_id=? AND day=?)<10
    AND EXISTS(SELECT 1 FROM search_profiles WHERE user_id=? AND enabled=1 AND revision=?)
    AND EXISTS(SELECT 1 FROM scheduler_claims WHERE user_id=? AND day=? AND token=? AND state='running' AND lease_until>?)`)
    .bind(crypto.randomUUID(),p.user_id,j.linkedinId,j.title,j.company,j.location,j.url,j.description,now.toISOString(),day,p.revision,
      p.user_id,day,p.user_id,p.revision,p.user_id,day,token,now.toISOString()));
  if(statements.length)await env.DB.batch(statements);
}
export async function finish(env,p,day,token,error,now) {
  const count=await env.DB.prepare('SELECT COUNT(*) AS n FROM daily_jobs WHERE user_id=? AND day=?').bind(p.user_id,day).first();
  const status=error?'error':count.n>=10?'completed':count.n?'partial':'no_matches';
  const summary=error||`公开搜索完成，新增 ${count.n} 个；未凑数。搜索摘要可能滞后，请申请前核对原页面。`;
  const lease=new Date(now.getTime()+15*60000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO search_runs(id,user_id,day,checked_at,status,added,summary)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM scheduler_claims WHERE user_id=? AND day=? AND token=? AND state='running')
      ON CONFLICT(user_id,day) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,added=excluded.added,summary=excluded.summary`)
      .bind(p.user_id+':'+day,p.user_id,day,now.toISOString(),status,count.n,summary,p.user_id,day,token),
    env.DB.prepare('UPDATE scheduler_claims SET state=?,lease_until=? WHERE user_id=? AND day=? AND token=?')
      .bind(error?'failed':'done',lease,p.user_id,day,token)
  ]);
  return {status,added:count.n};
}
