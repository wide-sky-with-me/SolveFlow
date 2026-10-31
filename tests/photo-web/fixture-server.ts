import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { SolveOutcomeSchema } from '../../packages/contracts/dist/agent.js';
import { createPhotoHandler, type PhotoServiceOptions } from '../../apps/photo-web/src/server/service.js';
import { PhotoAuth } from '../../apps/photo-web/src/server/auth.js';
import { PhotoLedger } from '../../apps/photo-web/src/server/ledger.js';
const dir = await mkdtemp(resolve(tmpdir(), 'solveflow-photo-fixture-')); let calls = 0, cancellations = 0;
const keys = ['synthetic-photo-first-key-only', 'synthetic-photo-second-key-only'];
const config: PhotoServiceOptions = { origin:'http://127.0.0.1', auth:new PhotoAuth(keys.map((key,i)=>({id:`test-${i}`,hash:createHash('sha256').update(key).digest('hex')})), 'synthetic-browser-hmac-secret-only',false),ledger:new PhotoLedger(resolve(dir,'ledger.json')),publicDir:resolve('apps/photo-web/dist/public'),
  async solve(request,_account,signal,onEvent) {
    calls++;onEvent({schemaVersion:1,runId:request.requestId,type:'run.status',status:'solving'});
    await new Promise<void>(resolve=>{const cancel=()=>{clearTimeout(timer);cancellations++;resolve();};const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},1500);if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});});
    return SolveOutcomeSchema.parse({schemaVersion:1,status:'completed',verified:false,verificationStatus:'not_requested',verification:null,warning:null,candidate:{schemaVersion:1,kind:'answer',problem:{text:'Synthetic question: what is $2+2$?',subject:'math',uncertainties:[],options:[{label:'A',text:'3'},{label:'B',text:'4'}],sourceNumber:'8'},answer:'The answer is **B**. $2+2=4$.',selectedOptions:['B'],steps:[],knowledgePoints:[],citationIds:[],clarificationQuestions:[]}});
  },
};
const handler=createPhotoHandler(config);
const server=createServer((req,res)=>{if(req.url==='/__test-state'){res.setHeader('content-type','application/json');res.end(JSON.stringify({calls,cancellations}));return;}void handler(req,res);});
server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address||typeof address==='string')throw new Error('NO_PORT');config.origin=`http://127.0.0.1:${address.port}`;console.log(JSON.stringify({url:config.origin,pid:process.pid}));});
process.once('SIGTERM',()=>{server.closeAllConnections();server.close(()=>{void rm(dir,{recursive:true,force:true});});});
