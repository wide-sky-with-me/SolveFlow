import { useCallback, useEffect, useState } from 'react';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { clientError } from '@solveflow/client/presentation';
import { MotionProvider } from './components/motion-provider';
import { LaunchScreen } from './components/launch-screen';
import { Button, Card, Notice, s } from './components/ui';
import { ThemeProvider } from './theme/provider';
import { SafeAreaView, Text, View } from './theme/primitives';
import { createRuntime, type Runtime } from './runtime';
import { Workspace } from './workspace/workspace';
import { styles } from './workspace/styles';

export default function App() { return <MotionProvider><ThemeProvider><Application /></ThemeProvider></MotionProvider>; }

function Application() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState('');
  const [openingAttempt, setOpeningAttempt] = useState(0);
  const [launched, setLaunched] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const finishLaunch = useCallback(() => setLaunched(true), []);
  const finishRestoring = useCallback(() => setWorkspaceReady(true), []);
  useEffect(() => {
    let alive = true;
    void createRuntime().then(value => { if (alive) setRuntime(value); }).catch(cause => { if (alive) setError(clientError(cause)); });
    return () => { alive = false; };
  }, [openingAttempt]);
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      {runtime ? (
        <Workspace runtime={runtime} onReady={finishRestoring} />
      ) : error ? (
        <SafeAreaView style={styles.shell}>
          <Card>
            <Text style={s.title}>暂时无法打开题目</Text>
            <Notice text={error} error />
            <Button title="重新打开" onPress={() => { setError(''); setOpeningAttempt(value => value + 1); }} />
          </Card>
        </SafeAreaView>
      ) : (
        <View style={styles.shell} />
      )}
      {!launched && <LaunchScreen ready={workspaceReady || !!error} onFinished={finishLaunch} />}
    </SafeAreaProvider>
  );
}
