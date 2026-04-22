# Cesium 纯本地化数字地球与专题图

本项目严格按 `cursor.md` 的流程规范，从零构建一个 **完全去云化** 的 Cesium 数字地球底座，支持：

- 多源底图切换：天地图 WMTS / 高德（GCJ-02→WGS84 纠偏）/ 本地离线瓦片
- 相机漫游：`flyToDestination` + 预设视角按钮
- 电子专题图：由 **TIF 等成果导出为带地理坐标的栅格图**（如 PNG）+ **世界文件**（如 `.pgw`），通过 `SingleTileImageryProvider` 在球面叠加；界面提供加载/清空与图例说明

## 1. 环境准备

- Node.js 18+（推荐 20+）
- npm 9+

## 2. 安装与运行

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173/`。

## 3. 天地图 token（可选）

天地图 WMTS 通常需要 token。你可以用 Vite 环境变量配置：

- 新建 `.env.local`，写入：

```bash
VITE_TIANDITU_TOKEN=你的token
```

不配置 token 也能运行项目，但“天地图”底图可能无法访问，可切换到“离线瓦片”或“高德”。

## 4. 专题栅格图（TIF 导出 + 世界文件）

将专题图导出为图片（如 `public/map/tif2.png`），并准备与之配套的六行世界文件（如 `public/map/中国_省/tif2.pgw`）。应用内通过 `SingleTileImageryProvider` 读取图片尺寸与世界文件计算四至范围并贴图；具体路径需与 `src/main.js` 中 `loadSingleTile` 的配置一致。

## 5. 离线瓦片目录

将离线瓦片按以下结构放入 `public/tiles/`：

```
public/tiles/{z}/{x}/{y}.png
```

## 6. 打包与局域网部署

```bash
npm run build
```

要求：`dist/` 内包含 Cesium 的 `Assets/Workers/Widgets` 等资源（由 `vite-plugin-cesium` 处理）。

将 `dist/` 交给 Nginx 托管即可在 **无外网** 局域网环境运行（前提是你使用的底图资源本身可在局域网访问或为离线瓦片）。

## 7. 更新记录

### 2026-04-22

- **界面**：左上角毛玻璃控制面板（分区标题、底图 / 专题 / 漫游）；右下角 GIS 风格图例（Stretch 色带 + 刻度）与黑白分段比例尺读数。
- **小改动**：专题图图例标题改为《2025中国人口分布图》；支持在右下角比例尺面板上左右拖动，实现低灵敏度的放大/缩小（通过平滑调整相机高度）。
- **专题图视角**：加载专题栅格后自动飞行到专题范围，并增加适度边距（避免画面贴边，缩放到更合适大小）。
- **修复**：加载专题图后不再被“取消漫游→回初始点”覆盖，专题图自动缩放生效。
- **Cesium Viewer**：Credits 挂到页面内隐藏节点 `#credit-sink`，避免默认叠在画布角标区域；关闭 `projectionPicker`、导航帮助初始展示等；移除通过脚本强行隐藏 credit 容器的做法。
- **专题图**：`SingleTileImageryProvider` 加载支持透明黑（`transparentBlack` / `blackThreshold`）等参数；加载失败时控制台报错不中断；加载成功后取消进行中的漫游并禁用「视角漫游」分区，清空专题后恢复初始视角与漫游控件。
- **底图 / 工程**：`mapControl`、比例尺模块与 `package-lock` 等随上述能力调整；`.env.example` 补充天地图可选最大级别说明（缓解 429）。
- **规范文档**：`cursor.md` 与当前实现（专题栅格 + 世界文件、打包目录要求）对齐。
- **资源**：增补 `行政区划图.png` 等地图相关素材（按仓库内 `public/map/` 与 `map/` 实际路径使用）。
