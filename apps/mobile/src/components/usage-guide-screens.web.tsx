import type { UsageGuideScreenSection } from './usage-guide-screens.native';
import { UsageGuideFigure } from './usage-guide-section';

export function UsageGuideScreens({ section }: { section: UsageGuideScreenSection }) {
  switch (section) {
    case 'start': return <>
      <UsageGuideFigure source={require('../../assets/help/start-question.png')} width={740} height={712} caption="网页版示例：在首页拍一张，或从相册选择题图。" />
      <UsageGuideFigure source={require('../../assets/help/crop-question.png')} width={780} height={1300} caption="网页版示例：拖动蓝色控制点裁切，保留完整题干和选项，再点“使用这张题图”。" />
    </>;
    case 'batch': return <UsageGuideFigure source={require('../../assets/help/batch-order.png')} width={780} height={1428} caption="网页版示例：导入前可按文件名或时间排序，也可上移、下移；确认后才导入并解题。" />;
    case 'materials': return <UsageGuideFigure source={require('../../assets/help/question-materials.png')} width={780} height={924} caption="网页版示例：补图保存后出现在同题材料中，重新解答需另行提交。" />;
    case 'history': return <UsageGuideFigure source={require('../../assets/help/history-search.png')} width={780} height={1210} caption="网页版示例：切换单题、批量记录，搜索题号、题干关键词或批次名。" />;
    case 'backup': return <UsageGuideFigure source={require('../../assets/help/backup-records.png')} width={780} height={702} caption="网页版示例：“导出本地记录”保存完整备份，可从“恢复本地记录”导回。" />;
  }
}
