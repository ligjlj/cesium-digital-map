/**
 * 轨迹与匹配图层
 * - 从后端 API 拉取匹配结果
 * - 使用 CustomDataSource 隔离，不影响其他图层
 * - 渲染：原始GPS点 → 白色小圆点
 *         纠偏轨迹   → 青色 Polyline
 *         匹配路段   → 橙色粗 Polyline（高亮）
 *         投影点     → 绿色小圆点
 */

import * as Cesium from "cesium";
import { flatCoordsForBasemap, pointListForBasemap } from "./coordForBasemap.js";

const API_BASE = "http://127.0.0.1:8765";

let _dsName = "trajectory-layer";

/**
 * 获取或创建轨迹专用 DataSource
 * @param {Cesium.Viewer} viewer
 * @returns {Cesium.CustomDataSource}
 */
function _getDataSource(viewer) {
  let ds = viewer.dataSources.getByName(_dsName)[0];
  if (!ds) {
    ds = new Cesium.CustomDataSource(_dsName);
    viewer.dataSources.add(ds);
  } else {
    ds.entities.removeAll();
  }
  return ds;
}

/**
 * 清空轨迹图层
 */
export function clearTrajectoryLayer(viewer) {
  const ds = viewer.dataSources.getByName(_dsName)[0];
  if (ds) {
    viewer.dataSources.remove(ds, true);
  }
}

/** 从 GeoJSON FeatureCollection 提取 Polyline 坐标（LineString 或按 seq 排序的 Point 序列） */
function _extractPolylineCoords(fc) {
  const coords = [];
  if (!fc?.features?.length) return coords;

  const feats = [...fc.features];
  const allPoints = feats.every((f) => f.geometry?.type === "Point");

  if (allPoints) {
    feats.sort((a, b) => {
      const sa = a.properties?.seq ?? 0;
      const sb = b.properties?.seq ?? 0;
      return sa - sb;
    });
    for (const feat of feats) {
      const c = feat.geometry.coordinates;
      coords.push(c[0], c[1]);
    }
    return coords;
  }

  for (const feat of feats) {
    if (feat.geometry?.type === "LineString") {
      for (const c of feat.geometry.coordinates) coords.push(c[0], c[1]);
    }
  }
  return coords;
}

/** @deprecated 使用 _extractPolylineCoords */
function _extractLineCoords(fc) {
  return _extractPolylineCoords(fc);
}

/** 从 GeoJSON FeatureCollection 提取 Point 坐标 */
function _extractPointCoords(fc) {
  const coords = [];
  if (!fc?.features) return coords;
  for (const feat of fc.features) {
    if (feat.geometry?.type === "Point") {
      coords.push(feat.geometry.coordinates);
    }
  }
  return coords;
}

/**
 * 渲染单条轨迹的匹配结果
 */
function _renderTrip(ds, agentId, tripData, basemapType) {
  // 1. 原始GPS点（白色小圆点）
  const rawPts = pointListForBasemap(_extractPointCoords(tripData.raw_gps), basemapType);
  for (let i = 0; i < rawPts.length; i++) {
    const [lon, lat] = rawPts[i];
    ds.entities.add({
      name: `${agentId}-raw-${i}`,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      point: {
        pixelSize: 4,
        color: Cesium.Color.WHITE.withAlpha(0.65),
        outlineColor: Cesium.Color.DIMGREY,
        outlineWidth: 1,
      },
    });
  }

  // 2. 纠偏轨迹（青色 Polyline）
  const correctedCoords = flatCoordsForBasemap(
    _extractPolylineCoords(tripData.corrected_traj),
    basemapType
  );
  if (correctedCoords.length >= 4) {
    ds.entities.add({
      name: `${agentId}-corrected`,
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(correctedCoords),
        width: 2.5,
        material: Cesium.Color.CYAN.withAlpha(0.85),
        clampToGround: true,
      },
    });
  }

  // 3. 匹配路段（橙色粗线）
  const links = tripData.matched_links;
  if (links?.features) {
    for (const feat of links.features) {
      if (feat.geometry?.type !== "LineString") continue;
      const coords = flatCoordsForBasemap(feat.geometry.coordinates.flat(), basemapType);
      ds.entities.add({
        name: `${agentId}-link-${feat.properties?.link_id ?? ""}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray(coords),
          width: 6,
          material: Cesium.Color.ORANGE.withAlpha(0.9),
          clampToGround: true,
        },
      });
    }
  }

  // 4. 投影点（绿色小圆点）
  const prjPts = pointListForBasemap(_extractPointCoords(tripData.prj_points), basemapType);
  for (const [lon, lat] of prjPts) {
    ds.entities.add({
      name: `${agentId}-prj`,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      point: {
        pixelSize: 5,
        color: Cesium.Color.LIME.withAlpha(0.8),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
      },
    });
  }
}

/**
 * 执行匹配并渲染所有轨迹
 * @param {Cesium.Viewer} viewer
 * @param {object} [options]
 */
export async function matchAndRender(viewer, options = {}) {
  const { numTrips = 3, pointsPerTrip = 30, basemapType = "tianditu" } = options;

  clearTrajectoryLayer(viewer);
  const ds = _getDataSource(viewer);

  const resp = await fetch(`${API_BASE}/api/match`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ num_trips: numTrips, points_per_trip: pointsPerTrip }),
  });
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  const result = await resp.json();
  if (result.status !== "ok") throw new Error(result.detail || "匹配失败");

  const rawFc = result.raw_trips;
  const allEntities = [];

  for (const trip of result.trips) {
    const rawFeatures = (rawFc?.features || []).filter(
      (f) => f.properties?.agent_id === trip.agent_id
    );
    _renderTrip(ds, trip.agent_id, {
      raw_gps: { type: "FeatureCollection", features: rawFeatures },
      corrected_traj: trip.corrected_traj,
      matched_links: trip.matched_links,
      prj_points: trip.prj_points,
    }, basemapType);

    // 收集用于 flyTo 的 entity
    const correctedCoords = flatCoordsForBasemap(
      _extractPolylineCoords(trip.corrected_traj),
      basemapType
    );
    if (correctedCoords.length >= 4) {
      const e = ds.entities.values[ds.entities.values.length - 1];
      if (e) allEntities.push(e);
    }
  }

  if (allEntities.length > 0) {
    viewer.flyTo(allEntities, {
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), 8000),
      duration: 1.5,
    });
  }

  return result.summary;
}
