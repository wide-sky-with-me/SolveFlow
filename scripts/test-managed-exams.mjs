// Decision: .agents/notes/implemented/architecture/2026-11-04-managed-exam-audit-fixes.md
import { spawnSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const image=process.argv.find(value=>value.startsWith('--image='))?.slice(8)??'postgres:17.11-alpine';
if(!/^postgres:17(?:\.\d+)?-alpine(?:[\d.]+)?$/.test(image))throw new Error('POSTGRES_17_TEST_IMAGE_REQUIRED');
const selection=process.argv.find(value=>value.startsWith('--suite='))?.slice(8)??'all';
if(!['all','core','core-ui','core-flow','boundaries','practice','timing','allocations','models','management','answers','visuals'].includes(selection))throw new Error('INVALID_MANAGED_EXAM_SUITE');
const extendedUi='console(?: home| wall)?:|teacher access:|deep review:|notifications:|paging:';
const flowUi='console: (?:workflow:|student flow:|answer choice preview:|mobile refinement:|student status palette:|student rerun:)';
const suites=[{name:'core',group:'core',pattern:'^(?!.*(?:boundary:|'+extendedUi+'))'}, {name:'core-ui',group:'core',pattern:'^(?!.*boundary:)(?!.*(?:'+flowUi+'))(?=.*(?:'+extendedUi+'))'}, {name:'core-flow',group:'core',pattern:'^(?!.*boundary:)(?=.*(?:'+flowUi+'))'}, {name:'boundaries',pattern:'boundary:'},{name:'practice',pattern:'.',file:'practice.integration.test.ts'},{name:'timing',pattern:'.',file:'timing.integration.test.ts'},{name:'allocations',pattern:'.',file:'allocations.integration.test.ts'},{name:'models',pattern:'.',file:'model-services.integration.test.ts'},{name:'management',pattern:'.',file:'exam-management.integration.test.ts'},{name:'answers',pattern:'.',file:'answer-values.integration.test.ts'},{name:'visuals',pattern:'.',file:'ui-polish.integration.test.ts'}].filter(suite=>selection==='all'||(suite.group??suite.name)===selection||suite.name===selection);
// WebKit honors proxy environment variables even for these local HTTP fixtures.
const localBypass=[...new Set([process.env.NO_PROXY??'',process.env.no_proxy??'','127.0.0.1','localhost','::1'].flatMap(value=>value.split(',')).map(value=>value.trim()).filter(Boolean))].join(',');
let activeChild,interrupted=false;
const stop=()=>{interrupted=true;activeChild?.kill('SIGTERM');};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
function docker(args){const result=spawnSync('docker',args,{encoding:'utf8'});if(result.status!==0)throw new Error('ISOLATED_DOCKER_COMMAND_FAILED');return result.stdout.trim();}

// Each suite retains the original 180-second deadline and owns a fresh database.
// Splitting prevents the expanded suite from hiding failures behind one aggregate timeout.
async function runSuite(suite){
  const suffix=randomUUID().replaceAll('-','').slice(0,12),name='solveflow-exam-test-'+suffix,db='solveflow_exam_test_'+suffix;
  let container=false;
  try{
    docker(['run','--rm','-d','--name',name,'--label','solveflow.test=managed-exams','--memory','384m','--tmpfs','/var/lib/postgresql/data:rw,size=192m','-p','127.0.0.1::5432','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB='+db,image]);container=true;
    let ready=false;
    for(let attempt=0;attempt<80;attempt++){
      if(interrupted)throw new Error('TEST_INTERRUPTED');
      if(spawnSync('docker',['exec',name,'pg_isready','-U','postgres'],{stdio:'ignore'}).status===0){ready=true;break;}
      await delay(250);
    }
    if(!ready)throw new Error('TEST_DATABASE_START_TIMEOUT');
    const port=Number(docker(['port',name,'5432/tcp']).split(':').at(-1));
    if(!Number.isSafeInteger(port)||port<1024)throw new Error('INVALID_TEST_PORT');
    const env={...process.env,NO_PROXY:localBypass,no_proxy:localBypass,SOLVEFLOW_EXAM_TEST_DATABASE_URL:`postgresql://postgres@127.0.0.1:${port}/${db}`};
    console.info('Managed exams suite: '+suite.name);
    const child=spawn('pnpm',['exec','vitest','run','--reporter=verbose','--config','vitest.integration.config.ts','apps/exam-web/src/server/'+(suite.file??'managed.integration.test.ts'),'-t',suite.pattern],{env,stdio:'inherit'});
    activeChild=child;
    const deadline=setTimeout(stop,180000);
    try{
      const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
      return interrupted?130:code;
    }finally{clearTimeout(deadline);}
  }finally{
    activeChild?.kill('SIGTERM');activeChild=undefined;
    if(container)docker(['rm','-f',name]);
  }
}
try{
  docker(['image','inspect',image]);
  for(const suite of suites){
    if(interrupted){process.exitCode=130;break;}
    const code=await runSuite(suite);
    if(code!==0){process.exitCode=code;break;}
  }
}finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
