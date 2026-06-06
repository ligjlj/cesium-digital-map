"""
gotrackit 路网匹配引擎封装
Phase 1: FastAPI 基础设施 + 核心封装

路网来源: gotrackit 内置 Net 类
首次使用时将路网 GeoJSON (link + node) 放入 backend/data/ 目录
"""

import logging
import random
import math
from pathlib import Path
from typing import Optional
from dataclasses import dataclass

import pandas as pd
import geopandas as gpd
from shapely.geometry import Point

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
# 路网匹配
# ════════════════════════════════════════════

@dataclass
class MatchResult:
    matched_links: gpd.GeoDataFrame
    corrected_traj: gpd.GeoDataFrame
    raw_traj: gpd.GeoDataFrame
    match_rate: float
    total_length_km: float


def run_map_match(net: Net, trips_gdf: gpd.GeoDataFrame) -> MatchResult:
    logger.info("HMM 匹配: %d 点", len(trips_gdf))

    mpm = MapMatch(
        net=net,
        flag_name="beijing_match",
        gps_buffer=200.0,
        top_k=20,
        beta=6.0,
        gps_sigma=30.0,
        export_html=False,
        export_geo_res=True,
        out_fldr=str(DATA_DIR),
    )

    match_res_df, may_error_list, error_list = mpm.execute(gps_df=trips_gdf)

    # match_res_df is a DataFrame, not a dict
    matched_links = gpd.GeoDataFrame()
    corrected_traj = trips_gdf
    if match_res_df is not None and len(match_res_df) > 0:
        corrected_traj = match_res_df
    logger.info("匹配结果: %d rows", len(match_res_df) if match_res_df is not None else 0)

    total = len(trips_gdf)
    matched = len(corrected_traj) if corrected_traj is not None else 0
    rate = matched / total if total > 0 else 0.0

    length_km = 0.0
    if matched_links is not None and len(matched_links) > 0 and "length" in matched_links.columns:
        length_km = matched_links["length"].sum() / 1000.0

    logger.info("匹配完成: rate=%.1f%%, path=%.2f km", rate * 100, length_km)
    return MatchResult(matched_links, corrected_traj, trips_gdf, rate, length_km)


# ════════════════════════════════════════════
# 全局单例
# ════════════════════════════════════════════

_net: Optional[Net] = None


def get_or_load_network(link_path: str = None, node_path: str = None) -> Net:
    global _net
    if _net is None:
        _net = load_network(link_path, node_path)
    return _net
