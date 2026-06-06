"""
gotrackit 路网匹配引擎封装
Phase 2: 完整 GeoJSON 输出 — 匹配路段 + 轨迹 + 路网
"""

import logging
import random
import math
import json
from pathlib import Path
from typing import Optional, List, Dict, Tuple, Any
from dataclasses import dataclass, field
from collections import defaultdict

import pandas as pd
import geopandas as gpd
from shapely.geometry import Point, LineString

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

MATCH_FLAG = "beijing_match"

# GCJ-02 ↔ WGS84 椭球参数
_PI = math.pi
_A = 6378245.0
_EE = 0.00669342162296594323


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
# GCJ-02 → WGS84
# ════════════════════════════════════════════

def _out_of_china(lon: float, lat: float) -> bool:
    return lon < 72.004 or lon > 137.8347 or lat < 0.8293 or lat > 55.8271


def _transform_lat(x: float, y: float) -> float:
    ret = (
        -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y
        + 0.2 * math.sqrt(abs(x))
    )
    ret += (
        (20.0 * math.sin(6.0 * x * _PI) + 20.0 * math.sin(2.0 * x * _PI)) * 2.0 / 3.0
    )
    ret += (
        (20.0 * math.sin(y * _PI) + 40.0 * math.sin(y / 3.0 * _PI)) * 2.0 / 3.0
    )
    ret += (
        (160.0 * math.sin(y / 12.0 * _PI) + 320.0 * math.sin(y * _PI / 30.0)) * 2.0 / 3.0
    )
    return ret


def _transform_lon(x: float, y: float) -> float:
    ret = (
        300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y
        + 0.1 * math.sqrt(abs(x))
    )
    ret += (
        (20.0 * math.sin(6.0 * x * _PI) + 20.0 * math.sin(2.0 * x * _PI)) * 2.0 / 3.0
    )
    ret += (
        (20.0 * math.sin(x * _PI) + 40.0 * math.sin(x / 3.0 * _PI)) * 2.0 / 3.0
    )
    ret += (
        (150.0 * math.sin(x / 12.0 * _PI) + 300.0 * math.sin(x / 30.0 * _PI)) * 2.0 / 3.0
    )
    return ret


def _gcj_delta(lon: float, lat: float) -> Tuple[float, float]:
    d_lat = _transform_lat(lon - 105.0, lat - 35.0)
    d_lon = _transform_lon(lon - 105.0, lat - 35.0)
    rad_lat = lat / 180.0 * _PI
    magic = math.sin(rad_lat)
    magic = 1 - _EE * magic * magic
    sqrt_magic = math.sqrt(magic)
    mg_lat = (d_lat * 180.0) / (((_A * (1 - _EE)) / (magic * sqrt_magic)) * _PI)
    mg_lon = (d_lon * 180.0) / ((_A / sqrt_magic) * math.cos(rad_lat) * _PI)
    return mg_lon, mg_lat


def gcj02_to_wgs84(lon: float, lat: float) -> Tuple[float, float]:
    if _out_of_china(lon, lat):
        return lon, lat
    d_lon, d_lat = _gcj_delta(lon, lat)
    return lon - d_lon, lat - d_lat


def _transform_coords(coords: Any, geom_type: str) -> Any:
    if geom_type == "Point":
        lon, lat = coords[0], coords[1]
        w_lon, w_lat = gcj02_to_wgs84(lon, lat)
        rest = coords[2:] if len(coords) > 2 else []
        return [w_lon, w_lat, *rest]
    if geom_type == "LineString":
        return [_transform_coords(c, "Point") for c in coords]
    if geom_type == "MultiLineString":
        return [_transform_coords(line, "LineString") for line in coords]
    if geom_type == "Polygon":
        return [_transform_coords(ring, "LineString") for ring in coords]
    return coords


def gcj02_to_wgs84_geojson(geojson: dict) -> dict:
    """将 GeoJSON FeatureCollection 中所有坐标从 GCJ-02 转为 WGS84"""
    if not geojson or geojson.get("type") != "FeatureCollection":
        return geojson
    out = dict(geojson)
    features = []
    for feat in geojson.get("features", []):
        f = dict(feat)
        geom = feat.get("geometry")
        if geom and geom.get("coordinates") is not None:
            g = dict(geom)
            g["coordinates"] = _transform_coords(g["coordinates"], g["type"])
            f["geometry"] = g
        features.append(f)
    out["features"] = features
    return out


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
    net.init_net()
    g = net._Net__link.get_graph()
    logger.info("路网加载完成: graph_nodes=%d", g.number_of_nodes())
    return net


# ════════════════════════════════════════════
# 沿路网合成 GPS 轨迹
# ════════════════════════════════════════════

def _load_network_links() -> Tuple[List[dict], Dict[int, List[dict]]]:
    """加载路网 link 列表及 node → links 邻接表（双向可达）"""
    if not NETWORK_FILE.exists():
        raise FileNotFoundError(f"路网文件不存在: {NETWORK_FILE}")

    with open(NETWORK_FILE, encoding="utf-8") as f:
        data = json.load(f)

    links = []
    adjacency: Dict[int, List[dict]] = defaultdict(list)

    for feat in data.get("features", []):
        props = feat.get("properties") or {}
        geom = feat.get("geometry") or {}
        if geom.get("type") != "LineString":
            continue
        coords = geom.get("coordinates") or []
        if len(coords) < 2:
            continue

        link = {
            "link_id": props.get("link_id"),
            "from_node": props.get("from_node"),
            "to_node": props.get("to_node"),
            "coords": coords,
            "length_m": props.get("length") or _line_length_m(coords),
        }
        links.append(link)
        # 双向：从 from_node 正向进入，从 to_node 反向进入
        if link["from_node"] is not None:
            adjacency[int(link["from_node"])].append({**link, "_reverse": False})
        if link["to_node"] is not None:
            adjacency[int(link["to_node"])].append({
                **link,
                "_reverse": True,
                "coords": list(reversed(coords)),
            })

    if not links:
        raise ValueError("路网中没有可用的 LineString link")

    return links, adjacency


def _line_length_m(coords: List[List[float]]) -> float:
    total = 0.0
    for i in range(len(coords) - 1):
        lon1, lat1 = coords[i][0], coords[i][1]
        lon2, lat2 = coords[i + 1][0], coords[i + 1][1]
        dlon = (lon2 - lon1) * 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
        dlat = (lat2 - lat1) * 110540.0
        total += math.hypot(dlon, dlat)
    return total

def _pick_next_link(
    current: dict, adjacency: Dict[int, List[dict]], visited: set
) -> Optional[dict]:
    """从当前 link 的出口节点随机选下一条 link"""
    reverse = current.get("_reverse", False)
    exit_node = current.get("from_node") if reverse else current.get("to_node")
    if exit_node is None:
        return None
    candidates = [
        lk for lk in adjacency.get(int(exit_node), [])
        if lk["link_id"] not in visited
    ]
    if not candidates:
        candidates = adjacency.get(int(exit_node), [])
    if not candidates:
        return None
    return random.choice(candidates)


def _concat_link_coords(path_links: List[dict]) -> List[List[float]]:
    """将多条 link 的坐标首尾相连为一条折线"""
    if not path_links:
        return []
    merged = list(path_links[0]["coords"])
    for link in path_links[1:]:
        coords = link["coords"]
        if not coords:
            continue
        if merged and merged[-1][0] == coords[0][0] and merged[-1][1] == coords[0][1]:
            merged.extend(coords[1:])
        else:
            merged.extend(coords)
    return merged


def _sample_points_along_polyline(
    coords: List[List[float]], points_per_trip: int, step_m: float
) -> List[Tuple[float, float]]:
    """沿折线按固定步长采样，不足则均匀插值补足"""
    if len(coords) < 2:
        return [(coords[0][0], coords[0][1])] if coords else []

    seg_lens = []
    for i in range(len(coords) - 1):
        lon1, lat1 = coords[i][0], coords[i][1]
        lon2, lat2 = coords[i + 1][0], coords[i + 1][1]
        dlon = (lon2 - lon1) * 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
        dlat = (lat2 - lat1) * 110540.0
        seg_lens.append(math.hypot(dlon, dlat))

    total_len = sum(seg_lens)
    if total_len < 1e-3:
        lon, lat = coords[0][0], coords[0][1]
        return [(lon, lat)] * points_per_trip

    # 目标路径长度：至少 (points_per_trip - 1) * step_m
    target_len = (points_per_trip - 1) * step_m
    if total_len < target_len * 0.5:
        # 折线太短，多次往返延伸
        reps = max(2, int(math.ceil(target_len / total_len)))
        extended = []
        for r in range(reps):
            chunk = coords if r % 2 == 0 else list(reversed(coords))
            if extended and chunk:
                if extended[-1] == chunk[0]:
                    extended.extend(chunk[1:])
                else:
                    extended.extend(chunk)
            else:
                extended.extend(chunk)
        coords = extended
        seg_lens = []
        for i in range(len(coords) - 1):
            lon1, lat1 = coords[i][0], coords[i][1]
            lon2, lat2 = coords[i + 1][0], coords[i + 1][1]
            dlon = (lon2 - lon1) * 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
            dlat = (lat2 - lat1) * 110540.0
            seg_lens.append(math.hypot(dlon, dlat))
        total_len = sum(seg_lens)

    points: List[Tuple[float, float]] = []
    dist_target = 0.0
    seg_idx = 0
    dist_in_seg = 0.0

    points.append((coords[0][0], coords[0][1]))

    while len(points) < points_per_trip:
        dist_target += step_m
        if dist_target > total_len:
            dist_target = total_len

        while seg_idx < len(seg_lens) and dist_in_seg + seg_lens[seg_idx] < dist_target:
            dist_in_seg += seg_lens[seg_idx]
            seg_idx += 1

        if seg_idx >= len(seg_lens):
            points.append((coords[-1][0], coords[-1][1]))
            continue

        offset = dist_target - dist_in_seg
        t = offset / seg_lens[seg_idx] if seg_lens[seg_idx] > 0 else 0
        lon1, lat1 = coords[seg_idx][0], coords[seg_idx][1]
        lon2, lat2 = coords[seg_idx + 1][0], coords[seg_idx + 1][1]
        lon = lon1 + t * (lon2 - lon1)
        lat = lat1 + t * (lat2 - lat1)
        points.append((lon, lat))

    return points


def _build_random_path(
    links: List[dict],
    adjacency: Dict[int, List[dict]],
    min_links: int = 8,
    max_links: int = 25,
) -> List[dict]:
    """随机游走构建足够长的 link 路径"""
    start = random.choice(links)
    path = [{**start, "_reverse": False}]
    visited = {start["link_id"]}
    target = random.randint(min_links, max_links)

    for _ in range(target - 1):
        nxt = _pick_next_link(path[-1], adjacency, visited)
        if nxt is None:
            nxt = _pick_next_link(path[-1], adjacency, set())
        if nxt is None:
            break
        path.append(nxt)
        visited.add(nxt["link_id"])

    return path


def _path_length_m(path_links: List[dict]) -> float:
    return sum(lk.get("length_m") or _line_length_m(lk["coords"]) for lk in path_links)


def _generate_trip_points(
    links: List[dict],
    adjacency: Dict[int, List[dict]],
    points_per_trip: int,
    step_m: float = 40.0,
    min_path_m: float = 2500.0,
) -> List[Tuple[float, float]]:
    """沿路网随机游走，生成一条 trip 的 (lon, lat) 序列（无噪声）"""
    for _ in range(30):
        path_links = _build_random_path(links, adjacency)
        if _path_length_m(path_links) >= min_path_m:
            break
    polyline = _concat_link_coords(path_links)
    return _sample_points_along_polyline(polyline, points_per_trip, step_m)


def generate_synthetic_gps(
    num_trips: int = 3,
    points_per_trip: int = 80,
    interval_s: float = 3.0,
    step_m: float = 40.0,
    noise_std_deg: float = 0.00025,
) -> gpd.GeoDataFrame:
    """
    沿真实路网拓扑游走生成合成 GPS 轨迹，并叠加高斯噪声。
    保证采样点落在路网覆盖范围内（GCJ-02，与 gotrackit 路网一致）。
    """
    links, adjacency = _load_network_links()

    records = []
    base_time = pd.Timestamp("2025-06-01 08:00:00")

    for trip_id in range(num_trips):
        raw_points = _generate_trip_points(
            links, adjacency, points_per_trip, step_m=step_m
        )
        for i, (lon, lat) in enumerate(raw_points):
            noise_lon = random.gauss(0, noise_std_deg)
            noise_lat = random.gauss(0, noise_std_deg)
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
    logger.info("沿路网合成轨迹: %d trips, %d points", num_trips, len(gdf))
    return gdf


# ════════════════════════════════════════════
# 路网匹配 (Phase 2: 完整 GeoJSON 输出)
# ════════════════════════════════════════════

def _haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _compute_match_quality(
    raw_gdf: gpd.GeoDataFrame,
    agent_id: str,
    prj_geojson: dict,
    matched_links: dict,
) -> Tuple[int, float, float]:
    """
    返回 (unique_link_count, avg_proj_distance_m, match_rate)。
    match_rate = 平均投影距离 < 100m 的原始点占比。
    """
    raw_subset = raw_gdf[raw_gdf["agent_id"] == agent_id]
    prj_feats = prj_geojson.get("features", [])

    link_ids = set()
    for feat in prj_feats:
        lid = feat.get("properties", {}).get("link_id")
        if lid is not None:
            link_ids.add(lid)

    distances = []
    for i, (_, row) in enumerate(raw_subset.iterrows()):
        if i >= len(prj_feats):
            break
        prj_coords = prj_feats[i].get("geometry", {}).get("coordinates", [])
        if len(prj_coords) < 2:
            continue
        d = _haversine_m(row["lng"], row["lat"], prj_coords[0], prj_coords[1])
        distances.append(d)

    avg_dist = sum(distances) / len(distances) if distances else float("inf")
    good = sum(1 for d in distances if d < 100.0)
    rate = good / len(distances) if distances else 0.0
    unique_links = len(link_ids) if link_ids else len(matched_links.get("features", []))

    return unique_links, round(avg_dist, 1), round(rate, 4)


@dataclass
class MatchResult:
    """单条轨迹匹配结果"""
    agent_id: str
    point_count: int
    match_link_count: int
    unique_link_count: int
    avg_proj_distance_m: float
    matched_links_geojson: dict
    corrected_traj_geojson: dict
    prj_points_geojson: dict
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
            "total_unique_links": sum(t.unique_link_count for t in self.trips),
            "overall_match_rate": (
                sum(t.match_rate for t in self.trips) / len(self.trips)
                if self.trips else 0
            ),
            "avg_proj_distance_m": (
                sum(t.avg_proj_distance_m for t in self.trips) / len(self.trips)
                if self.trips else 0
            ),
            "agent_ids": [t.agent_id for t in self.trips],
        }


def _geojson_from_file(filepath: Path, to_wgs84: bool = False) -> dict:
    """从文件加载 GeoJSON dict"""
    if not filepath.exists():
        return {"type": "FeatureCollection", "features": []}
    gdf = gpd.read_file(str(filepath))
    for col in gdf.columns:
        if gdf[col].dtype == "datetime64[ms]" or gdf[col].dtype == "datetime64[ns]":
            gdf[col] = gdf[col].astype(str)
    geojson = json.loads(gdf.to_json())
    if to_wgs84:
        geojson = gcj02_to_wgs84_geojson(geojson)
    return geojson


def _gdf_to_geojson(gdf: gpd.GeoDataFrame, to_wgs84: bool = False) -> dict:
    for col in gdf.columns:
        if gdf[col].dtype == "datetime64[ms]" or gdf[col].dtype == "datetime64[ns]":
            gdf = gdf.copy()
            gdf[col] = gdf[col].astype(str)
    geojson = json.loads(gdf.to_json())
    if to_wgs84:
        geojson = gcj02_to_wgs84_geojson(geojson)
    return geojson


def run_map_match(net: Net, trips_gdf: gpd.GeoDataFrame) -> BatchMatchResult:
    """执行 HMM 路网匹配，返回完整 GeoJSON 结果（GCJ-02，前端按底图纠偏）"""
    logger.info("HMM 匹配: %d 点, %d agents", len(trips_gdf), trips_gdf["agent_id"].nunique())

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

    agent_ids = sorted(trips_gdf["agent_id"].unique())
    trip_results = []

    for aid in agent_ids:
        link_file = _match_link_file(aid)
        gps_file = _match_gps_file(aid)
        prj_file = _match_prj_file(aid)

        matched_links = _geojson_from_file(link_file, to_wgs84=False)
        corrected_gps = _geojson_from_file(gps_file, to_wgs84=False)
        prj_points = _geojson_from_file(prj_file, to_wgs84=False)

        ml_count = len(matched_links.get("features", []))
        gps_count = len(corrected_gps.get("features", []))

        unique_links, avg_dist, rate = _compute_match_quality(
            trips_gdf, aid, prj_points, matched_links
        )

        length_km = 0.0
        for feat in matched_links.get("features", []):
            geom = feat.get("geometry", {})
            if geom.get("type") == "LineString":
                coords = geom.get("coordinates", [])
                line = LineString(coords)
                length_km += line.length * 111000 / 1000

        trip_results.append(MatchResult(
            agent_id=aid,
            point_count=gps_count,
            match_link_count=ml_count,
            unique_link_count=unique_links,
            avg_proj_distance_m=avg_dist,
            matched_links_geojson=matched_links,
            corrected_traj_geojson=corrected_gps,
            prj_points_geojson=prj_points,
            match_rate=rate,
            total_length_km=round(length_km, 3),
        ))

    network_geojson = _geojson_from_file(NETWORK_FILE, to_wgs84=False)
    raw_geojson = _gdf_to_geojson(trips_gdf, to_wgs84=False)

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
