# 曲线与关键点

以下仅说明数据格式，不是当前题目的答案：

```json
{
  "schemaVersion": 1,
  "id": "curve",
  "kind": "coordinate",
  "title": "函数与水平线",
  "description": "抛物线y=x²与直线y=1相交于(-1,1)和(1,1)。",
  "xLabel": "x",
  "yLabel": "y",
  "equalAspect": true,
  "xRange": [-2, 2],
  "yRange": [-1, 4],
  "elements": [
    {"kind":"polynomial","coefficients":[0,0,1],"label":"y=x²","color":"green"},
    {"kind":"polynomial","coefficients":[1],"label":"y=1","color":"blue"},
    {"kind":"point","at":[-1,1],"label":"A"},
    {"kind":"point","at":[1,1],"label":"B"}
  ]
}
```

segment使用from/to两个坐标，circle使用center和正数radius。标签是纯文字，公式放在教学步骤的latex字段。原题局部图填写problem.illustrations，不用新绘曲线替代原题条件。
