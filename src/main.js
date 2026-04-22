import "./style.css";

import * as Cesium from "cesium";
import { createBaseMapManager } from "./modules/mapControl.js";
import { createCameraController } from "./modules/cameraControl.js";
import { createThematicLayer } from "./modules/thematicLayer.js";
import { createScaleBar } from "./modules/scaleBar.js";

// ------------------------------
// 模块一：环境与底座初始化 (Core Init)
// ------------------------------
// 去云化关键配置：彻底禁用 Cesium Ion（避免任何外部云服务依赖）
Cesium.Ion.defaultAccessToken = null;

// Viewer 初始化（隐藏默认 UI 控件，减少 Cesium 默认联网行为）
const viewer = new Cesium.Viewer("cesiumContainer", {
  // 禁用默认底图：由我们自己管理多源底图
  imageryProvider: false,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  selectionIndicator: false,
  infoBox: false,
  vrButton: false,
  shouldAnimate: true
});

// 隐藏 Cesium 默认 credits（水印/署名区域）
// 注意：如果你需要合规展示 Cesium/数据源署名，请删除这段。
viewer.cesiumWidget.creditContainer.style.display = "none";

// 进一步清理默认图层（不同版本 Cesium 在 imageryProvider:false 时行为略有差异）
viewer.imageryLayers.removeAll();

// 初始相机锁定北京正上空，高度约 2000km（2,000,000m）
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(116.3913, 39.9075, 2_000_000.0),
  orientation: {
    heading: Cesium.Math.toRadians(0),
    // -90 表示正俯视（在目标点上空向下看）
    pitch: Cesium.Math.toRadians(-90),
    roll: 0
  }
});

// ------------------------------
// 模块二：多源底图与坐标系适配 (Base Map)
// ------------------------------
const baseMapManager = createBaseMapManager(viewer);

// ------------------------------
// 模块三：空间漫游控制 (Camera Control)
// ------------------------------
const cameraController = createCameraController(viewer);

// ------------------------------
// 模块四：电子专题图加载与渲染 (Thematic Map)
// ------------------------------
const thematicLayer = createThematicLayer(viewer, {
  tooltipEl: document.getElementById("tooltip"),
  legendEl: document.getElementById("legend")
});

// 常态比例尺（随地图缩放实时更新）
createScaleBar(viewer, {
  labelEl: document.getElementById("scaleBarLabel"),
  fillEl: document.getElementById("scaleBarFill"),
  maxWidthPx: 140
});

// ------------------------------
// UI 绑定（保持 UI 极简，核心能力通过模块实现）
// ------------------------------
const selectBaseMap = document.getElementById("selectBaseMap");
selectBaseMap?.addEventListener("change", (e) => {
  const v = e.target?.value;
  if (v) baseMapManager.setBaseMap(v);
});

const selectFlyPreset = document.getElementById("selectFlyPreset");
document.getElementById("btnFlyGo")?.addEventListener("click", () => {
  const v = selectFlyPreset?.value;
  if (v) cameraController.patrolAbovePreset(v);
});
document.getElementById("btnFlyCancel")?.addEventListener("click", () => {
  cameraController.cancelPatrol();
});

document.getElementById("btnLoadThematic")?.addEventListener("click", async () => {
  // 专题图影像（SingleTileImageryProvider）
  // 注意：tif2.png 必须放在 public/map/中国_省/ 下，才能通过 /map/... 访问
  await thematicLayer.loadSingleTile({
    // 你当前的文件结构：
    // - public/map/tif2.png
    // - public/map/中国_省/tif2.pgw
    imageUrl: "/map/tif2.png",
    worldFileUrl: "/map/中国_省/tif2.pgw",
    alpha: 0.85
  });
});
document.getElementById("btnClearThematic")?.addEventListener("click", () => {
  thematicLayer.clear();
  cameraController.returnToInitial();
});

// 默认底图：天地图（如果 token 未配置，会在控制台给出提示）
baseMapManager.setBaseMap("tianditu");
if (selectBaseMap) selectBaseMap.value = "tianditu";

