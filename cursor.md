# Cesium 纯本地化数字地球与专题图项目规范 (Project Specification)

## 1. 项目概述
本项目是一个基于 WebGL 的三维数字地球展示平台，核心要求是**完全切断外部云服务依赖（去云化）**，实现纯本地化部署。平台需支持多源底图切换（需处理坐标系偏移）、三维空间漫游，并能够加载本地空间数据（GeoJSON）生成交互式电子专题图。

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

### 模块四：电子专题图加载与渲染 (Thematic Map)
实现一个基于本地空间数据的业务图层：
1. **数据源**: 使用 `Cesium.GeoJsonDataSource.load()` 读取存放在 `public/data/` 目录下的业务数据（如人口分布或变形监测点）。
2. **数据驱动渲染 (Data-Driven Styling)**:
   - 遍历数据源的 `entities`。
   - 读取要素的 `properties` 字段（如 `value` 或 `level`）。
   - 编写一个 `getColorByValue(val)` 的映射函数，将数值映射为不同的面状填充色 (`material`) 或点状符号大小，实现色阶渲染。
3. **空间交互**: 
   - 注册 `ScreenSpaceEventHandler` 监听鼠标左键 `LEFT_CLICK` 事件。
   - 捕获点击到的要素 (`pickedFeature`)，在屏幕绝对位置或三维坐标点弹出一个自定义的 HTML 悬浮窗（Tooltip），展示该要素的详细属性，点击空白处关闭。

---

## 5. 本地化打包与部署要求
1. 构建命令：`npm run build`。
2. 确保打包后的 `dist` 目录下完整包含 Cesium 的 `Assets`, `Workers`, `Widgets` 目录。
3. 保证在无外网连接的局域网内，通过 Nginx 托管 `dist` 目录能正常渲染地球、加载本地 GeoJSON 与本地瓦片。