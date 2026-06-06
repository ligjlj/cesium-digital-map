import "./style.css";

import * as Cesium from "cesium";
import { createBaseMapManager } from "./modules/mapControl.js";
import { createCameraController } from "./modules/cameraControl.js";
import { createThematicLayer } from "./modules/thematicLayer.js";
import { createScaleBar } from "./modules/scaleBar.js";
import { matchAndRender, clearTrajectoryLayer } from "./modules/trajectoryLayer.js";
import { loadRoadNetwork, clearRoadNetwork, isNetworkLoaded } from "./modules/roadNetLayer.js";
import { planRoute, clearRouteLayer } from "./modules/routeLayer.js";
import { createRoutePickMode } from "./modules/routePickMode.js";

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

function getBasemapType() {
  return selectBaseMap?.value || "tianditu";
}

selectBaseMap?.addEventListener("change", async (e) => {
  const v = e.target?.value;
  if (v) baseMapManager.setBaseMap(v);
  // 切换底图后重新加载路网以对齐坐标系
  if (isNetworkLoaded()) {
    try {
      matchStatus.textContent = "底图切换，重新对齐路网...";
      matchStatus.className = "match-status match-status--loading";
      const count = await loadRoadNetwork(viewer, { basemapType: v });
      matchStatus.textContent = `底图已切换，路网已对齐: ${count} 条路段（匹配结果请重新执行）`;
      matchStatus.className = "match-status match-status--ok";
    } catch (err) {
      console.error("[Match] 底图切换后路网对齐失败:", err);
    }
  }
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

// ------------------------------
// 路网匹配 UI 绑定
// ------------------------------
const matchStatus = document.getElementById("matchStatus");

document.getElementById("btnLoadNetwork")?.addEventListener("click", async () => {
  try {
    matchStatus.textContent = "加载路网中...";
    matchStatus.className = "match-status match-status--loading";
    const count = await loadRoadNetwork(viewer, { basemapType: getBasemapType() });
    matchStatus.textContent = `路网已加载: ${count} 条路段`;
    matchStatus.className = "match-status match-status--ok";
  } catch (err) {
    console.error("[Match] 加载路网失败:", err);
    matchStatus.textContent = "路网加载失败";
    matchStatus.className = "match-status match-status--error";
  }
});

document.getElementById("btnClearNetwork")?.addEventListener("click", () => {
  clearRoadNetwork(viewer);
  matchStatus.textContent = "";
  matchStatus.className = "match-status";
});

document.getElementById("btnRunMatch")?.addEventListener("click", async () => {
  try {
    matchStatus.textContent = "匹配中...";
    matchStatus.className = "match-status match-status--loading";

    const numTrips = parseInt(document.getElementById("inputTripNum")?.value) || 3;
    const pointsPer = parseInt(document.getElementById("inputPointsPer")?.value) || 80;

    const summary = await matchAndRender(viewer, {
      numTrips,
      pointsPerTrip: pointsPer,
      basemapType: getBasemapType(),
    });

    matchStatus.textContent =
      `匹配完成: ${summary.trip_count} 轨迹, ${summary.total_points} 点, ` +
      `${summary.total_unique_links} links, 平均投影 ${summary.avg_proj_distance_m.toFixed(0)}m, ` +
      `有效率 ${(summary.overall_match_rate * 100).toFixed(0)}%`;
    matchStatus.className = "match-status match-status--ok";
  } catch (err) {
    console.error("[Match] 匹配失败:", err);
    matchStatus.textContent = "匹配失败，请先加载路网";
    matchStatus.className = "match-status match-status--error";
  }
});

document.getElementById("btnClearMatch")?.addEventListener("click", () => {
  clearTrajectoryLayer(viewer);
  matchStatus.textContent = "";
  matchStatus.className = "match-status";
});

// ------------------------------
// 路径规划 UI 绑定（仅地图选点）
// ------------------------------
const routeStatus = document.getElementById("routeStatus");
const routePickHint = document.getElementById("routePickHint");
const btnRoutePick = document.getElementById("btnRoutePick");
const btnRoutePickReset = document.getElementById("btnRoutePickReset");

const routePickMode = createRoutePickMode(viewer, {
  getBasemapType,
  onPick(phase, gcj) {
    routeStatus.textContent =
      phase === "origin"
        ? `起点已选 (${gcj.lng}, ${gcj.lat})，请选择终点`
        : `终点已选 (${gcj.lng}, ${gcj.lat})，可点击「规划路径」`;
    routeStatus.className = "match-status match-status--ok";
  },
  onHintChange(text) {
    if (routePickHint) {
      routePickHint.textContent = text;
      routePickHint.classList.toggle("route-pick-hint--active", Boolean(text));
    }
  },
});

function setRoutePickUiActive(active) {
  btnRoutePick?.classList.toggle("btn-active", active);
  if (btnRoutePick) {
    btnRoutePick.textContent = active ? "选点中…" : "地图选点";
  }
}

btnRoutePick?.addEventListener("click", () => {
  const on = routePickMode.toggle();
  setRoutePickUiActive(on);
});

btnRoutePickReset?.addEventListener("click", () => {
  routePickMode.reset();
  routeStatus.textContent = routePickMode.isEnabled() ? "" : routeStatus.textContent;
  if (routePickMode.isEnabled()) {
    routeStatus.textContent = "已清除选点，请重新在地图上选择起点";
    routeStatus.className = "match-status";
  }
});

document.getElementById("btnPlanRoute")?.addEventListener("click", async () => {
  try {
    routeStatus.textContent = "规划中...";
    routeStatus.className = "match-status match-status--loading";

    const origin = routePickMode.getOrigin();
    const destination = routePickMode.getDestination();

    if (!origin || !destination) {
      throw new Error("请先在地图上选择起点和终点");
    }

    const summary = await planRoute(viewer, {
      origin,
      destination,
      basemapType: getBasemapType(),
    });

    routePickMode.disable();
    setRoutePickUiActive(false);

    routeStatus.textContent =
      `路径: ${summary.length_km} km, ${summary.link_count} 路段, ` +
      `节点 ${summary.o_node} → ${summary.d_node}`;
    routeStatus.className = "match-status match-status--ok";
  } catch (err) {
    console.error("[Route] 规划失败:", err);
    routeStatus.textContent = err.message || "路径规划失败";
    routeStatus.className = "match-status match-status--error";
  }
});

document.getElementById("btnClearRoute")?.addEventListener("click", () => {
  clearRouteLayer(viewer);
  routePickMode.clear();
  setRoutePickUiActive(false);
  routeStatus.textContent = "";
  routeStatus.className = "match-status";
});
