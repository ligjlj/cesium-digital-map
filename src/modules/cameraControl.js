import * as Cesium from "cesium";

/**
 * 相机漫游控制
 * - 封装 flyToDestination(lon, lat, height, heading, pitch)
 * - 预设关键视角，并提供便捷方法供 UI 调用
 */
export function createCameraController(viewer) {
  // 记录“初始视角”，用于巡回结束后自动返回
  // 这里在 controller 创建时抓取一次，假设此时 main.js 已完成初始 setView
  const initialView = {
    destination: viewer.camera.positionWC.clone(),
    orientation: {
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      roll: viewer.camera.roll
    }
  };

  /** @type {(() => void) | null} */
  let stopPatrolFn = null;
  let isPatrolActive = false;

  function flyBackToInitial() {
    viewer.camera.flyTo({
      destination: initialView.destination,
      orientation: initialView.orientation,
      duration: 1.6
    });
  }

  /**
   * 相机飞行（平滑过渡）
   * @param {number} lon 经度
   * @param {number} lat 纬度
   * @param {number} height 高度（米）
   * @param {number} heading 航向角（度）
   * @param {number} pitch 俯仰角（度，-90 俯视）
   */
  function flyToDestination(lon, lat, height, heading = 0, pitch = -45) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
      orientation: {
        heading: Cesium.Math.toRadians(heading),
        pitch: Cesium.Math.toRadians(pitch),
        roll: 0
      },
      duration: 1.8
    });
  }

  const presets = {
    // 故宫（更近距离）
    gugong: {
      lon: 116.3975,
      lat: 39.9163,
      height: 1800,
      heading: 15,
      pitch: -35
    },
    // 长城（八达岭附近）
    changcheng: {
      lon: 116.0156,
      lat: 40.3564,
      height: 2600,
      heading: 35,
      pitch: -35
    },
    // 上海（陆家嘴附近）
    shanghai: {
      lon: 121.5055,
      lat: 31.2400,
      height: 3200,
      heading: 40,
      pitch: -40
    },
    // 深圳（福田中心区附近）
    shenzhen: {
      lon: 114.0579,
      lat: 22.5431,
      height: 3200,
      heading: 40,
      pitch: -40
    }
  };

  function flyToPreset(name) {
    const p = presets[name];
    if (!p) {
      console.warn("[Camera] 未知预设视角：", name);
      return;
    }
    flyToDestination(p.lon, p.lat, p.height, p.heading, p.pitch);
  }

  /**
   * 在目标点上方约 20km 做一圈自动巡回，然后返回初始点。
   *
   * 实现方式（工程可控且足够稳定）：
   * - 先 flyTo 到目标点上空的“合适观测高度”
   * - 然后 camera.lookAt(target, HeadingPitchRange) 固定中心点
   * - 在 clock.onTick 里持续增加 heading，形成环绕
   * - 环绕结束后解除 lookAtTransform，并 flyTo 回 initialView
   *
   * @param {string} name 预设点名
   * @param {{ patrolHeightMeters?: number; seconds?: number; pitchDeg?: number; rangeMeters?: number }} [options]
   */
  function patrolAbovePreset(name, options = {}) {
    const p = presets[name];
    if (!p) {
      console.warn("[Camera] 未知预设视角：", name);
      return;
    }

    // 如果已有巡回在执行，先停止，避免叠加多个 onTick
    if (stopPatrolFn) stopPatrolFn();
    isPatrolActive = true;

    // 约束：20km “上方”可理解为相机到目标点的距离/半径约 20km
    // 这里把环绕半径与飞行高度解耦，便于后续按业务调整。
    const patrolHeightMeters = options.patrolHeightMeters ?? 16_000; // 默认稍低一些，减少瓦片层级频繁切换
    const seconds = options.seconds ?? 18; // 一圈时间
    const pitchDeg = options.pitchDeg ?? -35;
    const rangeMeters = options.rangeMeters ?? 14_000;

    const target = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 0);

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, patrolHeightMeters),
      orientation: {
        heading: Cesium.Math.toRadians(p.heading ?? 0),
        pitch: Cesium.Math.toRadians(pitchDeg),
        roll: 0
      },
      duration: 1.6,
      complete: () => {
        if (!isPatrolActive) return;
        const start = Cesium.JulianDate.now();
        const pitch = Cesium.Math.toRadians(pitchDeg);

        const onTick = () => {
          if (!isPatrolActive) return;
          const t = Cesium.JulianDate.secondsDifference(Cesium.JulianDate.now(), start);
          const ratio = Math.min(1, t / seconds);
          const heading = Cesium.Math.toRadians(360 * ratio);

          // lookAt 会改变相机参考系，便于围绕目标点稳定旋转
          viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, pitch, rangeMeters));

          if (ratio >= 1) {
            // 结束：解绑 tick，解除 lookAtTransform，并返回初始点
            viewer.clock.onTick.removeEventListener(onTick);
            viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
            stopPatrolFn = null;
            isPatrolActive = false;

            flyBackToInitial();
          }
        };

        viewer.clock.onTick.addEventListener(onTick);

        stopPatrolFn = () => {
          viewer.clock.onTick.removeEventListener(onTick);
          viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
          stopPatrolFn = null;
          isPatrolActive = false;
        };
      }
    });
  }

  /**
   * 取消漫游：立刻结束飞行/巡回，并返回初始点
   */
  function cancelPatrol() {
    // 取消正在进行的相机飞行
    viewer.camera.cancelFlight();

    // 停止巡回 tick（如果存在）
    if (stopPatrolFn) stopPatrolFn();
    isPatrolActive = false;

    // 返回初始点
    flyBackToInitial();
  }

  /**
   * 停止漫游/飞行：结束巡回与飞行，但不改变当前视角。
   * 用于在业务逻辑（例如加载专题图后自动 flyTo）中避免被“回初始点”覆盖。
   */
  function stopPatrol() {
    viewer.camera.cancelFlight();
    if (stopPatrolFn) stopPatrolFn();
    isPatrolActive = false;
  }

  /**
   * 强制中断当前相机操作并“回正”。
   * - 立刻取消飞行/巡回（含 lookAtTransform）
   * - 保持当前位置不变，仅将姿态设为：北向 + 俯视（heading=0, pitch=-90）
   *
   * 适用：任何时刻加载专题图，先中断一切相机动作，避免卡住或被覆盖。
   */
  function interruptAndUpright() {
    // 先停止所有正在进行的飞行/巡回
    viewer.camera.cancelFlight();
    if (stopPatrolFn) stopPatrolFn();
    isPatrolActive = false;

    // 再将相机姿态“回正”（保持当前位置）
    const c = viewer.camera.positionCartographic;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, c.height),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-90),
        roll: 0
      }
    });
  }

  /**
   * 强制中断当前相机操作（不改变当前视角）。
   * - 立刻取消飞行/巡回
   * - 解除 lookAtTransform，避免漫游途中“卡住”
   */
  function interrupt() {
    viewer.camera.cancelFlight();
    if (stopPatrolFn) stopPatrolFn();
    isPatrolActive = false;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }

  /**
   * 返回初始点（不关心当前是否在巡回）
   */
  function returnToInitial() {
    // 若正在巡回，先停掉 lookAt 影响
    if (stopPatrolFn) stopPatrolFn();
    isPatrolActive = false;
    viewer.camera.cancelFlight();
    flyBackToInitial();
  }

  return {
    flyToDestination,
    flyToPreset,
    patrolAbovePreset,
    cancelPatrol,
    stopPatrol,
    interrupt,
    interruptAndUpright,
    returnToInitial
  };
}

