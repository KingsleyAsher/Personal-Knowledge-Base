import {createServer} from 'node:http';import path from 'node:path';import {atomic,readJson,error} from './io.js';
export async function startClipper({privateDir,dispatch}){
 const file=path.join(privateDir,'clipper-endpoint.json'),prior=await readJson(file,null);let port;
 const json=(res,status,value)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
 const server=createServer(async(req,res)=>{
  const origin=String(req.headers.origin??'');if(req.headers.host!=='127.0.0.1:'+port||req.url!=='/kb-core/clip'||!/^chrome-extension:\/\/[a-p]{32}$/.test(origin))return json(res,403,{ok:false,error:'只允许已配对扩展访问剪藏接口'});
  res.setHeader('access-control-allow-origin',origin);res.setHeader('vary','Origin');if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-methods':'POST','access-control-allow-headers':'content-type, authorization','access-control-max-age':'600'});return res.end();}
  if(req.method!=='POST'||String(req.headers['content-type']??'').split(';')[0]!=='application/json')return json(res,403,{ok:false});
  try{const chunks=[];let size=0;for await(const part of req){size+=part.length;if(size>900000)throw error('BAD_REQUEST','剪藏内容过大');chunks.push(part);}const body=JSON.parse(Buffer.concat(chunks).toString('utf8')),out=await dispatch({origin,code:body.code,token:String(req.headers.authorization??'').replace(/^Bearer /,''),item:body.item});json(res,200,{ok:true,...out});}
  catch(e){json(res,e.code==='CLIPPER_UNAUTHORIZED'?401:400,{ok:false,error:e.code?e.message:'剪藏未完成，请重试'});}
 });
 const listen=p=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(p,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
 try{await listen(Number.isInteger(prior?.port)?prior.port:0);}catch(e){if(e.code!=='EADDRINUSE')throw e;await listen(0);}port=server.address().port;const endpoint='http://127.0.0.1:'+port;await atomic(file,{port,endpoint});
 return {endpoint,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
