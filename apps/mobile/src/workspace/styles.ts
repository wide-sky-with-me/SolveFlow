import { StyleSheet } from 'react-native';
import { colors, layout } from '../components/ui';

export const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: '#fff',
  },
  questionTabs: {
    flexDirection: 'row',
    alignSelf: 'center',
    width: '100%',
    maxWidth: layout.workspaceWidth,
    gap: 4,
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 4,
    backgroundColor: '#fff',
  },
  questionTab: {
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 22,
  },
  questionTabActive: {
    backgroundColor: '#edf3ff',
  },
  questionTabText: {
    fontSize: 16,
    color: colors.muted,
  },
  content: {
    padding: 10,
    paddingBottom: 20,
    gap: 10,
    width: '100%',
    maxWidth: layout.workspaceWidth,
    alignSelf: 'center',
  },
  modal: { flex: 1, backgroundColor: '#fff' },
});
