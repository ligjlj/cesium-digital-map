# Cesium 纯本地化数字地球与专题图

本项目严格按 `cursor.md` 的流程规范，从零构建一个 **完全去云化** 的 Cesium 数字地球底座，支持：

- 多源底图切换：天地图 WMTS / 高德（GCJ-02→WGS84 纠偏）/ 本地离线瓦片
- 相机漫游：`flyToDestination` + 预设视角按钮
- 电子专题图：加载 `public/data/` 下 GeoJSON，属性驱动渲染 + 点击要素弹窗

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

## 4. 离线瓦片目录

将离线瓦片按以下结构放入 `public/tiles/`：

```
public/tiles/{z}/{x}/{y}.png
```

## 5. 打包与局域网部署

```bash
npm run build
```

要求：`dist/` 内包含 Cesium 的 `Assets/Workers/Widgets` 等资源（由 `vite-plugin-cesium` 处理）。

将 `dist/` 交给 Nginx 托管即可在 **无外网** 局域网环境运行（前提是你使用的底图资源本身可在局域网访问或为离线瓦片）。

