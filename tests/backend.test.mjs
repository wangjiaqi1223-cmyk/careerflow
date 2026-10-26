import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/index.mjs';
import {runScheduled} from '../src/scheduler.mjs';
import {saveProfile,claim,recordJobs,reserveSearch} from '../src/db.mjs';
import {parseResult} from '../src/search.mjs';
import {normalizeLinkedIn,localDay} from '../src/rules.mjs';
function environment() {
 const sql=new DatabaseSync(':memory:');
 for(const file of ['0001_initial.sql','0002_scheduler.sql'])sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const wrap=(q,args=[])=>({bind(...v){return wrap(q,v)},async first(){return sql.prepare(q).get(...args)||null},async all(){return {results:sql.prepare(q).all(...args)}},async run(){const r=sql.prepare(q).run(...args);return {meta:{changes:Number(r.changes)}}}});
 const DB={prepare:wrap,async batch(stmts){sql.exec('BEGIN');try{const result=[];for(const stmt of stmts)result.push(await stmt.run());sql.exec('COMMIT');return result}catch(e){sql.exec('ROLLBACK');throw e}}};
 return {DB,sql,SEARCH_ENABLED:'1',BRAVE_SEARCH_API_KEY:'synthetic-test-key',DAILY_SEARCH_BUDGET:'300',ASSETS:{fetch:()=>new Response('asset')}};
}
const prefs={keywords:'Product Designer',location:'Singapore',excluded:'Intern',remote:false,enabled:true};
const now=new Date('2026-10-26T02:00:00Z');
const result=(i=0)=>({url:`https://sg.linkedin.com/jobs/view/product-designer-${1234567890+i}?tracking=x`,title:'Example Company hiring Product Designer in Singapore | LinkedIn',description:'Synthetic fixture: work with a product design team.'});
const fake=async()=>Response.json({web:{results:Array.from({length:20},(_,i)=>result(i))}});
const execute=(env,opts={})=>runScheduled(env,{now,fetcher:fake,sleep:async()=>{},...opts});
test('filters actual LinkedIn URLs, title, location, exclusions and explicit remote',()=>{
 assert.ok(parseResult(result(),prefs));
 assert.equal(parseResult({...result(),title:'Unknown page'},prefs),null);
 assert.equal(parseResult({...result(),url:'https://linkedin.com.evil.test/jobs/view/1234567890'},prefs),null);
 assert.equal(parseResult({...result(),title:'Company hiring Product Designer Intern in Singapore | LinkedIn'},prefs),null);
 assert.equal(parseResult(result(),{...prefs,location:'Malaysia'}),null);
 assert.equal(parseResult(result(),{...prefs,keywords:'Data Engineer'}),null);
 assert.equal(parseResult(result(),{...prefs,remote:true}),null);
 assert.ok(parseResult({...result(),title:'Company hiring Product Designer in Singapore (Remote) | LinkedIn'},{...prefs,remote:true}));
 assert.equal(parseResult({...result(),description:'No longer accepting applications'},prefs),null);
 assert.equal(normalizeLinkedIn(result().url).url,'https://www.linkedin.com/jobs/view/1234567890/');
 assert.equal(localDay(new Date('2026-10-26T17:00:00Z')),'2026-10-27');
});
test('daily execution caps at 10, repeat tick does not spend or duplicate, each user isolated',async()=>{
 const env=environment();await saveProfile(env,'alice',prefs);await saveProfile(env,'bob',prefs);
 assert.equal((await execute(env)).processed,2);
 assert.equal(env.sql.prepare('SELECT COUNT(*) AS n FROM daily_jobs').get().n,20);
 assert.equal((await execute(env)).processed,0);
 assert.equal(env.sql.prepare('SELECT requests FROM search_budget').get().requests,2);
 const tomorrow=new Date('2026-10-27T02:00:00Z');await execute(env,{now:tomorrow});
 assert.equal(env.sql.prepare('SELECT COUNT(*) AS n FROM daily_jobs').get().n,40);
 await execute(env,{now:new Date('2026-10-28T02:00:00Z')});
 assert.equal(env.sql.prepare('SELECT COUNT(*) AS n FROM daily_jobs').get().n,40);
 assert.equal(env.sql.prepare("SELECT status FROM search_runs WHERE user_id='alice' AND day='2026-10-28'").get().status,'no_matches');
});
test('same-time claims cannot run one workspace twice',async()=>{
 const env=environment();await saveProfile(env,'alice',prefs);
 await Promise.all([execute(env),execute(env)]);
 assert.equal(env.sql.prepare('SELECT COUNT(*) AS n FROM daily_jobs').get().n,10);
 assert.equal(env.sql.prepare('SELECT requests FROM search_budget').get().requests,1);
});
test('pause or changed preference while search is running prevents insertion',async()=>{
 for(const update of [{enabled:false},{keywords:'Engineer'}]) {
  const env=environment();await saveProfile(env,'alice',prefs);
  await execute(env,{fetcher:async()=>{await saveProfile(env,'alice',{...prefs,...update});return fake()}});
  assert.equal(env.sql.prepare('SELECT COUNT(*) AS n FROM daily_jobs').get().n,0);
 }
});
test('SQL enforces quota, lease ownership and revision even for excessive candidates',async()=>{
 const env=environment();await saveProfile(env,'alice',prefs);
 const p=env.sql.prepare('SELECT * FROM search_profiles').get();const day=localDay(now);
 const token=await claim(env,p,day,now);const jobs=Array.from({length:25},(_,i)=>parseResult(result(i),prefs));
 await recordJobs(env,p,day,'wrong',jobs,now);
 assert.equal(env.sql.prepare('SELECT COUNT(*) AS n FROM daily_jobs').get().n,0);
 await recordJobs(env,p,day,token,jobs,now);await recordJobs(env,p,day,token,jobs,now);
 assert.equal(env.sql.prepare('SELECT COUNT(*) AS n FROM daily_jobs').get().n,10);
});
test('API failure is visible, retries bounded and preserves empty real queue',async()=>{
 const env=environment();await saveProfile(env,'alice',prefs);
 const bad=async()=>new Response('provider unavailable',{status:429});
 await execute(env,{fetcher:bad});assert.equal(env.sql.prepare('SELECT status FROM search_runs').get().status,'error');
 assert.equal((await execute(env,{fetcher:bad})).processed,0);
 await execute(env,{now:new Date(now.getTime()+16*60000),fetcher:bad});
 assert.equal((await execute(env,{now:new Date(now.getTime()+32*60000),fetcher:bad})).processed,0);
 assert.equal(env.sql.prepare('SELECT COUNT(*) AS n FROM daily_jobs').get().n,0);
});
test('shared daily budget cannot be exceeded and disabled scheduler makes no calls',async()=>{
 const env=environment();env.DAILY_SEARCH_BUDGET='1';
 const r=await Promise.all([reserveSearch(env,'2026-10-26'),reserveSearch(env,'2026-10-26')]);
 assert.equal(r.filter(Boolean).length,1);
 env.SEARCH_ENABLED='0';assert.equal((await execute(env)).state,'not_configured');
 env.SEARCH_ENABLED='1';assert.equal((await execute(env,{now:new Date('2026-10-26T00:00:00Z')})).state,'before_window');
});
test('visitor APIs use browser capabilities, isolate queues and reject cross-origin mutation',async()=>{
 const env=environment(),url='https://careerflow.test/api/daily';
 const headers={'Authorization':'Bearer cf_'+'a'.repeat(43),'Content-Type':'application/json','Origin':'https://careerflow.test'};
 assert.equal((await worker.fetch(new Request(url),env)).status,401);
 const saved=await worker.fetch(new Request(url,{method:'POST',headers,body:JSON.stringify(prefs)}),env);assert.equal(saved.status,200);
 const first=await saved.json();assert.match(first.userId,/^browser_/);
 const second=await worker.fetch(new Request(url,{headers:{Authorization:'Bearer cf_'+'b'.repeat(43)}}),env);
 assert.equal((await second.json()).profile,null);
 const bad=await worker.fetch(new Request(url,{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:JSON.stringify(prefs)}),env);assert.equal(bad.status,403);
 const update=await worker.fetch(new Request(url,{method:'PATCH',headers,body:JSON.stringify({id:'not-owned',status:'dismissed'})}),env);assert.equal(update.status,404);
 assert.equal((await worker.fetch(new Request(url,{headers:{Authorization:'Bearer '+first.userId}}),env)).status,401);
});
