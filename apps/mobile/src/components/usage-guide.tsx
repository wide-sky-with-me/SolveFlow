import { MAX_BATCH_PHOTOS, MAX_LOCAL_RECORDS } from '@solveflow/contracts/local';
import { SafeAreaView, ScrollView, Text } from '../theme/primitives';
import { Button, s } from './ui';
import { PageHeader } from './page-header';
import { PdfUsageGuide } from './pdf-usage-guide';
import { UsageGuideSection } from './usage-guide-section';
import { UsageGuideScreens } from './usage-guide-screens';

export function UsageGuide({ onClose }: { onClose: () => void }) {
  return <SafeAreaView testID="usage-guide" style={{ flex: 1 }}>
    <PageHeader title="使用说明" onBack={onClose} />
    <ScrollView testID="usage-guide-scroll" contentContainerStyle={[s.pageContent, { gap: 16, paddingBottom: 32 }]}>
      <Text style={s.subtitle}>从拍题到导出，按下面的步骤操作。配图均为演示数据。</Text>
      <UsageGuideSection title="快速开始" steps={[
        '需要配置模型时，进入“我的 → 模型设置”。打开相机后选择“单题拍照”或“批量解题”，也可从相册选择；单题可先确认、裁切，再提交解题。未配置模型时仍可保存题图。',
        '拍清完整题干、题号、单位和全部选项，尽量避免反光或截断。同图最多4题，请在补充说明中明确题号。',
        '顶部或设置中可选择默认考试：SAT、ACT、AP、ESAT、TMUA、TARA或未指定。新题沿用当前配置，旧题保留原考试信息。',
      ]}><UsageGuideScreens section="start" /></UsageGuideSection>
      <UsageGuideSection title="批量导入与顺序" steps={[
        `批量模式可连续拍摄或从相册多选，每批最多${MAX_BATCH_PHOTOS}张。一次批量拍摄自动归入同批；点击相机或批次详情中的名称可重命名，也可在历史批次操作中修改。`,
        '连拍支持3张待存缓冲，可在处理前一张时继续拍。“已保存”才算加入批次；完成拍摄会等待待存照片保存。失败时请重试保存，或明确放弃未保存照片；待存照片仍在内存，请保持应用打开。',
        '相册图片默认按文件名排序，可按时间或手动调整。网页时间来自文件修改时间，手机取可识别的文件名时间，不一定等于拍摄时间；未知时间排最后。确认导入后按预览顺序加入批次，拍摄序号与原题号分开。',
        '已有批次新增题图时，单击缩略图选择插入位置，或拖到编号网格；后面的编号自动顺延。卡片底部“编辑图片”可查看、裁剪、旋转和上下移动，右上角小叉移除。未指定位置时追加到末尾，确认导入前不保存或答题。',
        '答题与校验分别排队，答案生成后即可查看。两组并发可在模型设置中分别调整；自动核验会增加模型调用。批次菜单可继续拍摄、添加图片、继续待解题、重试失败题或停止任务。',
        '安卓批量拍摄会保持对焦；移动到下一题或改变距离后，将题目放在中央，点一下预览重新对焦。',
      ]}><UsageGuideScreens section="batch" /></UsageGuideSection>
      <UsageGuideSection title="查看、补图与核对" steps={[
        '答案先展示核心结果，详细步骤、知识点和校验按需查看。AI解答需结合原题核对，校验通过也不保证正确。',
        '一题多图可在“同题材料 / 补图”添加下一页或细节，保存不自动调用模型。更正题干可添加或删除本次图片，至少保留一张；取消不保存。提交后新解答采用当前图片，旧答案及其校验材料保持原样。',
        '批次操作中的“批量补图并重答”可一次选择多张补图，在题号网格勾选对应题图，鼠标按住扫过可多选，从已选题号起拖可取消选择；双击题号查看原图。同一补图可用于多题。“继续添加补图”保留已有绑定；单击补图缩略图切换绑定对象，卡片底部“编辑图片”打开查看、裁剪和旋转，右上角小叉移除。确认“保存补图并自动重答”后，仅收到补图的题目重新解答并校验，可通过批次操作停止；同张原图包含多题时会一并重答。',
        '更正题干可用公式按钮插入TeX，或输入 $...$、\\(...\\) 和 $$...$$ 查看预览。校验会对照原图、补图与已有答案；启用备用模型后，答题失败或校验判错时可自动接手一次，替换答案仍需校验。',
      ]}><UsageGuideScreens section="materials" /></UsageGuideSection>
      <PdfUsageGuide />
      <UsageGuideSection title="历史与图片" steps={[
        '首页未打开题目时，可从“最近记录”继续查看。单题和整批可直接打开，同一批次只显示一项；“查看全部”进入历史题目。',
        '题目页右上方“任务”或“我的 → 批量任务”可查看各批次的已出答案、等待、答题、校验、已停止和失败数量；批次卡片的更多操作可单独停止、继续、重试或导出。新建、切换批次不会停止上一批；Web 须保持原页面打开，刷新或关闭后不会自动重放任务。',
        '历史分“单题记录”和“批量记录”。点击放大镜可按原题号、题干关键词或批次名称搜索；收起搜索会清除筛选。',
        '点击题目照片或插图可全屏查看，双指缩放、放大后拖动，双击放大或还原。长按题图或使用大图右上角入口分享，网页版需浏览器支持图片分享。关闭图片回到原题。',
        '从历史或收藏打开题目后，系统返回会回到来源列表；返回首页后，2秒内连续返回两次才退出。',
      ]}><UsageGuideScreens section="history" /></UsageGuideSection>
      <UsageGuideSection title="保存与恢复" steps={[
        `题图和对话保存在本机，最多${MAX_LOCAL_RECORDS}张，不会自动删除旧题。卸载应用或清除数据会丢失记录；解题需要联网，题图会发送至你配置的模型服务。`,
        '在“我的 → 导出本地记录”保存完整备份，在“恢复本地记录”导回。大备份会分卷，请保存全部分卷并逐卷恢复；备份不包含模型密钥或模型设置。',
        '安卓解题可息屏或切换应用，完成后自动保存；系统关闭应用后，中断任务需手动重试。网页版请保持页面打开。',
      ]}><UsageGuideScreens section="backup" /></UsageGuideSection>
      <Button title="明白了" onPress={onClose} />
    </ScrollView>
  </SafeAreaView>;
}
