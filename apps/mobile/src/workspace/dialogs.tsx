import type { LocalHistorySummary, LocalImageEdit } from '@solveflow/contracts/local';
import { useEffect, useState } from 'react';
import type { Runtime } from '../runtime';
import type { RunView } from '@solveflow/contracts/http';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { ScrollView, Text, SafeAreaView } from '../theme/primitives';
import { MotionModal as Modal } from '../components/motion-modal';
import { DialogSurface } from '../components/dialog-surface';
import { FormulaEditor } from '../components/formula-editor';
import { CorrectionImages } from '../components/correction-images';
import { Button, Notice, s } from '../components/ui';
import type { Correction } from './types';
import { styles } from './styles';

export function CorrectionModal({
  correction,
  busy,
  active,
  available,
  error,
  runtime,
  onClose,
  onSubmit,
  onChange,
}: {
  correction: Correction | null;
  busy: boolean;
  active: RunView | null;
  available: boolean;
  error: string;
  runtime: Runtime;
  onClose: () => void;
  onSubmit: (edit: LocalImageEdit) => void;
  onChange: (text: string) => void;
}) {
  const [imageEdit, setImageEdit] = useState<LocalImageEdit | null>(null);
  const [imagesBusy, setImagesBusy] = useState(false);
  useEffect(() => { setImageEdit(null); setImagesBusy(false); }, [correction?.run.id, correction?.number]);
  const blocked = busy || !!active || imagesBusy;
  return (
    <Modal visible={!!correction} animationType="slide" onRequestClose={() => { if (!blocked) onClose(); }}>
      <SafeAreaView style={styles.modal}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.pageContent}>
            <Text accessibilityRole="header" style={s.title}>更正题干</Text>
            {correction && <CorrectionImages key={`${correction.run.id}:${correction.number ?? 0}`} runtime={runtime} sessionId={correction.run.sessionId} disabled={busy || !!active} onChange={setImageEdit} onBusy={setImagesBusy} />}
            {correction && (
              <FormulaEditor
                key={`${correction.run.id}:${correction.number ?? 0}`}
                value={correction.text}
                onChange={onChange}
                disabled={blocked}
              />
            )}
            {error && <Notice text={error} error />}
            <Button
              title="按更正重新解答"
              disabled={blocked || !imageEdit || !correction?.text.trim() || !available}
              onPress={() => { if (imageEdit) onSubmit(imageEdit); }}
            />
            <Button title="取消更正" secondary disabled={blocked} onPress={onClose} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

export function DeleteModal({
  confirmDelete,
  sessions,
  hasStorageIssues,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  confirmDelete: string | null;
  sessions: LocalHistorySummary[];
  hasStorageIssues: boolean;
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const title =
    confirmDelete === 'all'
      ? hasStorageIssues ? '清空本机全部题目，包括无法读取的记录？' : `清空全部 ${sessions.length} 道题？`
      : confirmDelete?.startsWith('batch:')
        ? '删除这一批全部题图与解答？'
        : '删除这道题？';
  const description =
    confirmDelete === 'all'
      ? '将永久删除本机全部历史题图、解答、收藏和诊断记录，无法撤销。进行中的任务会取消，模型设置保留。已导出的文件仍保留。'
      : '将从本机永久移除题图、解答和收藏，无法撤销；进行中的任务也会取消。';
  return (
    <Modal
      visible={!!confirmDelete}
      transparent
      animationType="fade"
      onRequestClose={() => { if (!busy) onClose(); }}
    >
      <DialogSurface>
          <Text accessibilityRole="header" style={s.title}>{title}</Text>
          <Text style={s.subtitle}>{description}</Text>
          {error ? <Notice text={error} error /> : null}
          <Button
            title={confirmDelete === 'all' ? '确认清空全部历史' : '确认删除'}
            danger
            disabled={busy}
            onPress={onConfirm}
          />
          <Button title="保留题目" secondary disabled={busy} onPress={onClose} />
      </DialogSurface>
    </Modal>
  );
}

export function HelpModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal}>
        <ScrollView contentContainerStyle={s.pageContent}>
          <Text accessibilityRole="header" style={s.title}>使用说明</Text>
          <Text style={s.subtitle}>
            {'1. 打开相机后，可选择"单题拍照"或"批量解题"。单题拍照可确认、裁切，再提交解题；也可从相册选择。\n\n'
            + '2. 批量模式可连续拍摄或从相册多选题图。相册图片默认按文件名排序，也可按时间或手动调整；网页时间取文件修改时间，手机取可识别的文件名时间，未必等于拍摄时间，无时间的图片排在最后。确认导入后按预览顺序加入批次，序号与原题号分开。每张建议拍一道完整题，每批最多100张；答题和校验分别排队，答案生成后立即展示。两组并发可在设置中分别调整，自动核验会增加模型调用。\n\n'
            + '3. 一次批量拍摄自动归入同一批，默认名称为日期、小时及编号。安卓批量模式对焦后保持焦点；移动到下一题或改变距离后，将题目放在画面中央，点一下预览重新对焦。点击相机顶部或批次详情中的名称可修改，也可在历史批次操作中重命名。\n\n'
            + '4. 历史分为"单题记录"和"批量记录"。点击放大镜展开搜索，可输入原题号、题干关键词或批次名称；收起搜索会清除筛选。批次内的更多操作可继续拍摄、添加图片、继续待解题、重试失败题或停止后台任务。从历史或收藏打开题目后，系统返回回到来源列表；返回到首页后，2秒内连续返回两次才退出。\n\n'
            + '5. 点击题目照片或原题插图可全屏查看，双指缩放（1～4倍），放大后拖动，双击放大或还原。长按题图可唤起手机系统分享，大图右上角也有分享入口；网页版需浏览器支持图片分享。关闭图片回到原题。\n\n'
            + '6. 在设置中选择默认考试（SAT、ACT、AP、ESAT、TMUA、TARA或未指定），新题沿用该配置，旧题保留原考试信息。同图最多4题，请在补充说明里注明题号。答案先显示核心结果，详细步骤、知识点和校验按需查看。AI解答需结合原题核对，校验通过也不保证正确。校验会对照原图、补图和已有答案；启用备用模型后，答题失败或校验判错时自动接手一次，保留原答案，替换答案仍需校验。\n\n'
            + '7. 安卓解题时可息屏或切换应用，完成后自动保存。若系统关闭应用，中断任务需手动重试；网页版请保持页面打开。\n\n'
            + '8. 题图和对话仅保存在本机，最多保存500张，不会自动删除旧题。卸载或清除数据会丢失记录，可在"我的"导出备份。解题需要联网，题图会发送至你配置的模型服务。\n\n'
            + '9. 一题多图：可先保存主图，再在"同题材料 / 补图"添加下一页或细节，保存不自动调用模型。更正题干时可以添加或删除本次图片，至少保留一张；取消不保存，提交后新解答采用当前图片，旧答案及校验材料保持原样。更正题干可用公式按钮插入TeX，或输入$...$、\\(...\\)和$$...$$查看预览。'}
          </Text>
          <Button title="明白了" onPress={onClose} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
