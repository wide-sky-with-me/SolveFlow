import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, Text } from 'react-native';
import { batchFull, checkUnsaved, killUnsaved, checkRun, checkWrite, engineFull, killRun, killWrite } from './faults';
import { archiveFailures, checkImport, killImport, largeArchive } from './archives';
import { status } from './support';
import { safArchive } from './saf';

// Only this separate APK registers the probe scheme. No production entry imports these files.
const actions: Record<string, () => Promise<object | void>> = {
  'batch-full': batchFull, 'engine-full': engineFull,
  'kill-write': killWrite, 'check-write': checkWrite,
  'kill-run': killRun, 'check-run': checkRun,
  'kill-import': killImport, 'check-import': checkImport,
  'kill-unsaved': killUnsaved, 'check-unsaved': checkUnsaved,
  'archive-failures': archiveFailures,
  'large-archive': largeArchive,
  'saf-archive': safArchive,
};
let busy = false;
function Probe() {
  const [message, setMessage] = useState('SolveFlow isolated storage acceptance');
  useEffect(() => {
    async function run(url: string | null) {
      if (!url?.startsWith('solveflow-storage-probe://run/') || busy) return;
      const name = url.slice('solveflow-storage-probe://run/'.length); const action = actions[name];
      if (!action) return;
      busy = true; status(name, 'running'); setMessage(name);
      try { const evidence = await action(); status(name, 'passed', evidence ?? {}); setMessage(`${name}: passed`); }
      catch (cause) { const error = cause instanceof Error ? cause.message : 'Unknown test error'; status(name, 'failed', { error }); setMessage(`${name}: ${error}`); }
      finally { busy = false; }
    }
    void Linking.getInitialURL().then(run);
    const subscription = Linking.addEventListener('url', ({ url }) => { void run(url); });
    return () => subscription.remove();
  }, []);
  return <ScrollView contentContainerStyle={{ padding: 32, paddingTop: 72 }}><Text style={{ fontSize: 18 }}>{message}</Text></ScrollView>;
}
registerRootComponent(Probe);
