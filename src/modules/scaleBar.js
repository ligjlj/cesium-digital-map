import * as Cesium from "cesium";

/**
 * 比例尺（随地图缩放自适应）
 *
 * 设计目标：
 * - 常态显示在左下角
 * - 随相机高度/倾角变化自动更新
 * - 文案只显示一个“标称距离”（m / km），不依赖外部服务
 *
 * 实现要点：
 * - 在屏幕底部中心位置取两点（左右相隔固定像素），用 pickRay + globe.pick 得到地面坐标
 * - 计算两点间真实地表距离（近似用 Cartesian3.distance）
 * - 得到 metersPerPixel 后，选择“好看”的标尺长度（1/2/5 × 10^n）
 */
export function createScaleBar(viewer, { labelEl, fillEl, maxWidthPx = 140 }) {
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
    // 目标：条形宽度落在 80%~100% maxWidthPx 之间，看起来更“满”
    const targetMeters = metersPerPixel * maxWidthPx * 0.9;
    const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(targetMeters, 1))));
    const candidates = [1, 2, 5, 10].map((k) => k * pow10);

    // 选择不超过 targetMeters 的最大候选
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

    // 屏幕底部中心略上移，避免 pick 到天空/边缘
    const y = height - 30;
    const x0 = Math.floor(width / 2 - maxWidthPx / 2);
    const x1 = Math.floor(width / 2 + maxWidthPx / 2);

    const ray0 = viewer.camera.getPickRay(new Cesium.Cartesian2(x0, y));
    const ray1 = viewer.camera.getPickRay(new Cesium.Cartesian2(x1, y));
    if (!ray0 || !ray1) return;

    const p0 = globe.pick(ray0, scene);
    const p1 = globe.pick(ray1, scene);

    // 当相机离地过高或视角特殊时，可能 pick 不到地表
    if (!p0 || !p1) {
      if (labelEl) labelEl.textContent = "--";
      if (fillEl) fillEl.style.width = "0px";
      return;
    }

    const meters = Cesium.Cartesian3.distance(p0, p1);
    const metersPerPixel = meters / maxWidthPx;
    const niceMeters = chooseNiceLength(metersPerPixel);
    const barPx = Math.max(0, Math.min(maxWidthPx, niceMeters / metersPerPixel));

    if (labelEl) labelEl.textContent = formatDistance(niceMeters);
    if (fillEl) fillEl.style.width = `${barPx}px`;
  }

  // 在渲染后更新，保证相机/分辨率状态最新
  scene.postRender.addEventListener(update);
  // 初次更新
  update();

  return {
    destroy() {
      scene.postRender.removeEventListener(update);
    }
  };
}

