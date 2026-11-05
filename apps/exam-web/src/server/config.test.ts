import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadExamConfig } from './config.js';

afterEach(()=>vi.unstubAllEnvs());
it('keeps public HTTP opt-in separate from private storage and model transport', async()=>{
    const folder=await mkdtemp(join(tmpdir(),'solveflow-http-config-')),file=join(folder,'config.json');
    const base={schemaVersion:1,origin:'http://192.0.2.17:18443',databaseUrl:'postgresql://synthetic@127.0.0.1/synthetic',storage:{type:'s3',endpoint:'https://s3.example.test',region:'test',bucket:'synthetic',accessKeyId:'synthetic-access',secretAccessKey:'synthetic-secret'}};
    vi.stubEnv('SOLVEFLOW_EXAM_CONFIG',file);
    async function save(value:unknown){await writeFile(file,JSON.stringify(value),{mode:0o600});}
    try{
        await save(base);await expect(loadExamConfig()).rejects.toThrow('HTTPS_OR_LOOPBACK_REQUIRED');
        await save({...base,insecureHttpTrial:true});expect((await loadExamConfig()).insecureHttpTrial).toBe(true);
        await save({...base,insecureHttpTrial:true,httpTrialAliases:['http://exam.example.test']});expect((await loadExamConfig()).httpTrialAliases).toEqual(['http://exam.example.test']);
        await save({...base,insecureHttpTrial:true,storage:{type:'local',root:folder}});await expect(loadExamConfig()).rejects.toThrow('PRODUCTION_REQUIRES_PRIVATE_S3');
        await save({...base,insecureHttpTrial:true,storage:{...base.storage,endpoint:'http://s3.example.test'}});await expect(loadExamConfig()).rejects.toThrow('PRIVATE_S3_REQUIRES_HTTPS');
        await save({...base,origin:'https://exam.example.test'});expect((await loadExamConfig()).insecureHttpTrial).toBe(false);
        await save({...base,origin:'https://exam.example.test',httpTrialAliases:['http://exam.example.test']});await expect(loadExamConfig()).rejects.toThrow('HTTP_ALIASES_REQUIRE_TRIAL_MODE');
    }finally{await rm(folder,{recursive:true,force:true});}
});
