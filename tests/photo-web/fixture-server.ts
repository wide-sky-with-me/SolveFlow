import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { SolveOutcomeSchema, makeSafeAgentError } from '../../packages/contracts/dist/agent.js';
import { createPhotoHandler, type PhotoServiceOptions } from '../../apps/photo-web/src/server/service.js';
import { PhotoAuth } from '../../apps/photo-web/src/server/auth.js';
import { PhotoLedger } from '../../apps/photo-web/src/server/ledger.js';
const dir = await mkdtemp(resolve(tmpdir(), 'solveflow-photo-fixture-')); let calls = 0, cancellations = 0;
let nextOutcome = 'answer';
const events: {at:number;kind:string;path?:string;requestId?:string;status?:number;mode?:string}[]=[];
function trace(event: Omit<(typeof events)[number],'at'>) { events.push({at:Date.now(),...event});if(events.length>2000)events.splice(0,1000); }
const keys = ['synthetic-photo-first-key-only', 'synthetic-photo-second-key-only'];
const config: PhotoServiceOptions = { origin:'http://127.0.0.1', auth:new PhotoAuth(keys.map((key,i)=>({id:`test-${i}`,hash:createHash('sha256').update(key).digest('hex')})), 'synthetic-browser-hmac-secret-only',false),ledger:new PhotoLedger(resolve(dir,'ledger.json')),publicDir:resolve('apps/photo-web/dist/public'),jobDir:resolve(dir,'jobs'),
  async solve(request,_account,signal,onEvent) {
    const mode=nextOutcome;nextOutcome='answer';
    trace({kind:'solve-start',requestId:request.requestId,mode});
    calls++;onEvent({schemaVersion:1,runId:request.requestId,type:'run.status',status:'solving'});
    await new Promise<void>(resolve=>{const cancel=()=>{clearTimeout(timer);cancellations++;resolve();};const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},1500);if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});});
    trace({kind:signal.aborted?'solve-cancelled':'solve-finished',requestId:request.requestId,mode});
    if(mode==='failed')return SolveOutcomeSchema.parse({schemaVersion:1,status:'failed',verified:false,error:makeSafeAgentError('MODEL_UNAVAILABLE',request.requestId)});
    if(mode==='clarification')return SolveOutcomeSchema.parse({schemaVersion:1,status:'needs_clarification',verified:false,candidate:{schemaVersion:1,kind:'clarification',problem:{text:'Synthetic question is missing its options.',subject:'math',uncertainties:[]},answer:null,steps:[],knowledgePoints:[],citationIds:[],clarificationQuestions:['请重新拍摄完整题目和选项。']}});
    return SolveOutcomeSchema.parse({schemaVersion:1,status:'completed',verified:false,verificationStatus:'not_requested',verification:null,warning:null,candidate:{schemaVersion:1,kind:'answer',problem:{text:'Synthetic question: what is $2+2$?',subject:'math',uncertainties:[],options:[{label:'A',text:'3'},{label:'B',text:'4'}],sourceNumber:'8'},answer:'The answer is **B**. $2+2=4$.',selectedOptions:['B'],steps:[],knowledgePoints:[],citationIds:[],clarificationQuestions:[]}});
  },
};
const handler=createPhotoHandler(config);
const server=createServer((req,res)=>{if(req.url==='/__test-state'){res.setHeader('content-type','application/json');res.end(JSON.stringify({calls,cancellations,events}));return;}const plan=/^\/__test-outcome\?mode=(answer|failed|clarification)$/.exec(req.url??'');if(plan&&req.method==='POST'){nextOutcome=plan[1]!;res.end('{}');return;}if(req.url?.startsWith('/api/jobs')){const path=req.url;trace({kind:'http-start',path});res.once('finish',()=>trace({kind:'http-finished',path,status:res.statusCode}));}void handler(req,res);});
server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address||typeof address==='string')throw new Error('NO_PORT');config.origin=`http://127.0.0.1:${address.port}`;console.log(JSON.stringify({url:config.origin,pid:process.pid}));});
process.once('SIGTERM',()=>{void handler.close().finally(()=>{server.closeAllConnections();server.close(()=>{void rm(dir,{recursive:true,force:true});});});});
