import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Storage } from './storage.mjs';
import { CounterEngine } from './engine.mjs';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const STATIC=new Map([['/',['index.html','text/html']],['/overlay',['overlay.html','text/html']],['/app.css',['app.css','text/css']],['/app.js',['app.js','text/javascript']],['/overlay.css',['overlay.css','text/css']],['/overlay.js',['overlay.js','text/javascript']]]);
const securityHeaders={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
};
function json(res,status,payload) {res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...securityHeaders});res.end(JSON.stringify(payload));}
async function readBody(req) {
  let size=0;const chunks=[];
  for await(const chunk of req) {size+=chunk.length;if(size>16384) throw new Error('body');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
export function createServer(engine,{port=3791,root=ROOT}={}) {
  const streams=new Set();
  const publish=state=>{for(const res of streams) {if(res.writableLength>262144) {res.destroy();streams.delete(res);} else res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);}};
  engine.on('state',publish);
  const heartbeat=setInterval(()=>{for(const res of streams) res.write(': heartbeat\n\n');},15000);heartbeat.unref();
  const server=http.createServer(async(req,res)=>{
    const localPort=server.address()?.port ?? port;
    const allowedHosts=[`127.0.0.1:${localPort}`,`localhost:${localPort}`];
    if(!allowedHosts.includes(req.headers.host)) return json(res,403,{error:'Endereço local não autorizado.'});
    if(req.headers.origin && !allowedHosts.some(host=>req.headers.origin===`http://${host}`)) return json(res,403,{error:'Origem não autorizada.'});
    if(req.headers['sec-fetch-site']==='cross-site') return json(res,403,{error:'Acesso externo bloqueado.'});
    let path;
    try {path=new URL(req.url,`http://${req.headers.host}`).pathname;} catch {return json(res,400,{error:'URL inválida.'});}
    try {
      if(req.method==='GET') {
        if(path==='/api/health') return json(res,200,{app:'valorant-wl-counter',ok:true,pid:process.pid,projectRoot:root});
        if(path==='/api/config') return json(res,200,engine.publicConfig());
        if(path==='/api/state') return json(res,200,engine.getState());
        if(path==='/api/events') {
          if(streams.size>=32) return json(res,503,{error:'Muitas conexões de overlay abertas.'});
          res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Connection':'keep-alive',...securityHeaders});
          res.write(`event: state\ndata: ${JSON.stringify(engine.getState())}\n\n`);streams.add(res);res.on('close',()=>streams.delete(res));return;
        }
        if(STATIC.has(path)) {const [file,type]=STATIC.get(path);const content=await readFile(join(root,'public',file));res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`,...securityHeaders});return res.end(content);}
        return json(res,404,{error:'Página não encontrada.'});
      }
      if(req.method!=='POST' || !['/api/config','/api/refresh'].includes(path)) return json(res,405,{error:'Operação não permitida.'});
      if(req.headers['x-requested-with']!=='valorant-wl' || !/^application\/json(?:;|$)/i.test(req.headers['content-type']??'')) return json(res,403,{error:'Use o painel local para alterar a configuração.'});
      let body;try {body=await readBody(req);} catch {return json(res,400,{error:'Dados inválidos ou muito grandes.'});}
      if(path==='/api/config') {
        // Serializing saves also avoids concurrent atomic writes to the same file.
        if(server.saving) return json(res,409,{error:'Aguarde a configuração atual terminar de salvar.'});
        server.saving=true;
        try {const config=await engine.configure(body);json(res,200,config);void engine.refresh().catch(()=>{});}
        catch {json(res,400,{error:'Não foi possível salvar. Confira Riot ID, região, fonte, cores e a proteção de credenciais do Windows.'});}
        finally {server.saving=false;}return;
      }
      return json(res,200,await engine.refresh());
    } catch {if(!res.headersSent) json(res,500,{error:'Não foi possível concluir a operação local.'});else res.end();}
  });
  server.requestTimeout=20000;server.headersTimeout=10000;
  server.on('close',()=>{clearInterval(heartbeat);engine.off('state',publish);for(const res of streams) res.end();});
  server.closeStreams=()=>{for(const res of streams) res.end();streams.clear();};
  return server;
}

export async function main() {
  const storage=new Storage(join(ROOT,'data'));
  const engine=await new CounterEngine(storage).init();
  const server=createServer(engine);
  let loggedStatus='';
  engine.on('state',state=>{
    const label=`${state.day}:${state.status}`;
    if(label!==loggedStatus) {
      loggedStatus=label;
      console.log(`[${new Date().toISOString()}] Contador: ${state.status}.`);
    }
  });
  server.on('error',error=>{console.error(error.code==='EADDRINUSE' ? 'A porta 3791 já está em uso. Abra http://127.0.0.1:3791 ou feche a outra instância.' : 'O servidor local não pôde iniciar. Confira as permissões da pasta.');process.exitCode=1;engine.stop();});
  server.listen(3791,'127.0.0.1',()=>{console.log('Valorant W/L Counter: http://127.0.0.1:3791');console.log('Overlay OBS: http://127.0.0.1:3791/overlay');engine.start();});
  for(const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>{engine.stop();server.closeStreams();server.close(()=>{process.exitCode=0;});});
  return {server,engine};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) main().catch(()=>{console.error('Falha ao iniciar. Verifique o acesso à pasta data.');process.exitCode=1;});
