import { useRef } from 'react';
import { isAuxiliaryContext, type RunContext, type RunView } from '@solveflow/contracts/http';
import { problemText } from '@solveflow/contracts/agent';
import { clientError } from '@solveflow/client/presentation';
import type { Runtime } from '../runtime';
import { rememberSession, photoData, pickPhoto, releasePhoto, transformPhoto } from '../platform';
import type { Photo } from '../platform.types';
import type { WorkspaceState } from './use-workspace-state';

export function useWorkspaceActions(runtime: Runtime, state: WorkspaceState) {
  const locked = useRef(false);
  const {
    navigation, navigate, sessions, setSessions, session,
    setSession, photo, setPhoto, setImage, setSessionExam,
    message, setMessage, setError, busy, setBusy,
    setCamera, setEditing, setViewImage, activeId, active,
    available, setCorrection, confirmDelete, setConfirmDelete, loading,
    alive, list,
  } = state;

  function reset() {
    if (locked.current) return;
    loading.current++;
    setSession(null); setPhoto(null); setImage(null); setMessage(''); setError('');
    setCamera(false); setEditing(false); setViewImage(false);
    navigate({ page: 'current' });
    void rememberSession(null).catch(cause => setError(clientError(cause)));
  }

  function choose(value: Photo) {
    if (locked.current) { releasePhoto(value); return; }
    loading.current++;
    setPhoto(value); setSession(null); setImage(null); setMessage(''); setError('');
    navigate({ page: 'current' });
    setCamera(false);
    setEditing(true);
    void rememberSession(null).catch(cause => setError(clientError(cause)));
  }

  async function gallery() {
    if (busy) return;
    setCamera(false);
    try {
      const value = await pickPhoto();
      if (value) { if (alive.current) choose(value); else releasePhoto(value); }
    } catch {
      setError('无法读取图片，请选择清晰的题目照片。');
    }
  }

  async function rotate() {
    if (!photo || busy) return;
    setBusy(true);
    try {
      const value = await transformPhoto(photo, undefined, true);
      if (alive.current) setPhoto(value); else releasePhoto(value);
    } catch (cause) {
      setError(clientError(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function submit(text = message, context?: RunContext, saveOnly = false, imageEdit?: Parameters<Runtime['start']>[3]): Promise<boolean> {
    if (locked.current || busy || runtime.batch.busy && !isAuxiliaryContext(context?.kind)) return false;
    if (!isAuxiliaryContext(context?.kind) && (activeId || active)) return false;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      let current = session;
      if (!current) {
        if (!photo) throw new Error('请先拍摄或选择题目照片。');
        // Cropping already normalizes the image. Reuse those pixels without another JPEG encode.
        // The photo state owns a reused URI; only release a separately created image here.
        const normalized = photo.normalized ? photo : await transformPhoto(photo);
        try {
          const record = await runtime.engine.create(
            await photoData(normalized),
            normalized.width,
            normalized.height,
            runtime.defaultExam,
          );
          setSessionExam(record.exam ?? 'general');
          current = record.session;
          setImage(record.image);
          setSession(current);
          setPhoto(null);
          navigate({ page: 'current', questionId: current.id }, true);
          await rememberSession(current.id);
          await list();
        } finally {
          if (normalized !== photo) releasePhoto(normalized);
        }
      }
      if (saveOnly || !available) return true;
      await runtime.start(current.id, text, context, imageEdit);
      setCorrection(null);
      setMessage('');
      return true;
    } catch (cause) {
      if (alive.current) setError(clientError(cause));
      return false;
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function cancel(runId: string) {
    setBusy(true);
    try { await runtime.engine.cancelRun(runId); }
    catch { setError('取消任务失败。'); }
    finally { setBusy(false); }
  }

  async function favorite(id: string) {
    const selected = sessions.find(item => item.id === id);
    if (busy || !selected) return;
    setBusy(true);
    setError('');
    try {
      await runtime.repository.setFavorite(id, !selected.favorite);
      await list();
    } catch (cause) {
      setError(clientError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function requestRemove(id: string) {
    if (!busy && sessions.some(item => item.id === id)) setConfirmDelete(id);
  }

  async function remove() {
    const id = confirmDelete;
    if (!id || busy) return;
    setBusy(true);
    setError('');
    try {
      if (id === 'singles') {
        await runtime.removeSingleHistory();
      } else if (id === 'all') {
        await runtime.batch.stop();
        await runtime.engine.removeAll();
      } else if (id.startsWith('batch:')) {
        await runtime.removeBatch(id.slice(6));
      } else {
        if (sessions.find(row => row.id === id)?.batch)
          await runtime.batch.stop(sessions.find(row => row.id === id)!.batch!.id);
        await runtime.engine.remove(id);
      }
      setConfirmDelete(null);
    } catch (cause) {
      setError(clientError(cause));
    } finally {
      try {
        const remaining = await runtime.repository.listHistory({ cached: true });
        const kept = new Set(remaining.map(row => row.id));
        const deleted = new Set(sessions.filter(row => !kept.has(row.id)).map(row => row.id));
        const keptBatches = new Set(remaining.flatMap(row => row.batch ? [row.batch.id] : []));
        const deletedBatches = new Set(
          sessions.flatMap(row => row.batch && !keptBatches.has(row.batch.id) ? [row.batch.id] : []),
        );
        navigation.forgetRecords(deleted, deletedBatches);
        setSessions(remaining);
        if (session && deleted.has(session.id)) {
          loading.current++;
          setSession(null);
          setImage(null);
          await rememberSession(null);
        }
      } catch (cause) {
        setError(clientError(cause));
      }
      setBusy(false);
    }
  }

  function correct(run: RunView, number?: number) {
    const result = run.outcome;
    if (result?.status !== 'completed' && result?.status !== 'needs_clarification') return;
    setCorrection({
      run,
      text: problemText(result.candidate.problem).slice(0, 2000),
      ...(number === undefined ? {} : { number }),
    });
  }

  return { reset, choose, gallery, rotate, submit, cancel, favorite, requestRemove, remove, correct };
}

export type WorkspaceActions = ReturnType<typeof useWorkspaceActions>;
