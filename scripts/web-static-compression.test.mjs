import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {brotliDecompressSync, gunzipSync} from 'node:zlib';
import {webServer} from './web-server.mjs';
import {containerEnvironment} from './web-container.mjs';
const source=Buffer.from('const message = "synthetic static asset";\n'.repeat(4096));
async function running(t) {
 const root=await mkdtemp(join(tmpdir(),'solveflow-static-'));
 for(const name of ['index.html','asset.js','asset.css','heic-codec-1-23-5.js','photo.png'])await writeFile(join(root,name),source);
 await writeFile(join(root,'small.js'),'small');
 const profile={provider:'fixture',baseURL:'https://fixture.invalid/v1',model:'synthetic',api:'openai-completions',contextWindow:32768,maxTokens:1024,maxTokensField:'max_tokens'};
 const environment=containerEnvironment({schemaVersion:1,models:{solver:profile,verifier:null,backup:null},keys:{solver:'synthetic-only',verifier:null,backup:null}});
 const server=webServer(root,null,environment,async()=>{throw new Error('UNEXPECTED_MODEL_CALL');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true});});
 return {url:`http://127.0.0.1:${server.address().port}`,server};
}
function raw(url,headers={},method='GET') {return new Promise((resolve,reject)=>{const req=request(url,{method,headers},res=>{const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts)}));res.on('error',reject);});req.on('error',reject);req.end();});}
for(const encoding of ['br','gzip'])test(`public static ${encoding} decodes exactly and advertises a cache variant`,async t=>{
 const {url}=await running(t);const result=await raw(url+'/asset.js',{'accept-encoding':encoding});
 assert.equal(result.status,200);assert.equal(result.headers['content-encoding'],encoding);assert.equal(result.headers.vary,'Accept-Encoding');assert.equal(result.headers['content-length'],undefined);
 assert.deepEqual(encoding==='br'?brotliDecompressSync(result.body):gunzipSync(result.body),source);assert.ok(result.body.length<source.length/2);assert.equal(result.headers['cache-control'],'no-cache');
});
test('negotiation respects explicit refusals and relative encoding quality',async t=>{
 const {url}=await running(t);
 for(const [accept,expected] of [['br;q=0,gzip;q=0.5','gzip'],['gzip;q=1,br;q=0.2','gzip'],['identity;q=1,br;q=0.5',undefined],['br;q=0,gzip;q=0',undefined],['*;q=0',undefined]]) {
  const response=await raw(url+'/asset.css',{'accept-encoding':accept});assert.equal(response.headers['content-encoding'],expected);assert.equal(response.headers.vary,'Accept-Encoding');
  if(!expected)assert.deepEqual(response.body,source);
 }
});
test('compressed HEAD has no body and keeps codec immutable caching',async t=>{
 const {url}=await running(t);const result=await raw(url+'/heic-codec-1-23-5.js',{'accept-encoding':'br'},'HEAD');
 assert.equal(result.headers['content-encoding'],'br');assert.equal(result.headers['content-length'],undefined);assert.equal(result.body.length,0);assert.equal(result.headers['cache-control'],'public, max-age=31536000, immutable');
});
test('private environment responses, binary images and small files stay uncompressed',async t=>{
 const {url}=await running(t);
 for(const path of ['/__solveflow/web-env','/photo.png','/small.js']) {const result=await raw(url+path,{'accept-encoding':'br,gzip'});assert.equal(result.status,200);assert.equal(result.headers['content-encoding'],undefined);}
 const env=await raw(url+'/__solveflow/web-env',{'accept-encoding':'br'});assert.equal(env.headers['cache-control'],'no-store');assert.equal(JSON.stringify(JSON.parse(env.body)).includes('synthetic-only'),false);
});
test('aborting a compressed download leaves the server able to serve another request',async t=>{
 const {url}=await running(t);
 await new Promise((resolve,reject)=>{const req=request(url+'/asset.js',{'headers':{'accept-encoding':'br'}},res=>{res.once('data',()=>{res.destroy();resolve();});res.on('error',()=>{});});req.on('error',reject);req.end();});
 const next=await raw(url+'/asset.js');assert.equal(next.status,200);assert.deepEqual(next.body,source);
});
