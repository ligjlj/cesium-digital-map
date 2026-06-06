/**
 * 路径规划 — 地图选点模式
 * 开启后在地图上依次选择起点、终点（GCJ-02）
 */

import * as Cesium from "cesium";
import { fromDisplayLonLat, toDisplayLonLat } from "./coordForBasemap.js";

const DS_NAME = "route-pick-layer";

/**
 * @param {Cesium.Viewer} viewer
 * @param {object} options
 * @param {() => string} options.getBasemapType
 * @param {(phase: 'origin'|'destination', gcj: {lng:number, lat:number}) => void} [options.onPick]
 * @param {(text: string) => void} [options.onHintChange]
 */
export function createRoutePickMode(viewer, options = {}) {
  const { getBasemapType, onPick, onHintChange } = options;

  /** @type {Cesium.CustomDataSource|null} */
  let ds = null;
  /** @type {Cesium.ScreenSpaceEventHandler|null} */
  let handler = null;
  let enabled = false;
  /** @type {'origin'|'destination'} */
  let phase = "origin";
  /** @type {{lng:number, lat:number}|null} */
  let origin = null;
  /** @type {{lng:number, lat:number}|null} */
  let destination = null;

  function hint() {
    if (!enabled) return "";
    return phase === "origin" ? "请在地图上点击选择起点" : "请在地图上点击选择终点";
  }

  function emitHint() {
    onHintChange?.(hint());
  }

  function clearMarkers() {
    if (ds) {
      viewer.dataSources.remove(ds, true);
      ds = null;
    }
  }

  function addMarker(type, gcj) {
    if (!ds) {
      ds = new Cesium.CustomDataSource(DS_NAME);
      viewer.dataSources.add(ds);
    }

    const name = type === "origin" ? "pick-origin" : "pick-destination";
    const existing = ds.entities.getById(name);
    if (existing) ds.entities.remove(existing);

    const [lon, lat] = toDisplayLonLat(gcj.lng, gcj.lat, getBasemapType?.() || "tianditu");
    const isOrigin = type === "origin";

    ds.entities.add({
      id: name,
      name,
      position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
      point: {
        pixelSize: 12,
        color: isOrigin ? Cesium.Color.LIME : Cesium.Color.RED,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: isOrigin ? "起" : "终",
        font: "13px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }

  function pickLonLat(screenPosition) {
    const cartesian =
      viewer.scene.pickPosition(screenPosition) ||
      viewer.camera.pickEllipsoid(screenPosition, viewer.scene.globe.ellipsoid);
    if (!cartesian) return null;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    return {
      lon: Cesium.Math.toDegrees(carto.longitude),
      lat: Cesium.Math.toDegrees(carto.latitude),
    };
  }

  function handleClick(screenPosition) {
    const display = pickLonLat(screenPosition);
    if (!display) return;

    const basemapType = getBasemapType?.() || "tianditu";
    const [lng, lat] = fromDisplayLonLat(display.lon, display.lat, basemapType);
    const gcj = {
      lng: Math.round(lng * 1e6) / 1e6,
      lat: Math.round(lat * 1e6) / 1e6,
    };

    if (phase === "origin") {
      origin = gcj;
      addMarker("origin", gcj);
      phase = "destination";
      onPick?.("origin", gcj);
    } else {
      destination = gcj;
      addMarker("destination", gcj);
      phase = "origin";
      onPick?.("destination", gcj);
    }
    emitHint();
  }

  function bindHandler() {
    if (handler) return;
    handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement) => {
      if (!enabled) return;
      handleClick(movement.position);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  function unbindHandler() {
    if (handler) {
      handler.destroy();
      handler = null;
    }
  }

  return {
    isEnabled() {
      return enabled;
    },

    enable() {
      enabled = true;
      phase = origin && !destination ? "destination" : "origin";
      bindHandler();
      viewer.canvas.classList.add("route-pick-active");
      emitHint();
    },

    disable() {
      enabled = false;
      unbindHandler();
      viewer.canvas.classList.remove("route-pick-active");
      onHintChange?.("");
    },

    toggle() {
      if (enabled) this.disable();
      else this.enable();
      return enabled;
    },

    reset() {
      origin = null;
      destination = null;
      phase = "origin";
      clearMarkers();
      if (enabled) emitHint();
    },

    clear() {
      this.reset();
    },

    getOrigin() {
      return origin ? { ...origin } : null;
    },

    getDestination() {
      return destination ? { ...destination } : null;
    },

    isReady() {
      return origin !== null && destination !== null;
    },

    /** 重新选点：保留已选点，从起点开始 */
    restartPick() {
      phase = "origin";
      if (enabled) emitHint();
    },
  };
}
