export const DAILY_LIMIT = 10;
export const TIMEZONE = 'Asia/Kuala_Lumpur';
export function localDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function normalizeLinkedIn(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !/(^|\.)linkedin\.com$/.test(u.hostname) || u.username || u.password || u.port) throw new Error('只接受 LinkedIn 的 HTTPS 岗位链接');
  const match = u.pathname.match(/^\/jobs\/view\/(?:[^/]*-)?(\d{6,20})\/?$/);
  if (!match) throw new Error('链接中缺少有效的 LinkedIn 岗位 ID');
  return {id:match[1],url:`https://www.linkedin.com/jobs/view/${match[1]}/`};
}
export function cleanText(value, name, max, required=true) {
  if (typeof value !== 'string' || value.length > max || (required&&!value.trim())) throw new Error(`${name}格式不正确`);
  return value.trim();
}
export function validateJob(value) {
  if (!value || typeof value!=='object') throw new Error('岗位格式不正确');
  const link=normalizeLinkedIn(value.url);
  if(!['page','search_result'].includes(value.verification))throw new Error('必须注明信息验证来源');
  const publishedAt=value.published_at||null;
  if(publishedAt&&(!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)||Number.isNaN(Date.parse(publishedAt))))throw new Error('发布日期格式不正确');
  return {linkedinId:link.id,url:link.url,title:cleanText(value.title,'岗位名称',160),company:cleanText(value.company,'公司名称',160),location:cleanText(value.location,'地点',160),description:cleanText(value.description,'岗位摘要',2500),verification:value.verification,publishedAt};
}
export function selectionIssue(job, profile) {
  const content=`${job.title} ${job.company} ${job.description}`.toLowerCase();
  const blocked=profile.excluded.split(/[,，\n]/).map(s=>s.trim().toLowerCase()).filter(Boolean);
  return blocked.some(word=>content.includes(word))?'岗位命中排除关键词':null;
}
