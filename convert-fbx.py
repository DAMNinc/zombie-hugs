#!/tmp/fbxenv/bin/python3
"""
Convert ZombieSmooth.fbx (FBX binary 7400) to Three.js JSON format with
morph targets baked from skeletal animation.

Parses FBX binary directly (no external FBX libraries).
"""

import struct
import zlib
import json
import math
import numpy as np
from PIL import Image

# ──────────────────────────────────────────────────────────────
# FBX Binary Parser
# ──────────────────────────────────────────────────────────────

def read_property(f):
    type_code = f.read(1)
    if not type_code:
        raise EOFError
    type_code = type_code.decode('ascii')
    if type_code == 'S':
        length = struct.unpack('<I', f.read(4))[0]
        return f.read(length).decode('utf-8', errors='replace')
    elif type_code == 'R':
        length = struct.unpack('<I', f.read(4))[0]
        return f.read(length)
    elif type_code == 'I':
        return struct.unpack('<i', f.read(4))[0]
    elif type_code == 'L':
        return struct.unpack('<q', f.read(8))[0]
    elif type_code == 'F':
        return struct.unpack('<f', f.read(4))[0]
    elif type_code == 'D':
        return struct.unpack('<d', f.read(8))[0]
    elif type_code == 'C':
        return struct.unpack('<B', f.read(1))[0]
    elif type_code == 'Y':
        return struct.unpack('<h', f.read(2))[0]
    elif type_code in ('f', 'd', 'l', 'i', 'b'):
        arr_len = struct.unpack('<I', f.read(4))[0]
        encoding = struct.unpack('<I', f.read(4))[0]
        comp_len = struct.unpack('<I', f.read(4))[0]
        raw = f.read(comp_len)
        if encoding == 1:
            raw = zlib.decompress(raw)
        fmt_map = {'f': 'f', 'd': 'd', 'l': 'q', 'i': 'i', 'b': 'B'}
        fmt = fmt_map[type_code]
        sz = struct.calcsize(fmt)
        return list(struct.unpack_from(f'<{arr_len}{fmt}', raw))
    else:
        raise ValueError(f"Unknown FBX property type: {type_code} at offset {f.tell()}")


def read_node(f):
    pos = f.tell()
    end_offset = struct.unpack('<I', f.read(4))[0]
    num_props = struct.unpack('<I', f.read(4))[0]
    prop_list_len = struct.unpack('<I', f.read(4))[0]
    name_len = struct.unpack('<B', f.read(1))[0]
    name = f.read(name_len).decode('ascii') if name_len else ''
    if end_offset == 0:
        return None
    props = [read_property(f) for _ in range(num_props)]
    children = []
    while f.tell() < end_offset:
        child = read_node(f)
        if child is None:
            break
        children.append(child)
    f.seek(end_offset)
    return {'name': name, 'props': props, 'children': children}


def find_child(node, name):
    for c in node['children']:
        if c['name'] == name:
            return c
    return None


def find_children(node, name):
    return [c for c in node['children'] if c['name'] == name]


def get_prop70(node, prop_name, default=None):
    """Get a property value from a Properties70 node."""
    p70 = find_child(node, 'Properties70')
    if p70 is None:
        return default
    for p in p70['children']:
        if p['props'] and p['props'][0] == prop_name:
            # Properties70 > P has: name, type1, type2, flags, value(s)
            return p['props'][4:]
    return default


def parse_fbx(filepath):
    """Parse entire FBX file and return top-level nodes dict."""
    nodes = {}
    with open(filepath, 'rb') as f:
        header = f.read(27)
        assert header[:21] == b'Kaydara FBX Binary  \x00', "Not a valid FBX binary file"
        version = struct.unpack('<I', header[23:27])[0]
        print(f"FBX version: {version}")

        while True:
            node = read_node(f)
            if node is None:
                break
            nodes[node['name']] = node
    return nodes


# ──────────────────────────────────────────────────────────────
# Math helpers
# ──────────────────────────────────────────────────────────────

def euler_to_matrix(rx, ry, rz, order='XYZ'):
    """Convert Euler angles (degrees) to 4x4 rotation matrix.
    FBX default rotation order is XYZ (applied as Rz * Ry * Rx)."""
    rx, ry, rz = math.radians(rx), math.radians(ry), math.radians(rz)
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)

    Rx = np.array([[1,0,0],[0,cx,-sx],[0,sx,cx]])
    Ry = np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]])
    Rz = np.array([[cz,-sz,0],[sz,cz,0],[0,0,1]])

    # FBX rotation order XYZ means: apply X first, then Y, then Z
    # So the combined matrix is Rz @ Ry @ Rx
    return Rz @ Ry @ Rx


def make_transform(translation, rotation, scaling):
    """Build a 4x4 transformation matrix from T, R, S."""
    T = np.eye(4)
    T[:3, 3] = translation

    R = np.eye(4)
    R[:3, :3] = euler_to_matrix(*rotation)

    S = np.eye(4)
    S[0, 0] = scaling[0]
    S[1, 1] = scaling[1]
    S[2, 2] = scaling[2]

    return T @ R @ S


def make_transform_with_pre_rotation(translation, rotation, scaling, pre_rotation=None):
    """Build a 4x4 transformation matrix from T, PreR, R, S.
    FBX order: T * Roff * Rp * Rpre * R * Rpost^-1 * Rp^-1 * Soff * Sp * S * Sp^-1
    Simplified (no pivots): T * Rpre * R * S
    """
    T = np.eye(4)
    T[:3, 3] = translation

    R = np.eye(4)
    R[:3, :3] = euler_to_matrix(*rotation)

    Rpre = np.eye(4)
    if pre_rotation is not None:
        Rpre[:3, :3] = euler_to_matrix(*pre_rotation)

    S = np.eye(4)
    S[0, 0] = scaling[0]
    S[1, 1] = scaling[1]
    S[2, 2] = scaling[2]

    return T @ Rpre @ R @ S


def matrix_from_flat(flat_16):
    """Convert a flat 16-element list to 4x4 numpy matrix (FBX stores row-major)."""
    return np.array(flat_16).reshape(4, 4).T  # FBX is column-major in the flat array


# ──────────────────────────────────────────────────────────────
# Main conversion
# ──────────────────────────────────────────────────────────────

def main():
    FBX_PATH = '/home/david/Downloads/ZombieSmooth.fbx'
    TEXTURE_PATH = '/home/david/Downloads/ZombieTexture.png'
    OUTPUT_PATH = '/home/david/projects/zombie-hugs/src/content/zombie.json'
    NUM_MORPH_FRAMES = 12  # frames to sample from animation

    print("Parsing FBX file...")
    fbx = parse_fbx(FBX_PATH)

    objects = fbx['Objects']
    connections = fbx['Connections']

    # ── Build connection maps ──
    oo_parent = {}   # child_id -> [parent_id, ...]
    oo_children = {} # parent_id -> [child_id, ...]
    op_conns = []    # (child_id, parent_id, prop_name)

    for c in connections['children']:
        ctype = c['props'][0]
        child_id = c['props'][1]
        parent_id = c['props'][2]
        if ctype == 'OO':
            oo_parent.setdefault(child_id, []).append(parent_id)
            oo_children.setdefault(parent_id, []).append(child_id)
        elif ctype == 'OP':
            prop_name = c['props'][3] if len(c['props']) > 3 else ''
            op_conns.append((child_id, parent_id, prop_name))

    # ── Build object ID -> node map ──
    obj_by_id = {}
    for child in objects['children']:
        if child['props']:
            obj_id = child['props'][0]
            obj_by_id[obj_id] = child

    # ── Extract Geometry ──
    print("Extracting geometry...")
    geom_node = None
    for child in objects['children']:
        if child['name'] == 'Geometry':
            geom_node = child
            break

    geom_id = geom_node['props'][0]

    # Vertices (flat doubles, x,y,z triples)
    raw_vertices = find_child(geom_node, 'Vertices')['props'][0]
    num_control_points = len(raw_vertices) // 3
    print(f"  Control points: {num_control_points}")

    # PolygonVertexIndex
    poly_vertex_index = find_child(geom_node, 'PolygonVertexIndex')['props'][0]
    print(f"  PolygonVertexIndex length: {len(poly_vertex_index)}")

    # Parse polygons (negative index marks end of polygon, bitwise NOT to get actual index)
    polygons = []
    current_poly = []
    for idx in poly_vertex_index:
        if idx < 0:
            current_poly.append(~idx)  # bitwise NOT
            polygons.append(current_poly)
            current_poly = []
        else:
            current_poly.append(idx)
    print(f"  Polygons: {len(polygons)}")

    # Normals (ByPolygonVertex, Direct)
    normal_node = find_child(geom_node, 'LayerElementNormal')
    raw_normals = find_child(normal_node, 'Normals')['props'][0]
    print(f"  Normals: {len(raw_normals) // 3}")

    # UVs (ByPolygonVertex, IndexToDirect)
    uv_node = find_child(geom_node, 'LayerElementUV')
    raw_uvs = find_child(uv_node, 'UV')['props'][0]
    uv_index = find_child(uv_node, 'UVIndex')['props'][0]
    print(f"  UVs: {len(raw_uvs) // 2}, UV indices: {len(uv_index)}")

    # ── Build unique vertices (position + normal + uv) ──
    # Three.js format r3.1 uses separate arrays indexed differently.
    # We need to de-duplicate and build face arrays.

    # For the morph target approach, we want vertices indexed by control point
    # since skin weights are per control point. But normals/UVs are per polygon vertex.
    # We need to split vertices that share a control point but have different normals/UVs.

    # Build unique vertex map: (control_point_idx, normal_idx, uv_idx) -> new_vertex_idx
    vertex_map = {}
    out_vertices = []     # flat x,y,z (of unique verts)
    out_normals = []      # flat nx,ny,nz (of unique normals, deduped)
    out_uvs = []          # flat u,v (unique UV coords)
    cp_to_verts = {}      # control_point_idx -> [new_vertex_idx, ...] for skinning

    normal_map = {}       # (nx,ny,nz) tuple -> normal index
    uv_map_dedup = {}     # (u,v) tuple -> uv index

    def get_normal_idx(ni):
        n = (raw_normals[ni*3], raw_normals[ni*3+1], raw_normals[ni*3+2])
        # Round for deduplication
        key = (round(n[0], 6), round(n[1], 6), round(n[2], 6))
        if key not in normal_map:
            normal_map[key] = len(normal_map)
            out_normals.extend(n)
        return normal_map[key]

    def get_uv_idx(uvi):
        ui = uv_index[uvi]
        u, v = raw_uvs[ui*2], raw_uvs[ui*2+1]
        key = (round(u, 6), round(v, 6))
        if key not in uv_map_dedup:
            uv_map_dedup[key] = len(uv_map_dedup)
            out_uvs.extend([u, v])
        return uv_map_dedup[key]

    out_faces = []
    poly_vert_counter = 0  # tracks position in ByPolygonVertex arrays

    for poly in polygons:
        assert len(poly) == 3, f"Expected triangles, got polygon with {len(poly)} vertices"

        face_vert_indices = []
        face_normal_indices = []
        face_uv_indices = []

        for local_i, cp_idx in enumerate(poly):
            ni = get_normal_idx(poly_vert_counter + local_i)
            ui = get_uv_idx(poly_vert_counter + local_i)

            key = (cp_idx, ni, ui)
            if key not in vertex_map:
                new_idx = len(out_vertices) // 3
                vertex_map[key] = new_idx
                out_vertices.extend([raw_vertices[cp_idx*3], raw_vertices[cp_idx*3+1], raw_vertices[cp_idx*3+2]])
                cp_to_verts.setdefault(cp_idx, []).append(new_idx)

            face_vert_indices.append(vertex_map[key])
            face_normal_indices.append(ni)
            face_uv_indices.append(ui)

        poly_vert_counter += len(poly)

        # Face type: triangle with face vertex uvs and face vertex normals = 0 | 8 | 32 = 40
        face_type = 40
        out_faces.append(face_type)
        out_faces.extend(face_vert_indices)        # 3 vertex indices
        out_faces.extend(face_uv_indices)           # 3 uv indices
        out_faces.extend(face_normal_indices)        # 3 normal indices

    num_out_verts = len(out_vertices) // 3
    num_faces = len(polygons)
    print(f"  Output vertices: {num_out_verts}, faces: {num_faces}")
    print(f"  Output normals: {len(out_normals)//3}, UVs: {len(out_uvs)//2}")

    # ── Extract Skin Deformer / Clusters ──
    print("Extracting skin weights...")

    # Find all Cluster (SubDeformer) nodes
    clusters = []
    for child in objects['children']:
        if child['name'] == 'Deformer' and len(child['props']) >= 3 and child['props'][2] == 'Cluster':
            clusters.append(child)

    print(f"  Clusters (bones): {len(clusters)}")

    # For each cluster, get: indices, weights, Transform, TransformLink
    # Also find which Model (bone) it links to via connections
    cluster_data = []
    for cluster in clusters:
        cluster_id = cluster['props'][0]
        cluster_name = cluster['props'][1].split('\x00')[0]

        indices_node = find_child(cluster, 'Indexes')
        weights_node = find_child(cluster, 'Weights')
        transform_node = find_child(cluster, 'Transform')
        transform_link_node = find_child(cluster, 'TransformLink')

        indices = indices_node['props'][0] if indices_node else []
        weights = weights_node['props'][0] if weights_node else []
        transform = transform_node['props'][0] if transform_node else [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
        transform_link = transform_link_node['props'][0] if transform_link_node else [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]

        # Find which bone Model this cluster connects to (OO connection from cluster to bone model)
        bone_model_id = None
        for parent_id in oo_parent.get(cluster_id, []):
            obj = obj_by_id.get(parent_id)
            if obj and obj['name'] == 'Deformer':
                # This is the Skin deformer, skip
                continue
            # Could be the bone model directly, but clusters connect to Skin,
            # and bones connect to clusters via OO
            pass

        # Actually: Cluster -> Skin (OO), Bone Model -> Cluster... no.
        # Let me check: connections say child -> parent.
        # Cluster is child of Skin. Bone is connected to Cluster.
        # Actually in FBX: Cluster child of Skin, Bone child of Cluster...
        # Let me look at oo_children of cluster
        bone_model_id = None
        for child_id in oo_children.get(cluster_id, []):
            obj = obj_by_id.get(child_id)
            if obj and obj['name'] == 'Model':
                bone_model_id = child_id
                break

        # If not found in children, check parents
        if bone_model_id is None:
            for parent_id in oo_parent.get(cluster_id, []):
                obj = obj_by_id.get(parent_id)
                if obj and obj['name'] == 'Model':
                    bone_model_id = parent_id
                    break

        cluster_data.append({
            'name': cluster_name,
            'id': cluster_id,
            'bone_model_id': bone_model_id,
            'indices': indices,
            'weights': weights,
            'transform': matrix_from_flat(transform),       # mesh-space to bone-space
            'transform_link': matrix_from_flat(transform_link),  # bone bind pose (bone-space to world)
        })

    # ── Build bone hierarchy ──
    print("Building bone hierarchy...")

    # Collect all Model nodes that are LimbNode type
    bone_models = {}
    for child in objects['children']:
        if child['name'] == 'Model' and len(child['props']) >= 3:
            model_type = child['props'][2]
            if model_type in ('LimbNode', 'Null', 'Root'):
                bone_models[child['props'][0]] = child
            # Also include the mesh model's parent (Zombie null)
            if model_type == 'Mesh':
                bone_models[child['props'][0]] = child

    # Build parent map for bones
    bone_parent = {}  # bone_id -> parent_bone_id
    for bone_id in bone_models:
        for parent_id in oo_parent.get(bone_id, []):
            if parent_id in bone_models:
                bone_parent[bone_id] = parent_id
                break

    # Extract default local transforms for each bone
    bone_local_transforms = {}
    for bone_id, bone_node in bone_models.items():
        t = get_prop70(bone_node, 'Lcl Translation') or [0, 0, 0]
        r = get_prop70(bone_node, 'Lcl Rotation') or [0, 0, 0]
        s = get_prop70(bone_node, 'Lcl Scaling') or [1, 1, 1]
        pre_r = get_prop70(bone_node, 'PreRotation')

        bone_local_transforms[bone_id] = {
            'translation': [float(x) for x in t[:3]],
            'rotation': [float(x) for x in r[:3]],
            'scaling': [float(x) for x in s[:3]],
            'pre_rotation': [float(x) for x in pre_r[:3]] if pre_r else None,
        }

    # ── Parse Animation Curves ──
    print("Parsing animation curves...")

    # We'll use the ZombieWalk animation
    # Find the AnimLayer for ZombieWalk
    target_anim_name = 'Zombie|ZombieWalk'
    target_layer_id = None

    for child in objects['children']:
        if child['name'] == 'AnimationLayer':
            layer_id = child['props'][0]
            layer_name = child['props'][1].split('\x00')[0]
            if target_anim_name in layer_name:
                target_layer_id = layer_id
                break

    if target_layer_id is None:
        # Find via stack connections
        for child in objects['children']:
            if child['name'] == 'AnimationStack':
                stack_name = child['props'][1].split('\x00')[0]
                if target_anim_name in stack_name:
                    stack_id = child['props'][0]
                    # Find layer connected to this stack
                    for cid in oo_children.get(stack_id, []):
                        if obj_by_id.get(cid, {}).get('name') == 'AnimationLayer':
                            target_layer_id = cid
                            break
                    break

    print(f"  Using animation layer: {target_layer_id}")

    # Find all AnimCurveNodes connected to this layer
    layer_curve_nodes = oo_children.get(target_layer_id, [])
    print(f"  AnimCurveNodes in layer: {len(layer_curve_nodes)}")

    # For each AnimCurveNode, find:
    #   - which bone it connects to (OP connection: curvenode -> bone, prop = Lcl Translation/Rotation/Scaling)
    #   - which AnimCurves connect to it (OP connection: curve -> curvenode, prop = d|X/d|Y/d|Z)
    bone_anim = {}  # bone_model_id -> {'T': {x:curve,y:curve,z:curve}, 'R': {...}, 'S': {...}}

    op_by_child = {}
    for cid, pid, prop in op_conns:
        op_by_child.setdefault(cid, []).append((pid, prop))

    op_by_parent = {}
    for cid, pid, prop in op_conns:
        op_by_parent.setdefault(pid, []).append((cid, prop))

    for acn_id in layer_curve_nodes:
        acn_node = obj_by_id.get(acn_id)
        if acn_node is None or acn_node['name'] != 'AnimationCurveNode':
            continue

        acn_type = acn_node['props'][1].split('\x00')[0]  # 'T', 'R', or 'S'

        # Find which bone this connects to
        target_bone_id = None
        target_prop = None
        for pid, prop in op_by_child.get(acn_id, []):
            if prop.startswith('Lcl '):
                target_bone_id = pid
                target_prop = prop
                break

        if target_bone_id is None:
            continue

        # Find AnimCurves connected to this CurveNode
        curves_xyz = {}
        for cid, prop in op_by_parent.get(acn_id, []):
            curve_node = obj_by_id.get(cid)
            if curve_node and curve_node['name'] == 'AnimationCurve':
                axis = prop.split('|')[-1] if '|' in prop else prop  # d|X -> X
                # Extract keyframes
                key_time_node = find_child(curve_node, 'KeyTime')
                key_value_node = find_child(curve_node, 'KeyValueFloat')
                if key_time_node and key_value_node:
                    times = key_time_node['props'][0]
                    values = key_value_node['props'][0]
                    curves_xyz[axis] = (times, values)

        channel = 'T' if 'Translation' in target_prop else ('R' if 'Rotation' in target_prop else 'S')
        bone_anim.setdefault(target_bone_id, {})[channel] = curves_xyz

    print(f"  Animated bones: {len(bone_anim)}")

    # ── Evaluate animation at sampled frames ──
    print("Evaluating animation frames...")

    # FBX time: 1 second = 46186158000 ticks (FBX time mode)
    FBX_TIME_PER_SECOND = 46186158000

    # Get animation time range from Takes
    takes = fbx.get('Takes')
    anim_start = 0
    anim_end = 0
    if takes:
        for take in takes['children']:
            if take['name'] == 'Take' and target_anim_name in take['props'][0]:
                lt = find_child(take, 'LocalTime')
                if lt:
                    anim_start = lt['props'][0]
                    anim_end = lt['props'][1]
                break

    print(f"  Animation range: {anim_start} - {anim_end} ({anim_end / FBX_TIME_PER_SECOND:.2f}s)")

    def lerp_curve(times, values, t):
        """Linearly interpolate a curve at time t."""
        if not times:
            return values[0] if values else 0.0
        if t <= times[0]:
            return values[0]
        if t >= times[-1]:
            return values[-1]
        for i in range(len(times) - 1):
            if times[i] <= t <= times[i + 1]:
                dt = times[i + 1] - times[i]
                if dt == 0:
                    return values[i]
                frac = (t - times[i]) / dt
                return values[i] + frac * (values[i + 1] - values[i])
        return values[-1]

    def evaluate_bone_transform(bone_id, time):
        """Evaluate the local transform of a bone at a given time."""
        default = bone_local_transforms.get(bone_id, {
            'translation': [0, 0, 0],
            'rotation': [0, 0, 0],
            'scaling': [1, 1, 1],
            'pre_rotation': None,
        })

        t = list(default['translation'])
        r = list(default['rotation'])
        s = list(default['scaling'])
        pre_r = default.get('pre_rotation')

        anim = bone_anim.get(bone_id, {})

        # Translation
        if 'T' in anim:
            tc = anim['T']
            if 'X' in tc:
                t[0] = lerp_curve(*tc['X'], time)
            if 'Y' in tc:
                t[1] = lerp_curve(*tc['Y'], time)
            if 'Z' in tc:
                t[2] = lerp_curve(*tc['Z'], time)

        # Rotation
        if 'R' in anim:
            rc = anim['R']
            if 'X' in rc:
                r[0] = lerp_curve(*rc['X'], time)
            if 'Y' in rc:
                r[1] = lerp_curve(*rc['Y'], time)
            if 'Z' in rc:
                r[2] = lerp_curve(*rc['Z'], time)

        # Scaling
        if 'S' in anim:
            sc = anim['S']
            if 'X' in sc:
                s[0] = lerp_curve(*sc['X'], time)
            if 'Y' in sc:
                s[1] = lerp_curve(*sc['Y'], time)
            if 'Z' in sc:
                s[2] = lerp_curve(*sc['Z'], time)

        return make_transform_with_pre_rotation(t, r, s, pre_r)

    def compute_world_transforms(time):
        """Compute world transform for each bone at a given time."""
        world_transforms = {}

        def get_world(bone_id):
            if bone_id in world_transforms:
                return world_transforms[bone_id]
            local = evaluate_bone_transform(bone_id, time)
            parent_id = bone_parent.get(bone_id)
            if parent_id is not None:
                parent_world = get_world(parent_id)
                world = parent_world @ local
            else:
                world = local
            world_transforms[bone_id] = world
            return world

        for bone_id in bone_models:
            get_world(bone_id)

        return world_transforms

    # ── Build skin weight data per control point ──
    # For each control point, accumulate (bone_idx, weight)
    skin_weights = [[] for _ in range(num_control_points)]
    for ci, cluster in enumerate(cluster_data):
        for idx, weight in zip(cluster['indices'], cluster['weights']):
            skin_weights[idx].append((ci, weight))

    # Normalize and limit to top 4 weights per vertex
    for i in range(num_control_points):
        sw = skin_weights[i]
        sw.sort(key=lambda x: -x[1])
        sw = sw[:4]
        total = sum(w for _, w in sw)
        if total > 0:
            sw = [(bi, w / total) for bi, w in sw]
        skin_weights[i] = sw

    # ── Compute bind pose inverse for each cluster ──
    # The skinning formula: v' = sum_i(w_i * (TransformLink_i * Transform_i * v))
    # Transform: mesh-to-bone-space at bind, TransformLink: bone bind pose (bone-to-world)
    # So the combined is: TransformLink * Transform maps mesh-space vertex to world-space via bone
    # At bind pose this should give the original mesh position.
    # For animation: v' = sum_i(w_i * WorldBone_i * inv(BindBone_i) * v_bind)
    # Where BindBone_i = TransformLink_i, and inv(BindBone_i) = Transform_i (approximately)

    # ── Generate morph targets ──
    print("Generating morph targets...")
    morph_targets = []

    sample_times = [
        anim_start + (anim_end - anim_start) * i / (NUM_MORPH_FRAMES - 1)
        for i in range(NUM_MORPH_FRAMES)
    ]

    control_points = np.array(raw_vertices).reshape(-1, 3)

    for frame_idx, time in enumerate(sample_times):
        print(f"  Frame {frame_idx + 1}/{NUM_MORPH_FRAMES} (t={time / FBX_TIME_PER_SECOND:.3f}s)")

        world_transforms = compute_world_transforms(time)

        # Compute skinned positions for each control point
        skinned_cp = np.zeros((num_control_points, 3))

        for cp_idx in range(num_control_points):
            v = np.array([control_points[cp_idx, 0], control_points[cp_idx, 1],
                          control_points[cp_idx, 2], 1.0])
            result = np.zeros(4)

            for bone_ci, weight in skin_weights[cp_idx]:
                cluster = cluster_data[bone_ci]
                bone_id = cluster['bone_model_id']
                if bone_id is None:
                    continue

                world = world_transforms.get(bone_id, np.eye(4))
                # Skinning: WorldBone * Transform * v
                # Transform maps from mesh space to bone local bind space
                # WorldBone is the current world transform of the bone
                # But we need: WorldBone * inv(BindWorldBone) * v
                # inv(BindWorldBone) = Transform (mesh-to-bone at bind)
                skin_matrix = world @ cluster['transform']
                result += weight * (skin_matrix @ v)

            skinned_cp[cp_idx] = result[:3]

        # Now map skinned control points to output vertices
        frame_verts = []
        for cp_idx in range(num_control_points):
            for vert_idx in cp_to_verts.get(cp_idx, []):
                pass  # We'll build a sorted list

        # Build output vertex array in order
        # We need to know which control point each output vertex maps to
        # Build reverse map
        out_vert_to_cp = [0] * num_out_verts
        for cp_idx, vert_indices in cp_to_verts.items():
            for vi in vert_indices:
                out_vert_to_cp[vi] = cp_idx

        frame_verts = []
        for vi in range(num_out_verts):
            cp_idx = out_vert_to_cp[vi]
            pos = skinned_cp[cp_idx]
            frame_verts.extend([round(float(pos[0]), 6), round(float(pos[1]), 6), round(float(pos[2]), 6)])

        morph_targets.append({
            'name': f'zombie{frame_idx + 1:03d}',
            'vertices': frame_verts,
        })

    # ── Normalize morph target scale to match base geometry ──
    # The skeletal baking can introduce global scale from the FBX scene transform.
    # We detect this by comparing bounding boxes and rescaling morph targets to match.
    base_verts = np.array(out_vertices).reshape(-1, 3)
    base_range = base_verts.max(axis=0) - base_verts.min(axis=0)
    base_center = (base_verts.max(axis=0) + base_verts.min(axis=0)) / 2

    for mt in morph_targets:
        mv = np.array(mt['vertices']).reshape(-1, 3)
        morph_range = mv.max(axis=0) - mv.min(axis=0)
        morph_center = (mv.max(axis=0) + mv.min(axis=0)) / 2

        # Compute scale factor per axis, use the max to get uniform scale
        scale_factors = []
        for ax in range(3):
            if morph_range[ax] > 1e-6:
                scale_factors.append(base_range[ax] / morph_range[ax])
        if scale_factors:
            scale = np.mean(scale_factors)
        else:
            scale = 1.0

        # Rescale: center morph to origin, scale, then recenter to base center
        mv = (mv - morph_center) * scale + base_center
        mt['vertices'] = [round(float(v), 6) for v in mv.flatten()]

    print(f"  Normalized morph targets (scale factor ~{scale:.4f})")

    # ── Build morph colors from texture ──
    print("Sampling texture for morph colors...")
    tex = Image.open(TEXTURE_PATH).convert('RGB')
    tex_w, tex_h = tex.size
    tex_pixels = tex.load()
    print(f"  Texture size: {tex_w}x{tex_h}")

    morph_colors_data = []
    poly_vert_counter = 0
    for poly in polygons:
        # Sample texture at each vertex and average to get one color per face
        # (ROME shader uses boundTo: 'faces' which expects 1 color per face)
        face_r, face_g, face_b = 0.0, 0.0, 0.0
        for local_i in range(3):
            uvi = uv_index[poly_vert_counter + local_i]
            u = raw_uvs[uvi * 2]
            v = raw_uvs[uvi * 2 + 1]
            # Sample texture (v is flipped in UV space vs image space)
            px = int(u * (tex_w - 1)) % tex_w
            py = int((1.0 - v) * (tex_h - 1)) % tex_h
            r, g, b = tex_pixels[px, py]
            face_r += r / 255.0
            face_g += g / 255.0
            face_b += b / 255.0
        morph_colors_data.extend([face_r / 3.0, face_g / 3.0, face_b / 3.0])
        poly_vert_counter += len(poly)

    morph_colors = [{
        'name': 'zombie_colorMap',
        'colors': [round(c, 4) for c in morph_colors_data],
    }]

    # ── Build color palette (unique face vertex colors as packed ints) ──
    color_set = set()
    for i in range(0, len(morph_colors_data), 3):
        r = int(morph_colors_data[i] * 255)
        g = int(morph_colors_data[i+1] * 255)
        b = int(morph_colors_data[i+2] * 255)
        color_set.add((r << 16) | (g << 8) | b)
    colors_palette = sorted(color_set)

    # ── Assemble JSON ──
    print("Writing JSON output...")

    output = {
        'version': 2,
        'scale': 1.0,
        'materials': [{
            'DbgColor': 15658734,
            'DbgIndex': 0,
            'DbgName': 'ZombieMaterial',
            'colorAmbient': [0.0, 0.0, 0.0],
            'colorDiffuse': [0.5, 0.5, 0.5],
            'colorSpecular': [0.5, 0.5, 0.5],
            'illumination': 4,
            'opticalDensity': 1.0,
            'vertexColors': 'face',
        }],
        'vertices': [round(float(v), 6) for v in out_vertices],
        'morphTargets': morph_targets,
        'morphColors': morph_colors,
        'normals': [round(float(n), 6) for n in out_normals],
        'colors': colors_palette,
        'uvs': [[round(float(u), 6) for u in out_uvs]],
        'faces': out_faces,
        'edges': [],
        'metadata': {
            'formatVersion': 3.1,
        },
    }

    with open(OUTPUT_PATH, 'w') as f:
        json.dump(output, f, separators=(',', ':'))

    print(f"Output written to {OUTPUT_PATH}")
    print(f"  Vertices: {len(output['vertices']) // 3}")
    print(f"  Faces: {num_faces}")
    print(f"  Normals: {len(output['normals']) // 3}")
    print(f"  UVs: {len(output['uvs'][0]) // 2}")
    print(f"  Morph targets: {len(output['morphTargets'])}")
    print(f"  Morph colors entries: {len(output['morphColors'][0]['colors'])}")
    print(f"  Colors palette: {len(output['colors'])}")


if __name__ == '__main__':
    main()
