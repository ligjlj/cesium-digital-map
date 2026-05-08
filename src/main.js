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

// Viewer 初始化：关闭 Cesium 原生 UI，仅保留画布与场景（底图由自建面板控制）
const viewer = new Cesium.Viewer("cesiumContainer", {
  imageryProvider: false,
  baseLayerPicker: false,
  geocoder: false,
  homeButton: false,
  sceneModePicker: false,
  navigationHelpButton: false,
  navigationInstructionsInitiallyVisible: false,
  animation: false,
  timeline: false,
  fullscreenButton: false,
  selectionIndicator: false,
  infoBox: false,
  vrButton: false,
  projectionPicker: false,
  shouldAnimate: true,
  // Credits 挂到隐藏节点，避免默认叠在画布角落（合规场景可改为可见容器）
  creditContainer: document.getElementById("credit-sink")
});

// 进一步清理默认图层（不同版本 Cesium 在 imageryProvider:false 时行为略有差异）
viewer.imageryLayers.removeAll();

// 初始相机：北京区域正俯视（高度约 520km，便于与专题图尺度一致）
const BEIJING_THEMATIC_EXTENT = {
  west: 115.5,
  south: 39.4,
  east: 117.5,
  north: 41.0
};
const beijingCenterLon = (BEIJING_THEMATIC_EXTENT.west + BEIJING_THEMATIC_EXTENT.east) / 2;
const beijingCenterLat = (BEIJING_THEMATIC_EXTENT.south + BEIJING_THEMATIC_EXTENT.north) / 2;
viewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(beijingCenterLon, beijingCenterLat, 520_000.0),
  orientation: {
    heading: Cesium.Math.toRadians(0),
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
  rootEl: document.getElementById("scaleBar"),
  labelEl: document.getElementById("scaleBarLabel"),
  barEl: document.getElementById("scaleBarBar"),
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
const btnFlyGo = document.getElementById("btnFlyGo");
const btnFlyCancel = document.getElementById("btnFlyCancel");
const groupFlyRoam = document.getElementById("groupFlyRoam");

/** 专题图加载后禁用漫游，避免与专题视角冲突；清空后恢复。 */
function setFlyRoamUiEnabled(enabled) {
  const on = Boolean(enabled);
  if (selectFlyPreset) selectFlyPreset.disabled = !on;
  if (btnFlyGo) btnFlyGo.disabled = !on;
  if (btnFlyCancel) btnFlyCancel.disabled = !on;
  groupFlyRoam?.classList.toggle("is-disabled", !on);
}

btnFlyGo?.addEventListener("click", () => {
  const v = selectFlyPreset?.value;
  if (v) cameraController.patrolAbovePreset(v);
});
btnFlyCancel?.addEventListener("click", () => {
  cameraController.cancelPatrol();
});

document.getElementById("btnLoadThematic")?.addEventListener("click", async () => {
  try {
    cameraController.interrupt?.();

    await thematicLayer.loadSingleTile({
      imageUrl: "/map/beijing-pm25-population-2016-mapframe.png",
      rectangleDegrees: BEIJING_THEMATIC_EXTENT,
      alpha: 0.92,
      transparentBlack: false,
      transparentWhite: false
    });
    setFlyRoamUiEnabled(false);

    cameraController.interrupt?.();
    // 专题范围较小：正俯视 + 固定高度，比默认 fit-rectangle 更近、层次更清楚
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(beijingCenterLon, beijingCenterLat, 185_000.0),
      orientation: {
        heading: Cesium.Math.toRadians(0),
        pitch: Cesium.Math.toRadians(-90),
        roll: 0
      },
      duration: 1.35
    });
  } catch (err) {
    console.error("[Thematic] 加载失败：", err);
  }
});
document.getElementById("btnClearThematic")?.addEventListener("click", () => {
  thematicLayer.clear();
  cameraController.returnToInitial();
  setFlyRoamUiEnabled(true);
});

// 默认底图：天地图（如果 token 未配置，会在控制台给出提示）
baseMapManager.setBaseMap("tianditu");
if (selectBaseMap) selectBaseMap.value = "tianditu";

