"""
gotrackit 路网匹配引擎封装
Phase 2: 完整 GeoJSON 输出 — 匹配路段 + 轨迹 + 路网
"""

import logging
import random
import math
import json
from pathlib import Path
from typing import Optional, List
from dataclasses import dataclass, field

import pandas as pd
import geopandas as gpd
from shapely.geometry import Point, LineString, mapping

from gotrackit.map.Net import Net
from gotrackit.MapMatch import MapMatch
from gotrackit.GlobalVal import NetField, GpsField

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

NETWORK_FILE = DATA_DIR / "beijing_network.geojson"
NODE_FILE = DATA_DIR / "beijing_nodes.geojson"
SAMPLE_TRIPS_FILE = DATA_DIR / "sample_trips.geojson"

net_field = NetField()
gps_field = GpsField()

# ── 匹配输出文件命名 ─────────────────────────────────
MATCH_FLAG = "beijing_match"


def _match_link_file(agent_id: str) -> Path:
    return DATA_DIR / f"{MATCH_FLAG}-{agent_id}-match_link.geojson"


def _match_gps_file(agent_id: str) -> Path:
    return DATA_DIR / f"{MATCH_FLAG}-{agent_id}-gps.geojson"


def _match_prj_file(agent_id: str) -> Path:
    return DATA_DIR / f"{MATCH_FLAG}-{agent_id}-prj_p.geojson"


def _clean_match_outputs():
    """清理旧的匹配输出文件"""
    for f in DATA_DIR.glob(f"{MATCH_FLAG}-*"):
        f.unlink(missing_ok=True)


# ════════════════════════════════════════════
# 路网加载
# ════════════════════════════════════════════

def load_network(link_path: str = None, node_path: str = None) -> Net:
    link_p = Path(link_path) if link_path else NETWORK_FILE
    node_p = Path(node_path) if node_path else NODE_FILE

    for f, label in [(link_p, "路网"), (node_p, "节点")]:
        if not f.exists():
            raise FileNotFoundError(f"{label}文件不存在: {f}")

    logger.info("加载路网: link=%s node=%s", link_p, node_p)
    net = Net(
        link_path=str(link_p),
        node_path=str(node_p),
        fmm_cache=False,
        cache_path=False,
        is_check=False,
    )
    logger.info("路网加载完成")
    return net


# ════════════════════════════════════════════
# 合成 GPS 轨迹
# ════════════════════════════════════════════

def generate_synthetic_gps(
    center_lon: float = 116.4,
    center_lat: float = 39.92,
    radius_deg: float = 0.12,
    num_trips: int = 3,
    points_per_trip: int = 50,
    interval_s: float = 3.0,
) -> gpd.GeoDataFrame:
    records = []
    base_time = pd.Timestamp("2025-06-01 08:00:00")

    for trip_id in range(num_trips):
        lon = center_lon + random.uniform(-radius_deg, radius_deg)
        lat = center_lat + random.uniform(-radius_deg, radius_deg)
        heading = random.uniform(0, 2 * math.pi)

        for i in range(points_per_trip):
            heading += random.uniform(-0.5, 0.5)
            step = random.uniform(0.0003, 0.0015)
            lon += step * math.cos(heading)
            lat += step * math.sin(heading)
            noise_lon = random.gauss(0, 0.00015)
            noise_lat = random.gauss(0, 0.00015)
            t = base_time + pd.Timedelta(seconds=i * interval_s + trip_id * 3600)

            records.append({
                "agent_id": f"trip_{trip_id:03d}",
                "lng": lon + noise_lon,
                "lat": lat + noise_lat,
                "time": t.strftime("%Y-%m-%d %H:%M:%S"),
            })

    df = pd.DataFrame(records)
    df.sort_values(["agent_id", "time"], inplace=True)
    df.reset_index(drop=True, inplace=True)
    geometry = [Point(xy) for xy in zip(df["lng"], df["lat"])]
    gdf = gpd.GeoDataFrame(df, geometry=geometry, crs="EPSG:4326")
    gdf.to_file(str(SAMPLE_TRIPS_FILE), driver="GeoJSON")
    logger.info("合成轨迹: %d trips, %d points", num_trips, len(gdf))
    return gdf


# ════════════════════════════════════════════
# 路网匹配 (Phase 2: 完整 GeoJSON 输出)
# ════════════════════════════════════════════

@dataclass
class MatchResult:
    """单条轨迹匹配结果"""
    agent_id: str
    point_count: int
    match_link_count: int
    # GeoJSON FeatureCollection
    matched_links_geojson: dict
    corrected_traj_geojson: dict
    prj_points_geojson: dict
    # 统计
    match_rate: float
    total_length_km: float


@dataclass
class BatchMatchResult:
    """批量匹配结果"""
    trips: List[MatchResult] = field(default_factory=list)
    network_geojson: dict = field(default_factory=dict)
    raw_trips_geojson: dict = field(default_factory=dict)

    @property
    def summary(self) -> dict:
        return {
            "trip_count": len(self.trips),
            "total_points": sum(t.point_count for t in self.trips),
            "total_match_links": sum(t.match_link_count for t in self.trips),
            "overall_match_rate": (
                sum(t.match_rate for t in self.trips) / len(self.trips)
                if self.trips else 0
            ),
            "agent_ids": [t.agent_id for t in self.trips],
        }


def _geojson_from_file(filepath: Path) -> dict:
    """从文件加载 GeoJSON dict"""
    if not filepath.exists():
        return {"type": "FeatureCollection", "features": []}
    gdf = gpd.read_file(str(filepath))
    # 将 datetime 列转为字符串，避免 JSON 序列化错误
    for col in gdf.columns:
        if gdf[col].dtype == "datetime64[ms]" or gdf[col].dtype == "datetime64[ns]":
            gdf[col] = gdf[col].astype(str)
    return json.loads(gdf.to_json())


def run_map_match(net: Net, trips_gdf: gpd.GeoDataFrame) -> BatchMatchResult:
    """执行 HMM 路网匹配，返回完整 GeoJSON 结果"""
    logger.info("HMM 匹配: %d 点, %d agents", len(trips_gdf), trips_gdf["agent_id"].nunique())

    # 清理旧输出
    _clean_match_outputs()

    mpm = MapMatch(
        net=net,
        flag_name=MATCH_FLAG,
        gps_buffer=200.0,
        top_k=20,
        beta=6.0,
        gps_sigma=30.0,
        export_html=False,
        export_geo_res=True,
        out_fldr=str(DATA_DIR),
    )

    mpm.execute(gps_df=trips_gdf)

    # 收集每个 agent 的匹配结果
    agent_ids = sorted(trips_gdf["agent_id"].unique())
    trip_results = []

    for aid in agent_ids:
        link_file = _match_link_file(aid)
        gps_file = _match_gps_file(aid)
        prj_file = _match_prj_file(aid)

        matched_links = _geojson_from_file(link_file)
        corrected_gps = _geojson_from_file(gps_file)
        prj_points = _geojson_from_file(prj_file)

        # 统计
        ml_count = len(matched_links.get("features", []))
        gps_count = len(corrected_gps.get("features", []))
        raw_count = len(trips_gdf[trips_gdf["agent_id"] == aid])
        rate = gps_count / raw_count if raw_count > 0 else 0

        # 计算匹配路径长度
        length_km = 0.0
        for feat in matched_links.get("features", []):
            geom = feat.get("geometry", {})
            if geom.get("type") == "LineString":
                coords = geom.get("coordinates", [])
                line = LineString(coords)
                length_km += line.length * 111000 / 1000  # 粗略度→km

        trip_results.append(MatchResult(
            agent_id=aid,
            point_count=gps_count,
            match_link_count=ml_count,
            matched_links_geojson=matched_links,
            corrected_traj_geojson=corrected_gps,
            prj_points_geojson=prj_points,
            match_rate=round(rate, 4),
            total_length_km=round(length_km, 3),
        ))

    # 加载路网 GeoJSON
    network_geojson = _geojson_from_file(NETWORK_FILE)

    # 加载原始轨迹 GeoJSON
    raw_geojson = {"type": "FeatureCollection", "features": []}
    if SAMPLE_TRIPS_FILE.exists():
        raw_geojson = _geojson_from_file(SAMPLE_TRIPS_FILE)

    logger.info("匹配完成: %d agents", len(trip_results))
    return BatchMatchResult(
        trips=trip_results,
        network_geojson=network_geojson,
        raw_trips_geojson=raw_geojson,
    )


# ════════════════════════════════════════════
# 全局单例
# ════════════════════════════════════════════

_net: Optional[Net] = None


def get_or_load_network(link_path: str = None, node_path: str = None) -> Net:
    global _net
    if _net is None:
        _net = load_network(link_path, node_path)
    return _net
