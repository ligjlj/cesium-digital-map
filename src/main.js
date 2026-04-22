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
  // 专题图影像（SingleTileImageryProvider）
  // 注意：tif2.png 必须放在 public/map/中国_省/ 下，才能通过 /map/... 访问
  try {
    // 任何时刻加载专题图：立刻中断现有相机操作 + 回正
    cameraController.interruptAndUpright?.();

    const { rectangle } = await thematicLayer.loadSingleTile({
      imageUrl: "/map/tif2.png",
      worldFileUrl: "/map/中国_省/tif2.pgw",
      alpha: 0.92,
      transparentBlack: true,
      blackThreshold: 24,
      transparentWhite: false
    });
    setFlyRoamUiEnabled(false);

    // 再次确保不受任何残留飞行/漫游影响，然后 zoom 到专题范围
    cameraController.interruptAndUpright?.();
    viewer.camera.flyTo({
      destination: rectangle,
      orientation: {
        heading: 0,
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

