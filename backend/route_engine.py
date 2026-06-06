"""
最短路径规划 — 基于 gotrackit Net (Dijkstra)
经纬度起终点 → 吸附最近节点 → 最短路 → GeoJSON
"""

import json
import logging
import math
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple, Optional

import networkx as nx
from shapely.geometry import Point, mapping, LineString

from gotrackit.map.Net import Net
from gotrackit.GlobalVal import NetField

from match_engine import NETWORK_FILE, NODE_FILE, get_or_load_network

logger = logging.getLogger(__name__)

net_field = NetField()

# 近似：GCJ-02 经纬度下 1° 纬度 ≈ 111km，经度按 cos(lat) 折减
_M_PER_DEG_LAT = 111_320.0


def _line_length_m(line: LineString) -> float:
    """LineString 几何长度（米），用于 GCJ-02 经纬度坐标"""
    coords = list(line.coords)
    if len(coords) < 2:
        return 0.0
    total = 0.0
    for i in range(len(coords) - 1):
        lon1, lat1 = coords[i][0], coords[i][1]
        lon2, lat2 = coords[i + 1][0], coords[i + 1][1]
        cos_lat = max(0.01, abs(math.cos(math.radians((lat1 + lat2) / 2))))
        dx = (lon2 - lon1) * _M_PER_DEG_LAT * cos_lat
        dy = (lat2 - lat1) * _M_PER_DEG_LAT
        total += (dx * dx + dy * dy) ** 0.5
    return total

# 路网覆盖范围（GCJ-02，与 beijing_network 一致）
NETWORK_BBOX = {
    "min_lon": 116.207751,
    "max_lon": 116.314251,
    "min_lat": 39.855925,
    "max_lat": 39.946321,
}


class RouteError(Exception):
    """路径规划业务错误"""
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class RouteResult:
    route_geojson: dict
    summary: dict


def _in_network_bbox(lon: float, lat: float, margin: float = 0.002) -> bool:
    return (
        NETWORK_BBOX["min_lon"] - margin <= lon <= NETWORK_BBOX["max_lon"] + margin
        and NETWORK_BBOX["min_lat"] - margin <= lat <= NETWORK_BBOX["max_lat"] + margin
    )


def snap_to_nearest_node(net: Net, lon: float, lat: float) -> Tuple[int, float, float]:
    """经纬度吸附到最近的路网图节点（必须在有向图内）"""
    pt = Point(lon, lat)
    graph = net._Net__link.get_graph()
    node_ids = set(graph.nodes())
    if not node_ids:
        raise RouteError("路网图未初始化或为空", 500)

    nodes = net.get_node_data()
    nodes = nodes[nodes[net_field.NODE_ID_FIELD].astype(int).isin(node_ids)]
    if nodes.empty:
        raise RouteError("路网图节点为空", 500)

    idx = nodes.geometry.distance(pt).argmin()
    row = nodes.iloc[idx]
    node_id = int(row[net_field.NODE_ID_FIELD])
    geo = row.geometry
    return node_id, float(geo.x), float(geo.y)


def _concat_node_path_coords(net: Net, node_path: List[int]) -> List[List[float]]:
    """节点序列拼接为完整 LineString 坐标"""
    coords: List[List[float]] = []
    for i in range(len(node_path) - 1):
        line = net.get_line_geo_by_ft(node_path[i], node_path[i + 1])
        if line is None or line.is_empty:
            continue
        seg = list(line.coords)
        if not seg:
            continue
        if coords and len(seg[0]) >= 2 and len(coords[-1]) >= 2:
            if abs(seg[0][0] - coords[-1][0]) < 1e-9 and abs(seg[0][1] - coords[-1][1]) < 1e-9:
                coords.extend([list(c) for c in seg[1:]])
                continue
        coords.extend([list(c) for c in seg])
    return coords


def plan_shortest_route(
    origin_lon: float,
    origin_lat: float,
    dest_lon: float,
    dest_lat: float,
    net: Optional[Net] = None,
) -> RouteResult:
    """
    规划最短路径。
    坐标系：GCJ-02（与路网数据一致）。
    """
    if not NETWORK_FILE.exists() or not NODE_FILE.exists():
        raise RouteError("路网数据不存在，请先准备 beijing_network / beijing_nodes", 400)

    for label, lon, lat in [("起点", origin_lon, origin_lat), ("终点", dest_lon, dest_lat)]:
        if not _in_network_bbox(lon, lat):
            raise RouteError(
                f"{label} ({lon:.4f}, {lat:.4f}) 超出路网覆盖范围 "
                f"({NETWORK_BBOX['min_lon']:.2f}–{NETWORK_BBOX['max_lon']:.2f}°E, "
                f"{NETWORK_BBOX['min_lat']:.2f}–{NETWORK_BBOX['max_lat']:.2f}°N)",
                400,
            )

    net = net or get_or_load_network()

    o_node, o_snap_lon, o_snap_lat = snap_to_nearest_node(net, origin_lon, origin_lat)
    d_node, d_snap_lon, d_snap_lat = snap_to_nearest_node(net, dest_lon, dest_lat)

    if o_node == d_node:
        raise RouteError("起终点吸附到同一节点，请增大起终点距离", 400)

    try:
        node_path = net.get_shortest_path(o_node, d_node)
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        raise RouteError(
            "起终点不连通（可能受单行线方向限制，请调整起终点）",
            404,
        )

    if not node_path or len(node_path) < 2:
        raise RouteError("未找到有效路径", 404)

    coords = _concat_node_path_coords(net, node_path)
    if len(coords) < 2:
        raise RouteError("路径几何为空", 500)

    route_line = LineString(coords)
    total_length_m = _line_length_m(route_line)
    if total_length_m <= 0:
        raise RouteError("路径几何无效", 500)

    link_features = []
    for i in range(len(node_path) - 1):
        fn, tn = node_path[i], node_path[i + 1]
        line = net.get_line_geo_by_ft(fn, tn)
        if line is None or line.is_empty:
            continue
        link_id = net.get_link_attr_by_ft("link_id", fn, tn)
        link_features.append({
            "type": "Feature",
            "properties": {
                "link_id": int(link_id) if link_id is not None else None,
                "from_node": fn,
                "to_node": tn,
                "seq": i,
            },
            "geometry": mapping(line),
        })

    route_fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "type": "route",
                    "o_node": o_node,
                    "d_node": d_node,
                    "node_count": len(node_path),
                    "link_count": len(link_features),
                    "length_m": round(total_length_m, 2),
                },
                "geometry": mapping(route_line),
            },
            {
                "type": "Feature",
                "properties": {"type": "origin", "node_id": o_node},
                "geometry": mapping(Point(o_snap_lon, o_snap_lat)),
            },
            {
                "type": "Feature",
                "properties": {"type": "destination", "node_id": d_node},
                "geometry": mapping(Point(d_snap_lon, d_snap_lat)),
            },
            *link_features,
        ],
    }

    summary = {
        "o_node": o_node,
        "d_node": d_node,
        "origin": {"lng": origin_lon, "lat": origin_lat, "snapped_lng": o_snap_lon, "snapped_lat": o_snap_lat},
        "destination": {"lng": dest_lon, "lat": dest_lat, "snapped_lng": d_snap_lon, "snapped_lat": d_snap_lat},
        "node_count": len(node_path),
        "link_count": len(link_features),
        "length_m": round(total_length_m, 2),
        "length_km": round(total_length_m / 1000, 3),
        "node_path": node_path,
    }

    logger.info(
        "路径规划: %d -> %d, %.1fm, %d links",
        o_node, d_node, total_length_m, len(link_features),
    )
    return RouteResult(route_geojson=route_fc, summary=summary)
