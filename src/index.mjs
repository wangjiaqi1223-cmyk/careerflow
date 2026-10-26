import {workspaceForRequest} from './auth.mjs';
import {dashboard,saveProfile} from './db.mjs';
import {runScheduled} from './scheduler.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','Vary':'Authorization','X-Content-Type-Options':'nosniff'}});
async function body(request) {
  if(!request.headers.get('content-type')?.includes('application/json'))throw new Error('需要 JSON 格式');
  const reader=request.body?.getReader();if(!reader)throw new Error('请求为空');
  let size=0;const chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw new Error('请求过大');}chunks.push(value);}
  const bytes=new Uint8Array(size);let cursor=0;for(const chunk of chunks){bytes.set(chunk,cursor);cursor+=chunk.length;}
  const data=JSON.parse(new TextDecoder().decode(bytes));if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('无效请求');return data;
}
export default {
  async fetch(request,env) {
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
    if(url.pathname!='/api/daily')return json({error:'接口不存在'},404);
    if(!['GET','POST','PATCH'].includes(request.method))return json({error:'不支持此方法'},405);
    if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)return json({error:'请求来源不正确'},403);
    const id=await workspaceForRequest(request);if(!id)return json({error:'缺少浏览器工作空间凭据'},401);
    try {
      if(request.method==='GET')return json(await dashboard(env,id));
      const data=await body(request);
      if(request.method==='POST')return json(await saveProfile(env,id,data));
      if(typeof data.id!=='string'||data.id.length>100||!['draft','ready','manual','sent','failed','uncertain','dismissed'].includes(data.status))return json({error:'状态不正确'},400);
      const result=await env.DB.prepare('UPDATE daily_jobs SET status=? WHERE id=? AND user_id=?').bind(data.status,data.id,id).run();
      return result.meta.changes?json({ok:true}):json({error:'未找到此岗位'},404);
    }catch(error) {
      if(/格式|请求|开关/.test(error.message))return json({error:error.message},400);
      return json({error:'后台暂不可用，请检查数据库配置后重试'},503);
    }
  },
  async scheduled(event,env,ctx) {
    ctx.waitUntil(runScheduled(env).then(result=>console.log(JSON.stringify({event:'careerflow_scheduler',...result}))));
  }
};
