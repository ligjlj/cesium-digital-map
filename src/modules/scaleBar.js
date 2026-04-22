import * as Cesium from "cesium";

/**
 * 比例尺（随地图缩放自适应）
 *
 * - 屏幕底部附近取两点估算地面距离，动态更新标称长度与黑白分段条宽度
 * - 单位随距离在 m / km 间切换
 */
export function createScaleBar(viewer, { rootEl, labelEl, barEl, maxWidthPx = 140 } = {}) {
  const scene = viewer.scene;
  const canvas = scene.canvas;
  const globe = scene.globe;

  // ---------- 拖动缩放（低灵敏度） ----------
  // 通过“相机高度”实现缩放；横向拖动越多，缩放变化越明显（但系数刻意调低）
  const minHeight = 900; // ~0.9km
  const maxHeight = 12_000_000; // ~12,000km
  const dragK = 0.0018; // 越小越不灵敏

  /** @type {{active:boolean; startX:number; startHeight:number; raf:number|null; nextX:number}|null} */
  let drag = null;

  function clampHeight(h) {
    return Math.max(minHeight, Math.min(maxHeight, h));
  }

  function applyDragZoom(deltaX) {
    const camera = viewer.camera;
    const c = camera.positionCartographic;
    // 以指数缩放：左拖放大(高度变小)，右拖缩小(高度变大)
    const targetHeight = clampHeight(drag.startHeight * Math.exp(deltaX * dragK));
    const nextHeight = c.height + (targetHeight - c.height) * 0.14; // 平滑一点，避免“太灵”

    camera.setView({
      destination: Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, nextHeight),
      orientation: {
        heading: camera.heading,
        pitch: camera.pitch,
        roll: camera.roll
      }
    });
  }

  function onPointerDown(e) {
    if (!rootEl) return;
    // 只响应主键/触摸
    if (e.button != null && e.button !== 0) return;
    rootEl.setPointerCapture?.(e.pointerId);
    drag = {
      active: true,
      startX: e.clientX,
      startHeight: viewer.camera.positionCartographic.height,
      raf: null,
      nextX: e.clientX
    };
    e.preventDefault?.();
  }

  function onPointerMove(e) {
    if (!drag?.active) return;
    drag.nextX = e.clientX;
    if (drag.raf != null) return;
    drag.raf = requestAnimationFrame(() => {
      drag.raf = null;
      applyDragZoom(drag.nextX - drag.startX);
    });
  }

  function endDrag(e) {
    if (!drag?.active) return;
    try {
      rootEl?.releasePointerCapture?.(e.pointerId);
    } catch {}
    if (drag.raf != null) cancelAnimationFrame(drag.raf);
    drag = null;
  }

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

  if (rootEl) {
    rootEl.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", endDrag, { passive: true });
    window.addEventListener("pointercancel", endDrag, { passive: true });
  }

  return {
    destroy() {
      scene.postRender.removeEventListener(update);
      if (rootEl) {
        rootEl.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", endDrag);
        window.removeEventListener("pointercancel", endDrag);
      }
    }
  };
}
