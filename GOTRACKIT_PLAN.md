# gotrackit 路网匹配集成计划

> 项目：cesium-digital-map | 日期：2026-06-06 | 状态：规划中

---

## 1. 现有项目状态

纯前端 Cesium 数字地球，Vite + Cesium.js，**无后端**。

| 模块 | 文件 | 功能 |
|------|------|------|
| 底图 | mapControl.js | 天地图 WMTS / 高德 GCJ-02 纠偏 / 离线 XYZ |
| 相机 | cameraControl.js | flyTo + 环绕巡逻 |
| 专题图 | thematicLayer.js | SingleTile 栅格叠加 + 世界文件 |
| 比例尺 | scaleBar.js | 自适应 + 拖动缩放 |
| GCJ-02 | tilingSchemeGcj02.js, transformGcj02.js | 高德瓦片纠偏 |

## 2. gotrackit 能力

已安装 v0.3.23（Python，路径 `C:\Users\PC\AppData\Roaming\Python\Python314\site-packages\gotrackit`）

| 核心类 | 用途 |
|--------|------|
| MapMatch | 离线 HMM 路网匹配 |
| OnLineMapMatch | 实时在线匹配 |
| Net | 路网对象（shapefile/GeoJSON/高德API） |
| TripGeneration | 模拟 GPS 轨迹生成 |
| netreverse | 高德/百度 API 获取路网 |
| visualization | kepler.gl 可视化导出 |

*注：keplergl 依赖安装失败，不影响核心功能。*

## 3. 架构方案

```
Cesium 前端 (Vite :5173)          Python 后端 (FastAPI :8765)
┌────────────────────────┐       ┌──────────────────────────┐
│ 现有模块               │       │ /api/match     离线匹配  │
│ + trajectoryLayer.js   │◄─────►│ /api/generate  生成轨迹  │
│ + roadNetLayer.js      │ HTTP  │ /api/network   获取路网  │
│ + realtimeClient.js    │       │ /ws/realtime   实时推送  │
│ + timeController.js    │◄─────►│                          │
│ + matchInfoPanel.js    │  WS   │ gotrackit 引擎           │
└────────────────────────┘       └──────────────────────────┘
```

**关键决策**：
- 路网从高德 API 获取（gotrackit 内置） → 缓存本地
- 后端 GCJ-02 计算 → 输出 WGS84 GeoJSON → Cesium 渲染
- 底图切天地图（WGS84）避免偏移
- 模拟 GPS 用 TripGeneration 自包含演示

## 4. 分步实施

### Phase 1 — 后端基础设施
- 创建 `backend/main.py`（FastAPI）+ `backend/match_engine.py`（gotrackit 封装）
- 获取北京路网，缓存为 GeoJSON
- 验证：`/api/health` 返回 200，gotrackit 加载路网成功

### Phase 2 — 离线路网匹配 API
- `POST /api/generate` → 生成模拟 GPS 轨迹
- `POST /api/match` → HMM 路网匹配 → 返回纠偏轨迹 + 匹配路段
- `GET /api/network` → 返回路网 GeoJSON
- 验证：curl 调用返回正确匹配结果

### Phase 3 — Cesium 轨迹与路网图层
- 新建 `trajectoryLayer.js`：GPS 点 + 纠偏轨迹 + 匹配路段高亮
- 新建 `roadNetLayer.js`：路网渲染 + 按 link_id 高亮
- 扩展 `index.html`：路网匹配控制分区
- 验证：前端加载路网、轨迹、匹配结果可见

### Phase 4 — 实时路网匹配
- 后端 WebSocket 推送模拟实时 GPS + 匹配结果
- 新建 `realtimeClient.js`：动态追加轨迹点 + 当前匹配段闪烁
- 验证：轨迹点逐步出现，匹配段实时更新

### Phase 5 — 时空数据可视化
- 新建 `timeController.js`：Cesium Clock 播放/暂停/倍速
- 新建 `matchInfoPanel.js`：匹配统计 + 路段详情
- 底部时间轴控制条
- 验证：轨迹回放正常，面板数据更新

## 5. 新增文件清单

```
backend/
├── main.py              FastAPI 入口
├── match_engine.py      gotrackit 封装
├── requirements.txt
└── data/
    ├── beijing_network.geojson    路网缓存
    └── sample_trips.geojson       示例轨迹

src/modules/
├── trajectoryLayer.js   轨迹图层（新建）
├── roadNetLayer.js      路网图层（新建）
├── realtimeClient.js    WebSocket 客户端（新建）
├── timeController.js    时间轴控制（新建）
└── matchInfoPanel.js    匹配信息面板（新建）

index.html               扩展控制面板（修改）
src/main.js              初始化新模块（修改）
src/style.css            新增样式（修改）
```

## 6. 风险

| 风险 | 缓解 |
|------|------|
| keplergl 安装失败 | 不依赖，Cesium 自绘 |
| 高德 API 限流 | 路网首次获取后缓存 |
| 大路网渲染卡顿 | PolylineCollection + 视口裁剪 |
| GCJ-02/WGS84 偏移 | 后端统一输出 WGS84 |
| OnLineMapMatch 延迟 | 降低推送频率 |
