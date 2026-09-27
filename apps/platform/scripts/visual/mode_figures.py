"""Home mode-card silhouettes from real pose landmarks (no drawing from imagination, no outside imagery).

    python scripts/visual/mode_figures.py        (Python 3.10+, standard library only)

Writes src/components/home/modeFigures.ts and workshopTeaserPoses.ts. Each figure is one characteristic moment of the mode, taken from data
already in the project: the routines' reference pose tracks (MediaPipe landmarks extracted from the standard videos)
and the warm-up coach's pose file. Landmarks become round-capped limb segments, a slightly waisted torso and a head
circle in a 0-100 viewBox with the feet on the bottom padding line. The 动作工坊 teaser gets a real start -> finish
pair (八段锦 预备势 -> 两手托天理三焦) in the workshop's own CapturedPose shape, drawn by its PoseSketch.
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'src' / 'components' / 'home' / 'modeFigures.ts'
TEASER_OUT = ROOT / 'src' / 'components' / 'home' / 'workshopTeaserPoses.ts'
NAMES = ['nose', 'leftEyeInner', 'leftEye', 'leftEyeOuter', 'rightEyeInner', 'rightEye', 'rightEyeOuter', 'leftEar', 'rightEar',
         'mouthLeft', 'mouthRight', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow', 'leftWrist', 'rightWrist',
         'leftPinky', 'rightPinky', 'leftIndex', 'rightIndex', 'leftThumb', 'rightThumb', 'leftHip', 'rightHip', 'leftKnee',
         'rightKnee', 'leftAnkle', 'rightAnkle', 'leftHeel', 'rightHeel', 'leftFootIndex', 'rightFootIndex']


def track_pose(routine, t):
    track = json.loads((ROOT / f'public/assets/routines/{routine}-standard.pose.json').read_text(encoding='utf-8'))
    frame = min(track['frames'], key=lambda f: abs(f[0] - t))
    assert len(frame) > 2, (routine, t)
    pts = {i: (frame[2 + i * 3] / 1000 * track['width'], frame[3 + i * 3] / 1000 * track['height']) for i in range(33)}
    return pts, f'/assets/routines/{routine}-standard.pose.json @ {frame[0]} s'


def coach_pose(name):
    data = json.loads((ROOT / f'public/assets/{name}.pose.json').read_text(encoding='utf-8'))
    w, h = data['image']['width'], data['image']['height']
    pts = {i: (data['landmarks'][key]['x'] * w, data['landmarks'][key]['y'] * h) for i, key in enumerate(NAMES) if key in data['landmarks']}
    return pts, f'/assets/{name}.pose.json ({data["canonicalPoseId"]})'


# Card motif -> (form, landmarks). Chapter timings: src/features/routines/programs.ts.
CHOSEN = {
    'pulse': ('热身训练 · 侧步开合', lambda: coach_pose('coach-step-jack')),
    'lift': ('八段锦 · 左右开弓似射雕', lambda: track_pose('baduanjin', 179)),
    'orbit': ('太极拳 · 左右野马分鬃', lambda: track_pose('taijiquan', 23)),
    'leap': ('五禽戏 · 鸟伸', lambda: track_pose('wuqinxi', 600)),
    'stretch': ('易筋经 · 摘星换斗势', lambda: track_pose('yijinjing', 109)),
}


def mid(a, b):
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def figure(pts):
    sh = mid(pts[11], pts[12])
    hp = mid(pts[23], pts[24])
    unit = dist(sh, hp)
    if 7 in pts and 8 in pts:
        ears = mid(pts[7], pts[8])
        head_c = (ears[0] * 0.5 + pts[0][0] * 0.5, ears[1] * 0.5 + pts[0][1] * 0.5 - unit * 0.07)
        head_r = min(max(dist(pts[7], pts[8]) * 0.6, unit * 0.19), unit * 0.24)
    else:
        head_c = (pts[0][0], pts[0][1] - unit * 0.1)
        head_r = unit * 0.21
    neck_top = lerp(head_c, sh, 0.55)

    def hand(side):
        elbow, wrist = (pts[13], pts[15]) if side == 'L' else (pts[14], pts[16])
        if (19 if side == 'L' else 20) in pts:
            index, pinky = (pts[19], pts[17]) if side == 'L' else (pts[20], pts[18])
            return lerp(wrist, mid(index, pinky), 0.85)
        return lerp(wrist, (2 * wrist[0] - elbow[0], 2 * wrist[1] - elbow[1]), 0.2)

    # (from, to, width in torso lengths); round caps join the segments into one silhouette.
    segs = [
        (sh, neck_top, 0.14),
        (pts[11], pts[13], 0.17), (pts[13], pts[15], 0.135), (pts[15], hand('L'), 0.11),
        (pts[12], pts[14], 0.17), (pts[14], pts[16], 0.135), (pts[16], hand('R'), 0.11),
        (pts[23], pts[25], 0.235), (pts[25], pts[27], 0.17),
        (pts[24], pts[26], 0.235), (pts[26], pts[28], 0.17),
    ]
    if 29 in pts:
        segs += [(pts[29], pts[31], 0.11), (pts[30], pts[32], 0.11)]
    else:  # no foot landmarks: a short foot pointing away from the centre line
        for ankle in (pts[27], pts[28]):
            out = 1 if ankle[0] >= hp[0] else -1
            segs.append((ankle, (ankle[0] + out * unit * 0.12, ankle[1] + unit * 0.03), 0.11))
    shoulder_width = dist(pts[11], pts[12])

    def waist(s, h):
        return lerp(lerp(s, h, 0.62), lerp(sh, hp, 0.62), 0.12 * min(1.0, shoulder_width / unit))

    torso = [pts[11], pts[12], waist(pts[12], pts[24]), pts[24], pts[23], waist(pts[11], pts[23])]
    return {'head': (head_c, head_r), 'segs': segs, 'torso': torso, 'unit': unit}


def normalise(fig, box=100.0, pad=5.0):
    u = fig['unit']
    (hc, hr) = fig['head']
    xs, ys = [hc[0] - hr, hc[0] + hr], [hc[1] - hr, hc[1] + hr]
    for a, b, w in fig['segs']:
        for p in (a, b):
            xs += [p[0] - w * u / 2, p[0] + w * u / 2]
            ys += [p[1] - w * u / 2, p[1] + w * u / 2]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    s = (box - 2 * pad) / max(x1 - x0, y1 - y0)
    ox = (box - (x1 - x0) * s) / 2 - x0 * s
    oy = (box - pad) - y1 * s
    T = lambda p: (p[0] * s + ox, p[1] * s + oy)
    return {
        'head': (*T(hc), hr * s),
        'segs': [(*T(a), *T(b), w * u * s) for a, b, w in fig['segs']],
        'torso': [T(p) for p in fig['torso']],
        'torsoRound': 0.1 * u * s,
    }


def fmt(v):
    return ('%.1f' % v).rstrip('0').rstrip('.')


def main():
    lines = [
        '// Generated by scripts/visual/mode_figures.py from real pose landmarks; do not edit by hand.',
        "import type { ModeMotif } from '../../app/modeCatalog'",
        '',
        '/** A silhouette in a 0-100 viewBox, feet on the bottom padding line. */',
        'export interface ModeFigureShape {',
        '  /** The form the pose is taken from. */',
        '  pose: string',
        '  /** Landmark source inside public/. */',
        '  source: string',
        '  head: readonly [cx: number, cy: number, r: number]',
        '  /** Limb segments drawn with round caps: x1, y1, x2, y2, stroke width. */',
        '  segments: ReadonlyArray<readonly [number, number, number, number, number]>',
        '  torso: string',
        '  /** Stroke width that rounds the torso corners. */',
        '  torsoRound: number',
        '}',
        '',
        'export const MODE_FIGURES: Readonly<Record<ModeMotif, ModeFigureShape>> = {',
    ]
    for motif, (label, get) in CHOSEN.items():
        pts, source = get()
        n = normalise(figure(pts))
        segs = ', '.join('[' + ', '.join(fmt(v) for v in seg) + ']' for seg in n['segs'])
        torso = 'M' + ' '.join(f'{fmt(x)} {fmt(y)}' for x, y in n['torso']) + 'Z'
        lines += [
            f'  {motif}: {{',
            f"    pose: '{label}',",
            f"    source: '{source}',",
            f"    head: [{', '.join(fmt(v) for v in n['head'])}],",
            f'    segments: [{segs}],',
            f"    torso: '{torso}',",
            f"    torsoRound: {fmt(n['torsoRound'])},",
            '  },',
        ]
    lines += ['}', '']
    OUT.write_text('\n'.join(lines), encoding='utf-8', newline='\n')
    print(f'wrote {OUT.relative_to(ROOT)} ({len(CHOSEN)} figures)')
    write_teaser_poses()


def captured_pose(routine, t):
    track = json.loads((ROOT / f'public/assets/routines/{routine}-standard.pose.json').read_text(encoding='utf-8'))
    frame = min(track['frames'], key=lambda f: abs(f[0] - t))
    landmarks = ', '.join(
        f'{{ x: {frame[2 + i * 3] / 1000:.3f}, y: {frame[3 + i * 3] / 1000:.3f}, z: 0, visibility: {frame[4 + i * 3] / 100:.2f} }}' for i in range(33)
    )
    aspect = track['width'] / track['height']
    return f"{{ aspect: {aspect:.4f}, frames: 1, capturedAt: '{track['capturedAt']}', landmarks: [{landmarks}] }}", frame[0]


def write_teaser_poses():
    start, t_start = captured_pose('baduanjin', 10)
    finish, t_finish = captured_pose('baduanjin', 65)
    TEASER_OUT.write_text('\n'.join([
        '// Generated by scripts/visual/mode_figures.py from a real pose track; do not edit by hand.',
        "import type { CapturedPose } from '../../features/workshop/types'",
        '',
        f'/** 八段锦 预备势 ({t_start} s) -> 两手托天理三焦 ({t_finish} s) from /assets/routines/baduanjin-standard.pose.json. */',
        'export const WORKSHOP_TEASER_POSES: Readonly<{ start: CapturedPose; finish: CapturedPose }> = {',
        f'  start: {start},',
        f'  finish: {finish},',
        '}',
        '',
    ]), encoding='utf-8', newline='\n')
    print(f'wrote {TEASER_OUT.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
