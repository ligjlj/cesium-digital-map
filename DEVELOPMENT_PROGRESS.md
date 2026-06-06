# gotrackit 路网匹配集成 — 开发进度

> 项目: cesium-digital-map | 分支: feat/gotrackit | 最后更新: 2026-06-06

---

## 背景/目标

在 Cesium 纯本地化数字地球上集成 gotrackit 路网匹配，实现：
- 路网匹配（HMM）
- 实时路网匹配（WebSocket）
- 时空数据可视化

## 本轮完成

### Phase 1: 后端基础设施
- [x] `backend/main.py` — FastAPI 服务 (port 8765)
- [x] `backend/match_engine.py` — gotrackit 封装
- [x] `backend/requirements.txt` — Python 依赖
- [x] `backend/data/beijing_network.geojson` — 北京网格路网 (284 links, 80 nodes)
- [x] `backend/data/beijing_nodes.geojson` — 节点层
- [x] 合成 GPS 轨迹生成 (`generate_synthetic_gps`)
- [x] HMM 路网匹配 (`run_map_match`)

### Phase 2: 完整 GeoJSON 输出
- [x] `POST /api/match` — 返回完整 GeoJSON (trips + network + raw)
- [x] `GET /api/match/{id}/links` — 单 agent 匹配路段
- [x] `GET /api/match/{id}/trajectory` — 单 agent 纠偏轨迹
- [x] `GET /api/match/{id}/prj` — 单 agent 投影点
- [x] `GET /api/network` — 完整路网 GeoJSON
- [x] `GET /api/network/status` — 路网状态
- [x] 修复 datetime JSON 序列化问题

### Bugfix: 高德底图 GCJ-02 瓦片错位
- [x] **根因**: `Gcj02CorrectedWebMercatorTilingScheme` 对每个瓦片四角分别做 GCJ-02→WGS84 反算，但由于 GCJ-02 偏移随空间位置变化（非线性），相邻瓦片偏移量不同，导致瓦片之间出现缝隙/重叠/错位
- [x] **修复**: 移除自定义 tiling scheme，改用标准 `WebMercatorTilingScheme`。高德底图有 ~300-500m 系统偏移（所有 WGS84 查看器加载 GCJ-02 瓦片的正常行为），但瓦片之间完美对齐
- [x] 需要无偏移精确叠加时使用天地图（WGS84 原生）

### API 端点总览 (Phase 1+2)
| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/generate` | POST | 生成合成 GPS 轨迹 |
| `/api/match` | POST | 批量 HMM 路网匹配 (返回完整 GeoJSON) |
| `/api/match/{id}/links` | GET | 单 agent 匹配路段 GeoJSON |
| `/api/match/{id}/trajectory` | GET | 单 agent 纠偏轨迹 GeoJSON |
| `/api/match/{id}/prj` | GET | 单 agent 投影点 GeoJSON |
| `/api/network` | GET | 完整路网 GeoJSON (284 links) |
| `/api/network/status` | GET | 路网状态 |

## 当前状态

- 后端 API 全部通过验证
- 前端 Cesium 底图切换正常（天地图/高德/离线）
- 高德底图瓦片对齐已修复
- 前端尚未接匹配数据图层（Phase 3）

## 下一步动作

### Phase 3: Cesium 前端 — 轨迹与路网图层
- [ ] 新建 `src/modules/trajectoryLayer.js` — GPS点/轨迹/匹配路段渲染
- [ ] 新建 `src/modules/roadNetLayer.js` — 路网 Polyline 渲染
- [ ] 扩展 `index.html` 控制面板 — 路网匹配分区
- [ ] 扩展 `src/main.js` — 初始化新模块 + UI 绑定

### Phase 4: 实时路网匹配
- [ ] WebSocket 实时推送
- [ ] 新建 `realtimeClient.js`

### Phase 5: 时空可视化
- [ ] 时间轴控制 (`timeController.js`)
- [ ] 匹配信息面板 (`matchInfoPanel.js`)

## 风险/阻塞

| 风险 | 状态 |
|------|------|
| keplergl 安装失败 | 已绕过（Cesium 自绘） |
| 外网不通 (OSM/高德API) | 使用合成路网+轨迹 |
| GCJ-02 瓦片错位 | ✅ 已修复 |
| GitHub push 需代理 | 当前可用 |

## 验证与回归

- `curl http://127.0.0.1:8765/api/health` ✅
- `curl -X POST http://127.0.0.1:8765/api/match -d '{"num_trips":2}'` ✅
- `curl http://127.0.0.1:8765/api/network` ✅ 284 features
- 前端 Cesium 高德底图瓦片对齐 ✅
