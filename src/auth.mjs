// Anonymous browser workspaces use a 256-bit capability key, never a public ID.
// The original key stays in the browser; D1 stores only a one-way derived ID.
export async function workspaceForRequest(request) {
  const authorization=request.headers.get('authorization')||'';
  const match=authorization.match(/^Bearer (cf_[A-Za-z0-9_-]{43})$/);
  if(!match)return null;
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('careerflow-workspace-v1:'+match[1]));
  return 'browser_'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
