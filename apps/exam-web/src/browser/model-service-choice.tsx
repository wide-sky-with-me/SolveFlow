import { useEffect, useRef, useState } from 'react';
import { ExamModelServiceSelectionSchema, type ExamModelServiceCode, type ExamModelServiceSelection } from '@solveflow/contracts/exam-model-services';
import { Icon } from '@solveflow/web-ui/icons';
import { api, post } from './api.js';
import { Dialog, ErrorText } from './components.js';
import './model-services.css';

export function ModelServiceChoice({ onClose }: { onClose: () => void }) {
    const [data,setData]=useState<ExamModelServiceSelection|null>(null),[selected,setSelected]=useState<ExamModelServiceCode>('primary'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
    const request=useRef<AbortController|null>(null);
    async function read(signal: AbortSignal) {
        const value=await api('/me/model-service',ExamModelServiceSelectionSchema,{signal});
        if(!signal.aborted){setData(value);setSelected(value.selected);} return value;
    }
    useEffect(()=>{const controller=new AbortController();request.current=controller;void read(controller.signal).catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'读取服务方案失败。');});return()=>{request.current?.abort();};},[]);
    async function save() {
        if(!data||busy)return;
        const controller=new AbortController();request.current?.abort();request.current=controller;setBusy(true);setError('');
        try{await api('/me/model-service',ExamModelServiceSelectionSchema,{...post({code:selected,expectedVersion:data.version}),signal:controller.signal});if(!controller.signal.aborted)onClose();}
        catch(error){if(!controller.signal.aborted){setError(error instanceof Error?error.message:'切换失败，请重新读取服务状态。');try{await read(controller.signal);}catch{ /* Keep the error and require an explicit read; never replay the write. */ }}}
        finally{if(!controller.signal.aborted)setBusy(false);}
    }
    async function retry() {const controller=new AbortController();request.current?.abort();request.current=controller;setError('');try{await read(controller.signal);}catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:'读取失败。');}}
    return <Dialog title="服务方案" className="model-service-choice" onClose={()=>{if(!busy)onClose();}}>
      {!data&&!error&&<p className="empty" role="status">正在读取服务方案…</p>}
      {data&&<><div className="service-choices" role="radiogroup" aria-label="服务方案">{data.services.map(service=><label key={service.code} className={'service-choice'+(selected===service.code?' selected':'')+(!service.available?' unavailable':'')}><input type="radio" name="model-service" value={service.code} checked={selected===service.code} disabled={busy||!service.available} onChange={()=>setSelected(service.code)}/><span className="service-choice-icon"><Icon name={service.code==='primary'?'pulse':'monitor'}/></span><span><strong>{service.name}</strong><small>{!service.available?'暂不可用':data.selected===service.code?'当前使用':'可切换'}</small></span><Icon name="check" className="service-choice-check"/></label>)}</div><p className="service-help">切换后用于新发起的答题，正在处理的题目继续使用原方案。</p></>}
      <ErrorText error={error}/>
      <div className="dialog-footer">{error&&<button className="quiet" onClick={()=>void retry()} disabled={busy}>重新读取</button>}<button onClick={onClose} disabled={busy}>取消</button><button className="primary" onClick={()=>void save()} disabled={busy||!data||selected===data.selected||!data.services.some(service=>service.code===selected&&service.available)}>{busy?'正在切换…':'切换方案'}</button></div>
    </Dialog>;
}
