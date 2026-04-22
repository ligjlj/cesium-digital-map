import * as Cesium from "cesium";

/**
 * 比例尺（随地图缩放自适应）
 *
 * - 屏幕底部附近取两点估算地面距离，动态更新标称长度与黑白分段条宽度
 * - 单位随距离在 m / km 间切换
 */
export function createScaleBar(viewer, { labelEl, barEl, maxWidthPx = 140 }) {
  const scene = viewer.scene;
  const canvas = scene.canvas;
  const globe = scene.globe;

  function formatDistance(meters) {
    if (meters >= 1000) {
      const km = meters / 1000;
      return km >= 10 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
    }
    return meters >= 100 ? `${Math.round(meters)} m` : `${Math.round(meters / 10) * 10} m`;
  }

  function chooseNiceLength(metersPerPixel) {
    const targetMeters = metersPerPixel * maxWidthPx * 0.9;
    const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(targetMeters, 1))));
    const candidates = [1, 2, 5, 10].map((k) => k * pow10);

    let chosen = candidates[0];
    for (const c of candidates) {
      if (c <= targetMeters) chosen = c;
    }
    return chosen;
  }

  function update() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;

    const y = height - 30;
    const x0 = Math.floor(width / 2 - maxWidthPx / 2);
    const x1 = Math.floor(width / 2 + maxWidthPx / 2);

    const ray0 = viewer.camera.getPickRay(new Cesium.Cartesian2(x0, y));
    const ray1 = viewer.camera.getPickRay(new Cesium.Cartesian2(x1, y));
    if (!ray0 || !ray1) return;

    const p0 = globe.pick(ray0, scene);
    const p1 = globe.pick(ray1, scene);

    if (!p0 || !p1) {
      if (labelEl) labelEl.textContent = "--";
      if (barEl) barEl.style.width = "0px";
      return;
    }

    const meters = Cesium.Cartesian3.distance(p0, p1);
    const metersPerPixel = meters / maxWidthPx;
    const niceMeters = chooseNiceLength(metersPerPixel);
    const barPx = Math.max(0, Math.min(maxWidthPx, niceMeters / metersPerPixel));

    if (labelEl) labelEl.textContent = formatDistance(niceMeters);
    if (barEl) barEl.style.width = `${barPx}px`;
  }

  scene.postRender.addEventListener(update);
  update();

  return {
    destroy() {
      scene.postRender.removeEventListener(update);
    }
  };
}
