# Cesium 纯本地化数字地球 · 路网匹配与路径规划

基于 **Vite + Cesium.js** 的前端数字地球，集成 **FastAPI + gotrackit** 后端，实现：

- 多源底图：天地图 WMTS / 高德 / 本地离线瓦片
- 相机漫游：`flyTo` + 预设环绕视角
- 电子专题图：PNG + 世界文件（`.pgw`）栅格叠加
- **路网匹配（HMM）**：合成 GPS → gotrackit MapMatch → Cesium 多图层可视化
- **最短路径规划**：地图选点 → Dijkstra → 路径渲染

## 1. 环境准备

| 组件 | 要求 |
|------|------|
| Node.js | 18+（推荐 20+） |
| npm | 9+ |
| Python | 3.10+（推荐 3.12+，已验证 gotrackit 0.3.x） |

## 2. 安装与运行

### 2.1 前端

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173/`。

### 2.2 后端（路网匹配 / 路径规划）

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8765 --reload
```

健康检查：

```bash
curl http://127.0.0.1:8765/api/health
```

### 2.3 典型操作流程

1. 启动后端与前端；
2. 左侧面板选择底图（天地图 / 高德）；
3. **路网匹配**：点击「加载路网」→ 设置轨迹数/点数 →「执行匹配」；
4. **路径规划**：点击「地图选点」依次选起终点 →「规划路径」。

匹配结果图层说明：

| 图层 | 颜色 | 含义 |
|------|------|------|
| 原始 GPS | 白色点 | 带噪声的合成轨迹 |
| 纠偏轨迹 | 青色线 | HMM 匹配后路径 |
| 匹配路段 | 橙色粗线 | 匹配到的 link |
| 投影点 | 绿色点 | GPS 在 link 上的投影 |
| 路网 | 蓝色半透明 | 底图路网 |
| 规划路径 | 紫色线 | Dijkstra 最短路 |

## 3. 天地图 token（可选）

新建 `.env.local`（已在 `.gitignore`）：

```bash
VITE_TIANDITU_TOKEN=你的token
```

未配置 token 时可切换到「高德」或「离线瓦片」底图。

## 4. 后端 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/network` | GET | 路网 GeoJSON（1467 links） |
| `/api/match` | POST | HMM 路网匹配，返回完整 GeoJSON |
| `/api/route` | POST | 最短路径规划（起终点经纬度） |
| `/api/generate` | POST | 生成合成 GPS 轨迹 |

`POST /api/match` 请求示例：

```json
{ "num_trips": 3, "points_per_trip": 80 }
```

`POST /api/route` 请求示例：

```json
{
  "origin": { "lng": 116.25, "lat": 39.90 },
  "destination": { "lng": 116.28, "lat": 39.92 }
}
```

坐标系：路网与 API 业务数据为 **GCJ-02**；前端按底图类型自动转换（天地图 WGS84 / 高德 GCJ-02）。

## 5. 项目结构

```
cesium-digital-map/
├── backend/
│   ├── main.py              # FastAPI 入口
│   ├── match_engine.py      # gotrackit HMM 匹配
│   ├── route_engine.py      # Dijkstra 最短路径
│   ├── requirements.txt
│   └── data/
│       ├── beijing_network.geojson   # 1467 条路段
│       └── beijing_nodes.geojson     # 1341 个节点
├── src/
│   ├── main.js
│   └── modules/
│       ├── mapControl.js       # 底图切换
│       ├── roadNetLayer.js     # 路网渲染
│       ├── trajectoryLayer.js  # 匹配结果渲染
│       ├── routeLayer.js       # 路径规划渲染
│       └── routePickMode.js    # 地图选点
├── index.html
├── package.json
└── vite.config.js
```

## 6. 路网数据

- 北京区域真实路网（高德 API 逆向生成），覆盖约 116.21°–116.31°E、39.86°–39.95°N；
- 合成 GPS 沿路网拓扑游走并叠加高斯噪声，用于演示 HMM 匹配；
- 匹配临时输出（`backend/data/beijing_match-*`）与 `sample_trips.geojson` 已在 `.gitignore` 中忽略。

## 7. 专题栅格图

将专题图导出为 PNG + 世界文件（如 `public/map/beijing-pm25-population-2016-mapframe.png`），通过 `SingleTileImageryProvider` 叠加。路径需与 `src/main.js` 中配置一致。

## 8. 离线瓦片

```
public/tiles/{z}/{x}/{y}.png
```

## 9. 打包与局域网部署

```bash
npm run build
```

`dist/` 由 `vite-plugin-cesium` 打包 Cesium 资源，可交给 Nginx 托管。后端需单独部署并保证前端可访问 `http://<host>:8765`（或修改 `src/modules/trajectoryLayer.js` / `routeLayer.js` 中的 `API_BASE`）。

## 10. 大体积 GeoTIFF 离线切片

根目录 `map/` 及 `*.tif` 已在 `.gitignore` 中忽略。大体积 GeoTIFF 建议用 GDAL / QGIS 切成 XYZ 瓦片后放到 `public/tiles-pop/`，前端用 `UrlTemplateImageryProvider` 按需加载。

```bash
gdal2tiles.py -z 0-8 -w none -r bilinear -p mercator input.tif public/tiles-pop
```

## 11. 更新记录

### 2026-06-06

- **后端**：FastAPI + gotrackit 路网匹配（HMM）与 Dijkstra 最短路径规划；
- **前端**：路网 / 轨迹 / 路径规划图层，地图交互选点，底图坐标系自适应；
- **数据**：北京真实路网（1467 links），沿路网合成 GPS 演示匹配流程。

### 2026-04-22

- 毛玻璃控制面板、GIS 图例与比例尺、专题栅格加载与视角漫游优化。
