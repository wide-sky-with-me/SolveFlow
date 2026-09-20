import { ScrollView, Text, View, SafeAreaView } from '../theme/primitives';
import { Modal } from 'react-native';

import type { LocalDiagnostic } from '@solveflow/contracts/local';
import { Button, s } from './ui';
const reasons: Record<NonNullable<LocalDiagnostic['reason']>, string> = { http: '模型服务返回错误', network: '网络连接异常', truncated: '输出达到 Token 上限', json: 'JSON 语法不完整', schema: '结果字段不符合要求', output_limit: '结果超过长度限制', invalid_finish: '模型未正常结束', background_start: '后台服务启动失败', started: '任务开始', completed: '任务完成', failed: '任务失败', cancelled: '手动取消', deadline: '任务达到时间上限', storage: '存储失败' };
export function DiagnosticDetails({ entries, onClose }: { entries: LocalDiagnostic[]; onClose: () => void }) {
  return <Modal animationType="slide" onRequestClose={onClose}><SafeAreaView style={{ flex: 1, padding: 20, gap: 16 }}><Text style={s.title}>诊断详情</Text><ScrollView contentContainerStyle={{ gap: 12 }}>
    {!entries.length && <Text style={s.subtitle}>这条旧记录没有详细诊断信息。</Text>}
    {entries.map((entry, index) => <View key={index} style={s.card}><Text style={s.label}>{entry.role === 'runtime' ? '任务' : entry.role === 'solver' ? '解题' : '校验'}{entry.attempt ? ` · 第${entry.attempt}次调用` : ''}</Text>
      <Text selectable style={s.subtitle}>{[entry.reason ? reasons[entry.reason] : entry.event === 'request' ? '请求已发起' : entry.event === 'response' ? '响应已到达' : '输出结束', `阶段耗时：${(entry.elapsedMs / 1000).toFixed(1)}秒`, entry.httpStatus ? `HTTP ${entry.httpStatus}` : '', entry.stopReason ? `结束原因：${entry.stopReason}` : '', entry.firstTokenMs === undefined ? '' : `本次首个内容事件：${(entry.firstTokenMs / 1000).toFixed(1)}秒`, entry.textBytes === undefined ? '' : `正文大小：${entry.textBytes}字节`, entry.inputTokens === undefined ? '' : `输入 Token：${entry.inputTokens}`, entry.outputTokens === undefined ? '' : `输出 Token：${entry.outputTokens}`, entry.outputBytes === undefined ? '' : `输出字节：${entry.outputBytes}`, entry.fields?.length ? `待检查字段：${entry.fields.join('、')}` : ''].filter(Boolean).join('\n')}</Text>
    </View>)}
  </ScrollView><Button title="关闭诊断" secondary onPress={onClose} /></SafeAreaView></Modal>;
}
