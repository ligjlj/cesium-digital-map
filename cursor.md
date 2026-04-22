# Cesium 纯本地化数字地球与专题图项目规范 (Project Specification)

## 1. 项目概述
本项目是一个基于 WebGL 的三维数字地球展示平台，核心要求是**完全切断外部云服务依赖（去云化）**，实现纯本地化部署。平台需支持多源底图切换（需处理坐标系偏移）、三维空间漫游，并能够加载**由 TIF 等栅格成果渲染/导出的、带地理坐标的专题图图片**，在球面上以影像图层方式叠加展示（`SingleTileImageryProvider`）。

## 2. 技术栈与环境
- **构建工具**: Vite (Vanilla JavaScript 模板)
- **核心引擎**: Cesium.js
- **依赖插件**: `vite-plugin-cesium` (处理三维引擎的静态资源预构建)
- **部署环境**: Nginx / 纯局域网

## 3. 代码与工程规范
- **注释要求**: 核心业务逻辑、坐标转换、视角控制等代码段必须附带详尽的中文注释。
- **变量命名**: 采用小驼峰命名法。尽量简短但表意明确（如：`viewer`, `mapLayer`, `poiData`, `flyTarget`）。
- **模块化**: 尽量将底图控制、相机漫游、专题图渲染封装成独立的 JS 模块（如 `mapControl.js`, `thematicLayer.js`）。

---

## 4. 核心功能实现路径 (按顺序开发)

### 模块一：环境与底座初始化 (Core Init)
1. 配置 `vite.config.js`，引入 Cesium 插件并配置局域网访问端口。
2. 在 `main.js` 中初始化 `Viewer`。
3. **关键安全与去云化配置**:
   - `Cesium.Ion.defaultAccessToken = null;`
   - 隐藏所有默认 UI 控件（`geocoder: false`, `homeButton: false`, `timeline: false`, `animation: false` 等）。
   - 将初始相机视角锁定在北京区域，高度约 2000 公里。

### 模块二：多源底图与坐标系适配 (Base Map)
构建一个底图切换管理器，支持以下三种模式的动态切换，并默认不加载 Cesium 官方基础底图：
1. **天地图 (默认)**: 加载天地图 WMTS 影像与注记服务（原生 WGS84 坐标系）。
2. **高德地图**: 使用 `UrlTemplateImageryProvider` 加载高德底图。**必须在渲染侧或请求侧加入 GCJ-02 到 WGS84 的纠偏逻辑**，确保空间要素叠加不产生偏移。
3. **离线瓦片**: 加载存放在 `public/tiles/{z}/{x}/{y}.png` 的本地离线数据。

### 模块三：空间漫游控制 (Camera Control)
封装一个相机飞行动画函数 `flyToDestination(lon, lat, height, heading, pitch)`：
- 支持平滑过渡。
- 预设几个关键视角（如：故宫、高层建筑群），并绑定到 UI 界面的控制按钮上。

### 模块四：电子专题图加载与渲染 (Thematic Map — 栅格 / TIF 成果)
专题图以**单幅带地理定位的栅格图**形式叠加在地球上展示，典型来源为 **TIF 成果经渲染或导出**得到的 PNG/JPEG 等图片（保留空间范围），不在此模块强制要求矢量 GeoJSON 流程。

1. **数据与文件形态**:
   - **栅格图**：由 TIF（或同类栅格）导出为浏览器可直接访问的图片（如 `tif2.png`），置于 `public/` 下由静态路径访问（例如 `/map/xxx.png`）。
   - **地理定位**：配套**世界文件**（如 ArcGIS 风格的 `.pgw` / `.tfw` 等，六行仿射参数：像素大小、旋转、左上角像元中心等），用于从像素尺寸推算图幅的 **west / south / east / north**（经纬度矩形范围）。当前实现以**无旋转**世界文件为主（B、D 近似为 0）；若存在旋转，需扩展四角计算或预处理为直立北向图幅。
2. **Cesium 渲染方式**:
   - 使用 `Cesium.SingleTileImageryProvider`：根据图片 URL、由世界文件与像素宽高算出的 `rectangle`，以及对应的 `tileWidth` / `tileHeight`，将整幅图作为**单瓦片影像层**贴地叠加。
   - 通过 `viewer.imageryLayers` 控制透明度（如 `alpha`），并可选择加载后 `camera.flyTo(rectangle)` 便于核对套合效果。
3. **UI 与交互（与实现一致即可）**:
   - 提供「加载/刷新」「清空」等控制：加载时读取图片尺寸与世界文件、创建/替换影像图层；清空时移除该图层并恢复相机等状态。
   - **图例**：若业务需要，可对应该栅格专题图展示简单色带/说明（与像素内容对应，非矢量属性驱动）。

---

## 5. 本地化打包与部署要求
1. 构建命令：`npm run build`。
2. 确保打包后的 `dist` 目录下完整包含 Cesium 的 `Assets`, `Workers`, `Widgets` 目录。
3. 保证在无外网连接的局域网内，通过 Nginx 托管 `dist` 目录能正常渲染地球、加载**本地专题栅格图（及世界文件）**与本地底图瓦片；若使用高德反代，生产环境需配置与开发环境一致的 `/gaode` 代理规则。