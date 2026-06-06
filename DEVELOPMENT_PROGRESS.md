# gotrackit 路网匹配集成 — 开发进度

> 项目: cesium-digital-map | 分支: feat/gotrackit | 最后更新: 2026-06-06

---

## 背景/目标

在 Cesium 纯本地化数字地球上集成 gotrackit 路网匹配：
- 路网匹配（HMM）
- 实时路网匹配（WebSocket）
- 时空数据可视化

---

## 已完成

### Bugfix: 路网匹配 GPS 超出覆盖范围 + 前端渲染
- [x] **根因**: 合成 GPS 在路网 bbox 外随机行走，HMM 将所有点塌缩到边缘 link；`/api/match` 复用旧缓存忽略参数；纠偏轨迹为 Point 序列未渲染
- [x] **修复**: 沿路网拓扑游走采样 + 强制按参数重建轨迹；GCJ-02→WGS84 输出；真实匹配质量指标；前端 Point→Polyline

- [x] **根因**: `Gcj02CorrectedWebMercatorTilingScheme` 四角分别纠偏，GCJ-02 偏移非线性导致相邻瓦片错位
- [x] **修复**: 移除自定义 tiling scheme，改用标准 `WebMercatorTilingScheme`，高德底图有 ~300-500m 整体偏移但瓦片完美对齐
- [x] 文件: `src/modules/mapControl.js`（移除 Gcj02 引用）、`src/modules/tilingSchemeGcj02.js`（保留但不引用）

### Phase 1: 后端基础设施
- [x] `backend/main.py` — FastAPI 服务 (port 8765, 7 个端点)
- [x] `backend/match_engine.py` — gotrackit 封装（路网加载/合成GPS/HMM匹配）
- [x] `backend/requirements.txt` — Python 依赖
- [x] `backend/data/beijing_network.geojson` — 北京真实路网 (1467 links)
- [x] `backend/data/beijing_nodes.geojson` — 节点层 (1341 nodes)
- [x] 合成 GPS 轨迹生成（随机行走 + GPS 噪声）
- [x] HMM 路网匹配

### Phase 2: 完整 GeoJSON 输出
- [x] `POST /api/match` — 完整 GeoJSON (trips + network + raw)
- [x] `GET /api/match/{id}/links` — 单 agent 匹配路段
- [x] `GET /api/match/{id}/trajectory` — 单 agent 纠偏轨迹
- [x] `GET /api/match/{id}/prj` — 单 agent 投影点
- [x] `GET /api/network` — 完整路网 GeoJSON
- [x] `GET /api/network/status` — 路网状态
- [x] 修复 datetime JSON 序列化问题

### Phase 3: Cesium 前端图层
- [x] `src/modules/trajectoryLayer.js` — GPS点(白)+轨迹(青)+匹配路段(橙)+投影点(绿)
- [x] `src/modules/roadNetLayer.js` — 路网 Polyline 渲染（蓝色半透明）
- [x] `index.html` — 控制面板新增「路网匹配」分区
- [x] `src/main.js` — 导入新模块 + UI 事件绑定
- [x] `src/style.css` — 匹配状态指示器 + 输入框样式

### 最短路径规划 (gotrackit Dijkstra)
- [x] `backend/route_engine.py` — 经纬度吸附节点 + `Net.get_shortest_path` + GeoJSON
- [x] `POST /api/route` — 起终点经纬度 → 路径 GeoJSON + 统计
- [x] `src/modules/routeLayer.js` — 紫色路径 + 绿/红起终点
- [x] `index.html` / `main.js` — 路径规划 UI

### 路网数据
- [x] 通过高德 API 拉取北京真实路网（API Key: 2b2c6d...）
- [x] 范围: 116.25-116.45°E, 39.88-40.02°N（~15km×20km）
- [x] 200 组 OD 路径规划 → 逆向生成 1467 路段 + 1341 节点
- [x] 数据源: `backend/data/real_network2/`，已复制到 `beijing_network.geojson`

### 第三方库修复
- [x] gotrackit `merge_links.py` L289: 修复 pandas 新版 `axis` + `index` 冲突

---

## API 端点总览

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/generate` | POST | 生成合成 GPS 轨迹 |
| `/api/match` | POST | 批量 HMM 匹配 (返回完整 GeoJSON) |
| `/api/match/{id}/links` | GET | 单 agent 匹配路段 |
| `/api/match/{id}/trajectory` | GET | 单 agent 纠偏轨迹 |
| `/api/match/{id}/prj` | GET | 单 agent 投影点 |
| `/api/network` | GET | 完整路网 (1467 links) |
| `/api/network/status` | GET | 路网状态 |
| `/api/route` | POST | 最短路径规划 (Dijkstra, GCJ-02) |

## 当前状态

- 后端 API 全部通过验证
- 前端 Cesium 底图切换正常（天地图/高德/离线）
- 高德底图瓦片对齐 ✅
- 真实北京路网加载 + 可视化 ✅
- HMM 路网匹配 + Cesium 图层渲染 ✅（沿路网合成 GPS，多 link 匹配）

## 下一步

- [ ] Phase 4: WebSocket 实时路网匹配（已跳过）
- [ ] Phase 5: 时间轴轨迹回放 + 匹配信息面板（已跳过）
- [ ] 路网覆盖范围可进一步扩大（当前 ~15km×20km）
- [ ] GPS 轨迹可用 gotrackit TripGeneration 沿道路生成（当前 TripGeneration 对真实路网返回空，待排查）

## 验证

- `curl http://127.0.0.1:8765/api/health` ✅
- `curl -X POST http://127.0.0.1:8765/api/match -d '{"num_trips":3}'` ✅
- `curl http://127.0.0.1:8765/api/network` ✅ 1467 features
- 前端 Cesium 高德底图瓦片对齐 ✅
- 前端加载路网 → 执行匹配 → 可视化 ✅
