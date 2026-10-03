import {createServer,request} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const publicRoot=resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const port=Number(process.env.HQ_PORT??8788);
const runtimePort=Number(process.env.HQ_RUNTIME_PORT??port+1);
if(![port,runtimePort].every(p=>Number.isSafeInteger(p)&&p>0&&p<=65535)||port===runtimePort)throw new Error('Use distinct valid HQ_PORT and HQ_RUNTIME_PORT');
// The existing authoritative application stays unchanged. This host serves its desktop view.
try{await stat(resolve(repo,'apps/control-centre/dist/index.html'));}
catch{execFileSync(process.execPath,['apps/control-centre/build.mjs'],{cwd:repo,stdio:'inherit'});}
const backend=spawn(process.execPath,['apps/control-centre/src/main.ts'],{cwd:repo,env:{...process.env,HQ_PORT:String(runtimePort)},stdio:'inherit',windowsHide:true});
let closing=false;
backend.on('exit',code=>{if(!closing){console.error('Runtime host stopped.');process.exit(code??1);}});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'};
function upstream(req,res,path,root=false,bytes){
 const headers={...req.headers,host:'127.0.0.1:'+runtimePort};
 if(headers.origin)headers.origin='http://127.0.0.1:'+runtimePort;
 delete headers.connection;
 const out=request({hostname:'127.0.0.1',port:runtimePort,path,method:root?'GET':req.method,headers},incoming=>{
  if(root){const cookie=incoming.headers['set-cookie'];if(cookie)res.setHeader('Set-Cookie',cookie);incoming.resume();res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(bytes);}
  else{res.writeHead(incoming.statusCode??502,incoming.headers);incoming.pipe(res);res.on('close',()=>incoming.destroy());}
 });
 out.on('error',()=>{if(!res.headersSent)res.writeHead(503,{'Content-Type':'text/plain'});res.end('Runtime starting or unavailable. Refresh the Station in a moment.');});
 req.on('aborted',()=>out.destroy());
 if(root)out.end();else req.pipe(out);
}
const server=createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 const host='127.0.0.1:'+port;
 if(req.headers.host!==host||req.headers.origin&&req.headers.origin!=='http://'+host||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403).end('Invalid local origin');return;}
 const url=new URL(req.url,'http://'+host);
 if(url.pathname.startsWith('/api/')){upstream(req,res,req.url);return;}
 if(req.method!=='GET'){res.writeHead(405).end();return;}
 try{
  const name=decodeURIComponent(url.pathname)==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
  const path=resolve(publicRoot,name);
  if(!path.startsWith(publicRoot+sep)||!mime[extname(path)]||name.split(/[\\/]/).some(p=>p.startsWith('.'))){res.writeHead(404).end();return;}
  const bytes=await readFile(path);
  if(name==='index.html'){upstream(req,res,'/',true,bytes);return;}
  res.writeHead(200,{'Content-Type':mime[extname(path)]});res.end(bytes);
 }catch{res.writeHead(404).end();}
});
server.listen(port,'127.0.0.1',()=>console.log('HQOverlord Living Station: http://127.0.0.1:'+port));
function close(){if(closing)return;closing=true;backend.kill();server.close();setTimeout(()=>process.exit(0),500).unref();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,close);
process.on('exit',()=>backend.kill());
