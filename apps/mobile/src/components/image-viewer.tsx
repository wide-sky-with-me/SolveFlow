import { Image, ScrollView, Text, View, SafeAreaView } from '../theme/primitives';
import { useState } from 'react';
import { Modal, useWindowDimensions } from 'react-native';

import { Button, s } from './ui';
export function ImageViewer({ uri, size, onClose }: { uri: string; size: { width: number; height: number }; onClose: () => void }) {
  const [zoomed, setZoomed] = useState(false); const window = useWindowDimensions(); const width = zoomed ? Math.max(900, window.width - 32) : window.width - 32;
  return <Modal animationType="slide" onRequestClose={onClose}><SafeAreaView style={{ flex: 1, padding: 16, backgroundColor: '#fff', gap: 12 }}><View style={s.row}><Text style={s.title}>原始题图</Text><Button title="关闭大图" secondary onPress={onClose} /><Button title={zoomed ? '适应屏幕' : '放大查看'} secondary onPress={() => setZoomed(value => !value)} /></View><ScrollView horizontal contentContainerStyle={{ minWidth: '100%' }}><ScrollView><Image source={{ uri }} accessibilityLabel="原始题图大图" resizeMode="contain" style={{ width, height: width * size.height / size.width }} /></ScrollView></ScrollView></SafeAreaView></Modal>;
}
