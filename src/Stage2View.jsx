import React, { useState, useMemo } from 'react';
// --- 1. 引入公共逻辑 (解决循环依赖) ---
import { SCHEMES as RAW_SCHEMES, calculateKinematics } from './Stage1View';

// 核心数据适配
// ==========================================

// 固定的齿轮中心几何位置 (Stage2 特有)
const LOCKED_GEO = { Ld: 120, Lh: 162, Rd: 195, Rh: 125 };

// 将 Stage1 的数据格式转换为 Stage2 需要的格式 (适配器模式)
const ADAPTED_SCHEMES = Object.entries(RAW_SCHEMES).reduce((acc, [key, val]) => {
  acc[key] = {
    name: `方案 ${key}`,
    H: val.h,
    D: val.d,
    e: val.e,
    K: val.k,
    e1: val.cam1.e,
    e2: val.cam2.e,
    ...LOCKED_GEO
  };
  return acc;
}, {});

// 齿轮半径常量 (图2使用)
const RAD = { R1: 63.0, R2: 24.5, R3: 126.0 };
const CRANK_ANGLE = 55; // 默认显示的曲柄角度

// ==========================================
// 数学与几何工具函数
// ==========================================

const toRad = (deg) => deg * Math.PI / 180;

const Vector = {
    add: (v1, v2) => ({ x: v1.x + v2.x, y: v1.y + v2.y }),
    sub: (v1, v2) => ({ x: v1.x - v2.x, y: v1.y - v2.y }),
    scale: (v, s) => ({ x: v.x * s, y: v.y * s }),
    mag: (v) => Math.sqrt(v.x * v.x + v.y * v.y),
};

// --- 寻找极值点辅助函数 ---
const findExtremum = (func, startAngle, endAngle, step = 0.1) => {
    let maxVal = -Infinity;
    let maxAngle = startAngle;
    for (let a = startAngle; a <= endAngle; a += step) {
        const val = func(a);
        if (val > maxVal) {
            maxVal = val;
            maxAngle = a;
        }
    }
    return maxAngle;
};

// --- 计算惰轮中心 (图2用) ---
const getIdlerCenter = (c1, c2, mode) => {
    const dx = c2.x - c1.x;
    const dy = c2.y - c1.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > c1.r + c2.r || d < Math.abs(c1.r - c2.r) || d === 0) return {x:0, y:0};

    const r1sq = c1.r ** 2;
    const r2sq = c2.r ** 2;
    const a = (r1sq - r2sq + d**2) / (2 * d);
    const h = Math.sqrt(Math.max(0, r1sq - a**2));

    const x2 = c1.x + a * (dx / d);
    const y2 = c1.y + a * (dy / d);

    const sol1 = { x: x2 + h * (dy / d), y: y2 - h * (dx / d) };
    const sol2 = { x: x2 - h * (dy / d), y: y2 + h * (dx / d) };

    if (mode === 0) return (sol1.x < sol2.x) ? sol1 : sol2;
    return (sol1.x > sol2.x) ? sol1 : sol2;
};

// --- 生成凸轮轮廓路径 (图2用) ---
const generateCamPath = (cx, cy, r_base, lift, rotationOffset) => {
    const points = [];
    const rise = 60, dwell = 10, fall = 60;
    for (let i = 0; i <= 360; i+=5) {
        let s = 0;
        if (i < rise) {
            let x = i / rise;
            s = lift * (x - Math.sin(2*Math.PI*x)/(2*Math.PI));
        } else if (i < rise + dwell) { s = lift; }
        else if (i < rise + dwell + fall) {
            let x = (i - rise - dwell) / fall;
            s = lift * (1 - (x - Math.sin(2*Math.PI*x)/(2*Math.PI)));
        }
        const ang = toRad(i + rotationOffset);
        const r = r_base + s;
        points.push({x: r * Math.cos(ang), y: r * Math.sin(ang)});
    }
    return points.map((p, i) => `${i===0?'M':'L'} ${cx + p.x} ${cy - p.y}`).join(' ') + ' Z';
};

// --- 运动学解算器 (全 SI 单位) ---
const solvePoint = (geo_mm, n1, phiFromTDC_Deg) => {
    const l = geo_mm.l / 1000; // m
    const r = geo_mm.r / 1000; // m
    const e = geo_mm.e / 1000; // m
    const lac_ratio = geo_mm.lac_ratio;

    const omega1 = (2 * Math.PI * n1) / 60;
    const phiFromTDC = phiFromTDC_Deg * Math.PI / 180;

    // 位置分析
    const angTDC_Geo = Math.asin(e / (l + r));
    const phiGeo = angTDC_Geo + phiFromTDC;

    const sinBeta = (e - r * Math.sin(phiGeo)) / l;
    const beta = Math.asin(Math.max(-1, Math.min(1, sinBeta)));
    const cosBeta = Math.cos(beta);

    const y_pos = r * Math.cos(phiGeo) + l * cosBeta;

    // 速度分析 (m/s)
    const Va_vec = { x: r * omega1 * Math.cos(phiGeo), y: -r * omega1 * Math.sin(phiGeo) };
    const omega2 = - (r * omega1 * Math.cos(phiGeo)) / (l * cosBeta);
    const Vba_vec = { x: l * omega2 * Math.cos(beta), y: -l * omega2 * Math.sin(beta) };
    const Vb_vec = Vector.add(Va_vec, Vba_vec);
    const Vc2a_vec = Vector.scale(Vba_vec, lac_ratio);
    const Vc2_vec = Vector.add(Va_vec, Vc2a_vec);

    // 加速度分析 (m/s²)
    const alpha2 = (r * Math.pow(omega1, 2) * Math.sin(phiGeo) + l * Math.pow(omega2, 2) * sinBeta) / (l * cosBeta);
    const Aa_vec = { x: -r * Math.pow(omega1, 2) * Math.sin(phiGeo), y: -r * Math.pow(omega1, 2) * Math.cos(phiGeo) };
    const Aba_n_vec = { x: -l * Math.pow(omega2, 2) * Math.sin(beta), y: -l * Math.pow(omega2, 2) * Math.cos(beta) };
    const Aba_t_vec = { x: l * alpha2 * Math.cos(beta), y: -l * alpha2 * Math.sin(beta) };

    const Aba_vec = Vector.add(Aba_n_vec, Aba_t_vec);
    const Ab_vec = Vector.add(Aa_vec, Aba_vec);

    const Ac2a_n = Vector.scale(Aba_n_vec, lac_ratio);
    const Ac2a_t = Vector.scale(Aba_t_vec, lac_ratio);
    const Ac2_vec = Vector.add(Aa_vec, Vector.add(Ac2a_n, Ac2a_t));

    return {
        y_pos: y_pos,
        Vb: Math.abs(Vb_vec.y),
        Vba: Vector.mag(Vba_vec),
        Vc2: Vector.mag(Vc2_vec),
        w2: Math.abs(omega2),
        Aba_n: Vector.mag(Aba_n_vec),
        Aba_t: Vector.mag(Aba_t_vec),
        Aba: Vector.mag(Aba_vec),
        alpha2: Math.abs(alpha2),
        Ac2: Vector.mag(Ac2_vec),
        Ab: Math.abs(Ab_vec.y),
        vectors: {
            Va: { x: Va_vec.x, y: -Va_vec.y },
            Vb: { x: Vb_vec.x, y: -Vb_vec.y },
            Vba: { x: Vba_vec.x, y: -Vba_vec.y },
            Aa: { x: Aa_vec.x, y: -Aa_vec.y },
            Aba_n: { x: Aba_n_vec.x, y: -Aba_n_vec.y },
            Aba_t: { x: Aba_t_vec.x, y: -Aba_t_vec.y },
            Ab: { x: Ab_vec.x, y: -Ab_vec.y }
        },
        Vb_signed: -Vb_vec.y,
        Ab_signed: -Ab_vec.y
    };
};

// ==========================================
// 绘图样式与组件
// ==========================================

const ST1 = {
    solid: { stroke: "black", strokeWidth: 1.2, fill: "none" },
    thick: { stroke: "black", strokeWidth: 2.0, fill: "none" },
    thin:  { stroke: "black", strokeWidth: 0.8, fill: "none" },
    center: { stroke: "black", strokeWidth: 0.6, strokeDasharray: "20, 5, 5, 5", fill: "none" },
    gear:   { stroke: "black", strokeWidth: 0.6, strokeDasharray: "15, 3, 2, 3", fill: "none" },
    dash:   { stroke: "black", strokeWidth: 0.8, strokeDasharray: "8, 3", fill: "none" },
    traj:   { stroke: "black", strokeWidth: 0.8, strokeDasharray: "5, 4", fill: "none" },
    text:   { fill: "black", fontSize: 13, fontFamily: "Times New Roman", textAnchor: "middle", dominantBaseline: "middle" },
};

const ST2 = {
    solid: { stroke: "black", strokeWidth: 1.2, fill: "none" },
    thick: { stroke: "black", strokeWidth: 2.5, fill: "none" },
    thin:  { stroke: "black", strokeWidth: 0.6, fill: "none" },
    center: { stroke: "black", strokeWidth: 0.5, strokeDasharray: "15, 3, 2, 3", fill: "none" },
    text:   { fill: "black", fontSize: 10, fontFamily: "Times New Roman", textAnchor: "middle", dominantBaseline: "middle" },
    label:  { fill: "black", fontSize: 12, fontFamily: "Times New Roman", fontWeight: "bold" },
    labelB: { fill: "black", fontSize: 9, fontFamily: "Times New Roman", dominantBaseline: "middle" }
};

// --- 计算三点夹角 (角度制) ---
const calculateAngle = (p1, vertex, p2) => {
    // 向量 v1: 顶点 -> p1
    const v1 = { x: p1.x - vertex.x, y: p1.y - vertex.y };
    // 向量 v2: 顶点 -> p2
    const v2 = { x: p2.x - vertex.x, y: p2.y - vertex.y };

    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

    if (mag1 * mag2 === 0) return 0;

    const dot = v1.x * v2.x + v1.y * v2.y;
    const cosTheta = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
    return (Math.acos(cosTheta) * 180 / Math.PI).toFixed(1);
};

// --- 数学公式组件 ---
const MathFraction = ({ num, den }) => (
  <span className="inline-block align-middle text-center mx-1">
    <span className="block border-b border-black text-[0.9em] px-1 leading-tight mb-[1px]">{num}</span>
    <span className="block text-[0.9em] px-1 leading-tight mt-[1px]">{den}</span>
  </span>
);

// --- 简化版活塞组件 (图2用) ---
const SimplePiston = ({ center, D, isGhost=false, scaleVal, T, S }) => {
    const pt = T(center.x, center.y);
    const w = S(D);
    const style = isGhost ? ST1.traj : ST1.thick;

    return (
        <g>
            <circle cx={pt.x} cy={pt.y} r={S(5)} fill={isGhost?"none":"white"} stroke="black" strokeWidth="1.2" strokeDasharray={isGhost?"5,4":""} />
            <line x1={pt.x - w/2} y1={pt.y} x2={pt.x + w/2} y2={pt.y} {...style} />
        </g>
    );
};

// --- 气门组件 (图2用) ---
const SimpleValve = ({ x, y, r_base, offset, scaleVal, T, S }) => {
    const rollerR = 8;
    const rollerY = y + r_base + rollerR;
    const pt = T(x + offset, rollerY);
    const stemLen = S(80);

    return (
        <g>
            <circle cx={pt.x} cy={pt.y} r={S(rollerR)} fill="white" stroke="black" strokeWidth="1.2" />
            <circle cx={pt.x} cy={pt.y} r={S(2)} fill="black" />
            <line x1={pt.x} y1={pt.y - S(rollerR)} x2={pt.x} y2={pt.y - stemLen} {...ST1.solid} />
            <line x1={pt.x - S(10)} y1={pt.y - stemLen} x2={pt.x + S(10)} y2={pt.y - stemLen} {...ST1.solid} />
        </g>
    );
};

// --- [新增] 智能计算文字坐标函数：确保文字永远在图形外围 ---
const getLabelPos = (pt, allPoints, offsetScale = 0.2) => {
    // 1. 计算图形几何中心 (Centroid)
    let cx = 0, cy = 0;
    allPoints.forEach(p => { cx += p.x; cy += p.y; });
    cx /= allPoints.length;
    cy /= allPoints.length;

    // 2. 计算从中心指向顶点的向量
    let dx = pt.x - cx;
    let dy = pt.y - cy;
    let len = Math.sqrt(dx*dx + dy*dy);

    // 3. 计算外推距离 (基于图形整体尺寸)
    // 动态计算图形的最大跨度，保证字号和距离随图形大小自动适应
    const sizeX = Math.max(...allPoints.map(p=>p.x)) - Math.min(...allPoints.map(p=>p.x));
    const sizeY = Math.max(...allPoints.map(p=>p.y)) - Math.min(...allPoints.map(p=>p.y));
    const size = Math.max(sizeX, sizeY) || 10;
    const dist = size * offsetScale; // 外推系数

    // 4. 如果点和中心重合(极罕见)，默认往左上推
    if (len < 1e-6) { dx = -1; dy = -1; len = 1.414; }

    return {
        x: pt.x + (dx / len) * dist,
        y: pt.y + (dy / len) * dist,
        fontSize: size * 0.12 // 动态计算字号，约为图形的12%
    };
};

// --- 自动缩放 SVG 组件 ---
const AutoScaledSvg = ({ children, points, width = 240, height = 240, paddingRatio = 0.2 }) => {
    if (!points || points.length === 0) return <svg width={width} height={height} />;
    const xs = points.map(p => p.x); const ys = points.map(p => p.y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    let w = maxX - minX; let h = maxY - minY;
    if (w < 1e-6) w = 1; if (h < 1e-6) h = 1;
    const padX = w * paddingRatio; const padY = h * paddingRatio;
    const finalDim = Math.max(w + padX*2, h + padY*2);
    const midX = (minX + maxX) / 2; const midY = (minY + maxY) / 2;
    const viewBox = `${midX - finalDim/2} ${midY - finalDim/2} ${finalDim} ${finalDim}`;
    return (
        <svg width={width} height={height} viewBox={viewBox} className="bg-slate-50 overflow-hidden border border-gray-100">
            <defs>
                <marker id="arrowAuto" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L0,8 L8,4 z" fill="#333" />
                </marker>
            </defs>
            <line x1={-99999} y1={0} x2={99999} y2={0} stroke="#e5e7eb" strokeWidth={finalDim/300} />
            <line x1={0} y1={-99999} x2={0} y2={99999} stroke="#e5e7eb" strokeWidth={finalDim/300} />
            {children}
        </svg>
    );
};

// --- 工程曲线图组件 (用于 2.5) ---
const EngineeringChart = ({ data, dataKey, xAxisKey = "angle", title, unit, color = "black", markers = [] }) => {
    const width = 900;
    const height = 450;
    const margin = { top: 40, right: 30, bottom: 60, left: 80 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const values = data.map(d => d[dataKey]);
    let minVal = Math.min(...values);
    let maxVal = Math.max(...values);
    if (minVal > 0) minVal = 0;
    if (maxVal < 0) maxVal = 0;

    const range = maxVal - minVal || 1;
    const yDomainMin = minVal - range * 0.05;
    const yDomainMax = maxVal + range * 0.05;
    const yDomainRange = yDomainMax - yDomainMin;

    const mapX = (deg) => (deg / 360) * innerW;
    const mapY = (val) => innerH - ((val - yDomainMin) / yDomainRange) * innerH;

    const pathD = data.map((d, i) => {
        const x = mapX(d[xAxisKey]);
        const y = mapY(d[dataKey]);
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');

    const xTicks = [];
    for (let i = 0; i <= 360; i += 30) xTicks.push(i);

    const yTickCount = 6;
    const yTicks = [];
    for (let i = 0; i <= yTickCount; i++) {
        const val = yDomainMin + (i / yTickCount) * yDomainRange;
        yTicks.push(val);
    }
    const zeroY = mapY(0);

    return (
        <div className="flex flex-col items-center w-full mb-8">
            <h4 className="text-base font-bold font-serif mb-2 text-slate-800">{title}</h4>
            <div className="border border-slate-300 bg-white shadow-sm" style={{ width: '100%', maxWidth: '900px' }}>
                <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="w-full h-auto">
                    <defs>
                        <marker id="axisArrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                            <path d="M0,0 L0,6 L9,3 z" fill="black" />
                        </marker>
                    </defs>
                    <g transform={`translate(${margin.left}, ${margin.top})`}>
                        {/* 坐标网格 */}
                        {xTicks.map(tick => (<line key={`xgrid-${tick}`} x1={mapX(tick)} y1={0} x2={mapX(tick)} y2={innerH} stroke="#e2e8f0" strokeWidth="1" />))}
                        {yTicks.map((tick, i) => (<line key={`ygrid-${i}`} x1={0} y1={mapY(tick)} x2={innerW} y2={mapY(tick)} stroke="#e2e8f0" strokeWidth="1" />))}
                        {yDomainMin <= 0 && yDomainMax >= 0 && (<line x1={0} y1={zeroY} x2={innerW} y2={zeroY} stroke="#333" strokeWidth="1.5" strokeDasharray="5,2" />)}

                        {/* 曲线路径 */}
                        <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

                        {/* 关键点标记 (修正：移除奇偶数限制，显示所有点) */}
                        {markers.map((pt, i) => {
                            const mx = mapX(pt.angle);
                            const my = mapY(pt[dataKey]);
                            if (mx < 0 || mx > innerW || my < 0 || my > innerH) return null;
                            return (
                                <g key={`marker-${i}`}>
                                    <circle cx={mx} cy={my} r="3" fill="red" stroke="white" strokeWidth="1" />
                                    {/* 这里直接显示名称，不再进行 i % 2 === 0 判断 */}
                                    <text x={mx} y={my - 6} textAnchor="middle" fontSize="9" fill="#666" fontFamily="Arial">{pt.name}</text>
                                </g>
                            );
                        })}

                        {/* 坐标轴线 */}
                        <line x1={0} y1={innerH} x2={innerW} y2={innerH} stroke="black" strokeWidth="1.5" />
                        <line x1={0} y1={0} x2={0} y2={innerH} stroke="black" strokeWidth="1.5" />

                        {/* 轴刻度 */}
                        {xTicks.map(tick => (
                            <g key={`xtick-${tick}`} transform={`translate(${mapX(tick)}, ${innerH})`}>
                                <line y1={0} y2={6} stroke="black" strokeWidth="1" />
                                <text y={20} textAnchor="middle" fontSize="12" fontFamily="Times New Roman">{tick}°</text>
                            </g>
                        ))}
                        {yTicks.map((tick, i) => (
                            <g key={`ytick-${i}`} transform={`translate(0, ${mapY(tick)})`}>
                                <line x1={-6} x2={0} stroke="black" strokeWidth="1" />
                                <text x={-10} dy="4" textAnchor="end" fontSize="12" fontFamily="Times New Roman">
                                    {Math.abs(tick) >= 1000 ? tick.toExponential(1) : tick.toFixed(2)}
                                </text>
                            </g>
                        ))}

                        {/* 轴标题 */}
                        <text x={innerW + 10} y={innerH + 5} textAnchor="start" fontSize="14" fontStyle="italic" fontFamily="Times New Roman">φ(°)</text>
                        <text x={0} y={-20} textAnchor="middle" fontSize="14" fontWeight="bold" fontFamily="Times New Roman">{unit}</text>
                    </g>
                </svg>
            </div>
        </div>
    );
};

const VelPolygonCard = ({ data, name }) => {
    if (!data) return null;
    const { vectors: v } = data;
    const p = { x: 0, y: 0 };
    const a = v.Va;
    const b = v.Vb;
    const c2 = { x: a.x + (b.x - a.x) * 0.35, y: a.y + (b.y - a.y) * 0.35 };

    // --- 1. 智能计算文字位置 (推到图形外围) ---
    const allPts = [p, a, b];
    const p_t = getLabelPos(p, allPts, 0.12); // 0.25 是外推力度，越大越远
    const a_t = getLabelPos(a, allPts, 0.12);
    const b_t = getLabelPos(b, allPts, 0.12);
    // c2 特殊处理：使用 c2 自己的坐标相对于整体中心外推
    const c2_t = getLabelPos(c2, allPts, 0.12);

    // 统一字号
    const fs = p_t.fontSize;

    const ang_bpa = calculateAngle(b, p, a);
    const ang_bap = calculateAngle(p, a, b);

    return (
        <div className="flex flex-col items-center p-2 bg-white h-full justify-between">
            <div className="text-sm font-bold mb-2 font-serif text-gray-800">{name}</div>
            {/* 关键：points 包含所有文字坐标，强行撑大画布，绝不遮挡 */}
            <AutoScaledSvg points={[p, a, b, c2, p_t, a_t, b_t, c2_t]} paddingRatio={0.1}>
                {/* 连线保持原样 */}
                <line x1={p.x} y1={p.y} x2={a.x} y2={a.y} stroke="black" strokeWidth="1.5" vectorEffect="non-scaling-stroke" markerEnd="url(#arrowAuto)" />
                <line x1={p.x} y1={p.y} x2={b.x} y2={b.y} stroke="black" strokeWidth="1.5" vectorEffect="non-scaling-stroke" markerEnd="url(#arrowAuto)" />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="black" strokeWidth="1.5" vectorEffect="non-scaling-stroke" markerEnd="url(#arrowAuto)" />
                <line x1={p.x} y1={p.y} x2={c2.x} y2={c2.y} stroke="#666" strokeWidth="1" strokeDasharray="3,3" vectorEffect="non-scaling-stroke" />

                {/* 文字层：坐标已是外围坐标，且居中对齐 */}
                <text x={p_t.x} y={p_t.y} fill="red" fontSize={fs} fontFamily="Times New Roman" fontStyle="italic" textAnchor="middle" dominantBaseline="middle">p</text>
                <text x={a_t.x} y={a_t.y} fill="red" fontSize={fs} fontFamily="Times New Roman" fontStyle="italic" textAnchor="middle" dominantBaseline="middle">a</text>
                <text x={b_t.x} y={b_t.y} fill="red" fontSize={fs} fontFamily="Times New Roman" fontStyle="italic" textAnchor="middle" dominantBaseline="middle">b</text>
            </AutoScaledSvg>
            <div className="mt-2 flex gap-4 text-xs font-serif text-slate-700 font-bold">
                <span>∠bpa={ang_bpa}°</span>
                <span>∠bap={ang_bap}°</span>
            </div>
        </div>
    );
};

const AccPolygonCard = ({ data, name }) => {
    if (!data) return null;
    const { vectors: v } = data;
    const p = { x: 0, y: 0 };
    const a = v.Aa;
    const n = Vector.add(a, v.Aba_n);
    const b = Vector.add(n, v.Aba_t);
    const c2 = { x: a.x + (b.x - a.x) * 0.35, y: a.y + (b.y - a.y) * 0.35 };

    // --- 1. 智能计算文字位置 ---
    const allPts = [p, a, n, b];
    // 加速度图比较复杂，稍微推远一点 (0.3) 防止挤压
    const p_t = getLabelPos(p, allPts, 0.12);
    const a_t = getLabelPos(a, allPts, 0.12);
    const n_t = getLabelPos(n, allPts, 0.12);
    const b_t = getLabelPos(b, allPts, 0.12);
    const c2_t = getLabelPos(c2, allPts, 0.12);

    const fs = p_t.fontSize;
    const ang_bpa = calculateAngle(b, p, a);
    const ang_pan = calculateAngle(p, a, n);

    return (
        <div className="flex flex-col items-center p-2 bg-white h-full justify-between">
            <div className="text-sm font-bold mb-2 font-serif text-gray-800">{name}</div>
            <AutoScaledSvg points={[p, a, n, b, c2, p_t, a_t, n_t, b_t, c2_t]} paddingRatio={0.1}>
                <line x1={p.x} y1={p.y} x2={a.x} y2={a.y} stroke="black" strokeWidth="1.5" vectorEffect="non-scaling-stroke" markerEnd="url(#arrowAuto)" />
                <line x1={a.x} y1={a.y} x2={n.x} y2={n.y} stroke="black" strokeWidth="1.5" vectorEffect="non-scaling-stroke" markerEnd="url(#arrowAuto)" />
                <line x1={n.x} y1={n.y} x2={b.x} y2={b.y} stroke="black" strokeWidth="1.5" vectorEffect="non-scaling-stroke" markerEnd="url(#arrowAuto)" />
                <line x1={p.x} y1={p.y} x2={b.x} y2={b.y} stroke="blue" strokeWidth="1.5" vectorEffect="non-scaling-stroke" markerEnd="url(#arrowAuto)" />
                {/* 虚线连接 */}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="black" strokeWidth="1" strokeDasharray="3,2" vectorEffect="non-scaling-stroke" />
                <line x1={p.x} y1={p.y} x2={c2.x} y2={c2.y} stroke="#666" strokeWidth="1" strokeDasharray="3,2" vectorEffect="non-scaling-stroke" />

                {/* 文字层 */}
                <text x={p_t.x} y={p_t.y} fill="red" fontSize={fs} fontFamily="Times New Roman" fontStyle="italic" textAnchor="middle" dominantBaseline="middle">p'</text>
                <text x={a_t.x} y={a_t.y} fill="red" fontSize={fs} fontFamily="Times New Roman" fontStyle="italic" textAnchor="middle" dominantBaseline="middle">a'</text>
                <text x={n_t.x} y={n_t.y} fill="red" fontSize={fs} fontFamily="Times New Roman" fontStyle="italic" textAnchor="middle" dominantBaseline="middle">n'</text>
                <text x={b_t.x} y={b_t.y} fill="red" fontSize={fs} fontFamily="Times New Roman" fontStyle="italic" textAnchor="middle" dominantBaseline="middle">b</text>
            </AutoScaledSvg>
            <div className="mt-2 flex gap-4 text-xs font-serif text-slate-700 font-bold">
                <span>∠bp'a'={ang_bpa}°</span>
                <span>∠p'a'n'={ang_pan}°</span>
            </div>
        </div>
    );
};

const Stage2View = () => {
  const [scheme, setScheme] = useState('VII');

  const p = ADAPTED_SCHEMES[scheme];

  // 1. 解算逻辑 (共用: 基础运动学)
  const mech = useMemo(() => {
    const data = calculateKinematics({ h: p.H, k: p.K, e: p.e });
    const Y_TDC = Math.sqrt(Math.pow(data.distMax, 2) - Math.pow(p.e, 2));
    const Y_BDC = Math.sqrt(Math.pow(data.distMin, 2) - Math.pow(p.e, 2));
    const x0_star = (720 - (540 + data.theta) + 32) / 2;
    const y0_star = 130 - x0_star;

    return {
        l: data.l,
        r: data.r,
        l2: Math.pow(data.l, 2),
        Y_TDC,
        Y_BDC,
        x0_star,
        y0_star,
        data
    };
  }, [p]);

  // ================= 图 2 (Section 2.1) 计算 =================
  const s1Val = 0.40 * Math.pow(1.1, 9);
  const S1 = (val) => val * s1Val;
  const T1 = (x, y) => ({ x: 500 + x * s1Val, y: 880 - y * s1Val });

  const fig2Data = useMemo(() => {
      const O = { x: 0, y: 0 };
      const O_L = { x: -p.Ld, y: p.Lh };
      const O_R = { x: p.Rd, y: p.Rh };
      const idlerL = getIdlerCenter({x:0, y:0, r:RAD.R1+RAD.R2}, {x:O_L.x, y:O_L.y, r:RAD.R3+RAD.R2}, 0);
      const idlerR = getIdlerCenter({x:0, y:0, r:RAD.R1+RAD.R2}, {x:O_R.x, y:O_R.y, r:RAD.R3+RAD.R2}, 1);
      const angA = toRad(CRANK_ANGLE);
      const A = { x: mech.r * Math.cos(angA), y: mech.r * Math.sin(angA) };
      const B = { x: p.e, y: A.y + Math.sqrt(Math.max(0, mech.l2 - Math.pow(p.e - A.x, 2))) };
      const ratio_TDC = mech.r / (mech.l + mech.r);
      const A_TDC = { x: p.e * ratio_TDC, y: mech.Y_TDC * ratio_TDC };
      const ratio_BDC = mech.r / (mech.l - mech.r);
      const A_BDC = { x: -p.e * ratio_BDC, y: -mech.Y_BDC * ratio_BDC };
      return { O, O_L, O_R, idlerL, idlerR, A, B, A_TDC, A_BDC };
  }, [mech, p]);

  // ================= 图 3 (Section 2.2) 计算 =================
  const s2Val = 0.55 * Math.pow(1.1, 9);
  const S2 = (val) => val * s2Val;
  const T2 = (x, y) => ({ x: 400 + x * s2Val, y: 1050 - y * s2Val });

  const positions = useMemo(() => {
      const points = [];
      const alpha_TDC = Math.asin(p.e / (mech.l + mech.r));
      const angA0 = alpha_TDC;
      for (let i = 0; i < 12; i++) {
          const angleOffset = i * (Math.PI / 6);
          const angle = angA0 + angleOffset;
          const Ax = mech.r * Math.sin(angle);
          const Ay = mech.r * Math.cos(angle);
          const Bx = p.e;
          const By = Ay + Math.sqrt(Math.max(0, mech.l2 - Math.pow(p.e - Ax, 2)));
          points.push({ idx: i, Ax, Ay, Bx, By, label: `A${i}`, labelB: `B${i}` });
      }
      const angBDC = Math.PI - Math.asin(p.e / (mech.l - mech.r));
      const A6p_x = mech.r * Math.sin(angBDC);
      const A6p_y = mech.r * Math.cos(angBDC);
      const B6p_y = A6p_y + Math.sqrt(Math.max(0, mech.l2 - Math.pow(p.e - A6p_x, 2)));
      return { standard: points, A6p: { Ax: A6p_x, Ay: A6p_y, Bx: p.e, By: B6p_y } };
  }, [mech, p.e]);

  // ================= 2.3 - 2.5 核心计算 =================
  const calculationData = useMemo(() => {
      const p_raw = RAW_SCHEMES[scheme];
      const { l, r } = calculateKinematics({ h: p_raw.h, k: p_raw.k, e: p_raw.e });
      const geo_mm = { l, r, e: p_raw.e, lac_ratio: p_raw.lac };

      const angBDC_rel_vert = Math.PI - Math.asin(p_raw.e / (l - r));
      const angTDC_rel_vert = Math.asin(p_raw.e / (l + r));
      const angle_A6p = (angBDC_rel_vert - angTDC_rel_vert) * 180 / Math.PI;

      const calcVb = (ang) => solvePoint(geo_mm, p_raw.n1, ang).Vb;
      const angle_A2p = findExtremum(calcVb, 60, 90, 0.1);
      const angle_A9p = findExtremum(calcVb, 270, 300, 0.1);

      const points = [
          { name: "A0", angle: 0 },
          { name: "A1", angle: 30 },
          { name: "A'2", angle: angle_A2p },
          { name: "A2", angle: 60 },
          { name: "A3", angle: 90 },
          { name: "A4", angle: 120 },
          { name: "A5", angle: 150 },
          { name: "A6", angle: 180 },
          { name: "A'6", angle: angle_A6p },
          { name: "A7", angle: 210 },
          { name: "A8", angle: 240 },
          { name: "A9", angle: 270 },
          { name: "A'9", angle: angle_A9p },
          { name: "A10", angle: 300 },
          { name: "A11", angle: 330 },
      ];
      points.sort((a, b) => a.angle - b.angle);

      return points.map(pt => ({
          ...pt,
          ...solvePoint(geo_mm, p_raw.n1, pt.angle)
      }));
  }, [scheme]);

  const curveData = useMemo(() => {
      const p_raw = RAW_SCHEMES[scheme];
      const { l, r } = calculateKinematics({ h: p_raw.h, k: p_raw.k, e: p_raw.e });
      const geo_mm = { l, r, e: p_raw.e, lac_ratio: p_raw.lac };
      const tdcState = solvePoint(geo_mm, p_raw.n1, 0);
      const y_max = tdcState.y_pos;

      const data = [];
      for (let ang = 0; ang <= 360; ang += 2) {
          const res = solvePoint(geo_mm, p_raw.n1, ang);
          data.push({
              angle: ang,
              Sb: y_max - res.y_pos,
              Vb: res.Vb_signed,
              Ab: res.Ab_signed
          });
      }
      return data;
  }, [scheme]);

  const markerData = useMemo(() => {
      const p_raw = RAW_SCHEMES[scheme];
      const { l, r } = calculateKinematics({ h: p_raw.h, k: p_raw.k, e: p_raw.e });
      const geo_mm = { l, r, e: p_raw.e, lac_ratio: p_raw.lac };
      const tdcState = solvePoint(geo_mm, p_raw.n1, 0);
      const y_max = tdcState.y_pos;

      return calculationData.map(pt => ({
          ...pt,
          Sb: y_max - pt.y_pos,
          Vb: pt.Vb_signed,
          Ab: pt.Ab_signed
      }));
  }, [calculationData, scheme]);

  const thClass = "px-2 py-1 font-serif text-[13px] text-center border-b border-black font-bold";
  const tdClass = "px-2 py-1 font-serif text-[13px] text-center tabular-nums";

  return (
    // 修改1：外层背景改为白色，去除灰色
    <div className="min-h-screen bg-white p-8 font-sans text-slate-800">

        {/* 顶部方案选择 */}
        <div className="bg-white p-3 border-b flex gap-4 items-center justify-center shadow-sm z-10 sticky top-0 print:hidden">
            <span className="font-bold text-sm text-gray-600">选择方案预览:</span>
            <div className="flex gap-2">
                {Object.keys(ADAPTED_SCHEMES).map(k => (
                    <button key={k} onClick={() => setScheme(k)}
                        className={`px-3 py-1 rounded text-xs transition-colors font-bold border ${scheme===k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                        {k}
                    </button>
                ))}
            </div>
        </div>

        {/* 主内容区: 修改2 - 去除外围 padding (p-8) */}
        <main className="flex-1 overflow-y-auto custom-scrollbar">
            {/* 修改3: 去除 max-w-[1000px], mx-auto, shadow-sm, border 等“纸张”样式，改为全宽 w-full 并保留适当内边距 */}
            <div className="w-full max-w-[210mm] mx-auto bg-white border border-gray-200 shadow-lg px-16 py-16 box-border text-slate-900 leading-normal">

                {/* 二、机构的运动分析 */}
                <h2 className="text-[24px] font-bold mb-8 text-[#1a1a1a] flex items-center">
                    <span className="mr-2 text-slate-300"></span>
                    二、机构的运动分析
                </h2>

                <div className="pl-2">
                    {/* ======================= 2.1 内容 ======================= */}
                    <h3 className="text-[18px] font-bold mb-6 text-[#1a1a1a]">2.1 绘制机构运动简图</h3>

                    <div className="text-[16px] font-serif text-justify mb-6 indent-8 leading-8 text-[#000]">
                        <p>
                            齿轮参数计算公式：分度圆直径 <i className="font-times">D = m • Z</i>，代入数据 <i className="font-times">Z₂ = Z'₂ = 14</i>，
                            得 <i className="font-times">D<sub>Z2</sub> = D<sub>Z'2</sub> = 49mm</i>
                            （标准中心距安装时，节圆半径等于分度圆半径，因此用分度圆半径计算公式即可）。
                        </p>
                    </div>

                    <div className="text-[16px] font-serif text-justify mb-6 indent-8 leading-8 text-[#000]">
                        <p>
                            为平衡机构运动简图在整张 4 号图纸中间的占比，本设计选取比例尺 <i className="font-times">μ<sub>l</sub> = 4mm/mm</i>，
                            画出除凸轮外的机构运动简图（由于凸轮轮廓未设计以及安装角未确定，凸轮部分暂不画，待后续凸轮设计结束后进行相应设计再次绘制该凸轮机构图）,
                            同时对凸轮与排气装置的连接方式进行修改。
                        </p>
                    </div>

                    <div className="text-[16px] font-serif text-justify mb-8 indent-8 leading-8 text-[#000]">
                        <p>
                            由于齿轮给出的齿数 <i className="font-times">Z₂ = Z'₂ = 14 &lt; 17</i>，所以会出现根切现象，所以针对根切现象应该使用变位齿轮。
                            齿轮的变位系数为 <i className="font-times">x = </i><MathFraction num={<span>h*<sub>a</sub> (Z<sub>min</sub> - Z)</span>} den={<span>Z<sub>min</sub></span>} /><i className="font-times"> = 0.18</i>，
                            利用变位系数对于该机构进行设计。为展示较为完整的机构运动简图，在此给出已经计算出凸轮安装角以及凸轮轮廓的机构运动简图，
                            具体机构运动简图如下图 2 所示。
                        </p>
                    </div>

                    <div className="flex flex-col items-center my-8">
                        <div className="border border-slate-300 bg-white p-2 w-full overflow-hidden">
                            <svg width="100%" height="900" viewBox="0 0 1000 1300" className="mx-auto select-none bg-white">
                                <defs>
                                    <marker id="arrow" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto" markerUnits="strokeWidth">
                                        <path d="M0,0 L0,6 L10,3 z" fill="black" />
                                    </marker>
                                </defs>
                                {/* 2.1 绘图内容：中心线、气缸、齿轮、凸轮、连杆 */}
                                <g id="centerlines-fig2">
                                    <line x1={T1(-400, 0).x} y1={T1(0, 0).y} x2={T1(400, 0).x} y2={T1(0, 0).y} {...ST1.center} />
                                    <line x1={T1(0, -(RAD.R1 + 80)).x} y1={T1(0, -(RAD.R1 + 80)).y} x2={T1(0, mech.Y_BDC - 30).x} y2={T1(0, mech.Y_BDC - 30).y} {...ST1.center} />
                                    <line x1={T1(p.e, mech.Y_BDC - 80).x} y1={T1(0, mech.Y_BDC - 80).y} x2={T1(p.e, mech.Y_TDC + 150).x} y2={T1(0, mech.Y_TDC + 150).y} {...ST1.center} />
                                    <line x1={T1(fig2Data.O_L.x, -100).x} y1={T1(0, -100).y} x2={T1(fig2Data.O_L.x, 350).x} y2={T1(0, 350).y} {...ST1.center} />
                                    <line x1={T1(fig2Data.O_L.x - (RAD.R3 + 30), fig2Data.O_L.y).x} y1={T1(0, fig2Data.O_L.y).y} x2={T1(fig2Data.O_L.x + (RAD.R3 + 5), fig2Data.O_L.y).x} y2={T1(0, fig2Data.O_L.y).y} {...ST1.center} />
                                    <line x1={T1(fig2Data.O_R.x, -100).x} y1={T1(0, -100).y} x2={T1(fig2Data.O_R.x, 350).x} y2={T1(0, 350).y} {...ST1.center} />
                                    <line x1={T1(fig2Data.O_R.x - (RAD.R3 + 5), fig2Data.O_R.y).x} y1={T1(0, fig2Data.O_R.y).y} x2={T1(fig2Data.O_R.x + (RAD.R3 + 30), fig2Data.O_R.y).x} y2={T1(0, fig2Data.O_R.y).y} {...ST1.center} />
                                </g>
                                <g id="cylinder-fig2">
                                    <line x1={T1(p.e - p.D/2, mech.Y_BDC - 60).x} y1={T1(0, mech.Y_BDC - 60).y} x2={T1(p.e - p.D/2, mech.Y_TDC + 140).x} y2={T1(0, mech.Y_TDC + 140).y} {...ST1.solid} />
                                    <line x1={T1(p.e + p.D/2, mech.Y_BDC - 60).x} y1={T1(0, mech.Y_BDC - 60).y} x2={T1(p.e + p.D/2, mech.Y_TDC + 140).x} y2={T1(0, mech.Y_TDC + 140).y} {...ST1.solid} />
                                </g>
                                <g id="gears-fig2">
                                    <circle cx={T1(0,0).x} cy={T1(0,0).y} r={S1(RAD.R1)} {...ST1.gear} />
                                    <circle cx={T1(fig2Data.O_L.x, fig2Data.O_L.y).x} cy={T1(0, fig2Data.O_L.y).y} r={S1(RAD.R3)} {...ST1.gear} />
                                    <circle cx={T1(fig2Data.O_R.x, fig2Data.O_R.y).x} cy={T1(0, fig2Data.O_R.y).y} r={S1(RAD.R3)} {...ST1.gear} />
                                    <circle cx={T1(fig2Data.idlerL.x, fig2Data.idlerL.y).x} cy={T1(0, fig2Data.idlerL.y).y} r={S1(RAD.R2)} {...ST1.gear} />
                                    <circle cx={T1(fig2Data.idlerR.x, fig2Data.idlerR.y).x} cy={T1(0, fig2Data.idlerR.y).y} r={S1(RAD.R2)} {...ST1.gear} />
                                    {[fig2Data.O, fig2Data.O_L, fig2Data.O_R, fig2Data.idlerL, fig2Data.idlerR].forEach((pt, i) => (<circle key={i} cx={T1(pt.x, pt.y).x} cy={T1(0, pt.y).y} r={S1(2)} fill="black" />))}
                                </g>
                                <g id="cams-fig2">
                                    <path d={generateCamPath(T1(fig2Data.O_L.x, 0).x, T1(0, fig2Data.O_L.y).y, S1(55), S1(10), 90 + mech.y0_star - (CRANK_ANGLE/2))} {...ST1.solid} fill="#f0f0f0" fillOpacity="0.5"/>
                                    <path d={generateCamPath(T1(fig2Data.O_R.x, 0).x, T1(0, fig2Data.O_R.y).y, S1(60), S1(10), 90 - mech.x0_star - (CRANK_ANGLE/2))} {...ST1.solid} fill="#f0f0f0" fillOpacity="0.5"/>
                                    <SimpleValve x={fig2Data.O_L.x} y={fig2Data.O_L.y} r_base={55} offset={p.e1} scaleVal={s1Val} T={T1} S={S1} />
                                    <SimpleValve x={fig2Data.O_R.x} y={fig2Data.O_R.y} r_base={60} offset={p.e2} scaleVal={s1Val} T={T1} S={S1} />
                                </g>
                                <g id="linkage-fig2">
                                    <circle cx={T1(0,0).x} cy={T1(0,0).y} r={S1(mech.r)} {...ST1.traj} />
                                    <line x1={T1(0,0).x} y1={T1(0,0).y} x2={T1(fig2Data.A_TDC.x, fig2Data.A_TDC.y).x} y2={T1(0, fig2Data.A_TDC.y).y} {...ST1.traj} />
                                    <line x1={T1(fig2Data.A_TDC.x, fig2Data.A_TDC.y).x} y1={T1(0, fig2Data.A_TDC.y).y} x2={T1(p.e, mech.Y_TDC).x} y2={T1(0, mech.Y_TDC).y} {...ST1.traj} />
                                    <SimplePiston center={{x: p.e, y: mech.Y_TDC}} D={p.D} isGhost={true} scaleVal={s1Val} T={T1} S={S1} />
                                    <line x1={T1(0,0).x} y1={T1(0,0).y} x2={T1(fig2Data.A_BDC.x, fig2Data.A_BDC.y).x} y2={T1(0, fig2Data.A_BDC.y).y} {...ST1.traj} />
                                    <line x1={T1(fig2Data.A_BDC.x, fig2Data.A_BDC.y).x} y1={T1(0, fig2Data.A_BDC.y).y} x2={T1(p.e, mech.Y_BDC).x} y2={T1(0, mech.Y_BDC).y} {...ST1.traj} />
                                    <SimplePiston center={{x: p.e, y: mech.Y_BDC}} D={p.D} isGhost={true} scaleVal={s1Val} T={T1} S={S1} />
                                    <line x1={T1(0,0).x} y1={T1(0,0).y} x2={T1(fig2Data.A.x, fig2Data.A.y).x} y2={T1(0, fig2Data.A.y).y} {...ST1.thick} />
                                    <line x1={T1(fig2Data.A.x, fig2Data.A.y).x} y1={T1(0, fig2Data.A.y).y} x2={T1(fig2Data.B.x, fig2Data.B.y).x} y2={T1(0, fig2Data.B.y).y} {...ST1.thick} />
                                    <circle cx={T1(fig2Data.A.x, fig2Data.A.y).x} cy={T1(0, fig2Data.A.y).y} r={S1(3)} fill="white" stroke="black" strokeWidth="1.5" />
                                    <circle cx={T1(0,0).x} cy={T1(0,0).y} r={S1(4)} fill="white" stroke="black" strokeWidth="1.5" />
                                    <SimplePiston center={fig2Data.B} D={p.D} isGhost={false} scaleVal={s1Val} T={T1} S={S1} />
                                </g>
                            </svg>
                        </div>
                        <p className="mt-2 text-sm text-slate-600 font-serif font-bold">图 2 机构运动简图（含安装凸轮）</p>
                    </div>

                    {/* ======================= 2.2 内容 ======================= */}
                    <div className="my-12"></div>

                    <h3 className="text-[18px] font-bold mb-6 text-[#1a1a1a]">2.2 绘制连杆的位置图</h3>

                    <div className="text-[16px] font-serif text-justify mb-8 indent-8 leading-8 text-[#000]">
                        <p>
                            以活塞在最高位置时为起点（上止点），曲柄 A 点的编号为 A0 ，由 A0 点开始，顺时针方向把圆分为 12
                            等分（30°为一个等分），得 A1 , A2 , …… A11 等点。滑块在最低点时记编号为 <i className="font-times">A'<sub>6</sub></i> （下止点）,可近似认为，当曲柄在 OA2 ’ 和 OA9 ’
                            位置时（曲柄与连杆垂直的位置），滑块 B 的速度最大。
                        </p>
                        <p className="mt-4">
                            取比例尺为 <i className="font-times">μ<sub>l</sub> = 2.5mm/mm</i> ，画出连杆的位置简图，如图 3 所示。
                        </p>
                    </div>

                    <div className="flex flex-col items-center my-8">
                        <div className="border border-slate-300 bg-white p-2 w-full overflow-hidden">
                            <svg width="100%" height="1100" viewBox="0 0 1000 1300" className="mx-auto select-none bg-white">
                                <defs>
                                    <marker id="arrow" markerWidth="10" markerHeight="10" refX="10" refY="3" orient="auto" markerUnits="strokeWidth">
                                        <path d="M0,0 L0,6 L10,3 z" fill="black" />
                                    </marker>
                                </defs>
                                {/* 2.2 绘图内容 */}
                                <g id="centerlines-fig3">
                                    <line x1={T2(p.e, -mech.r - 50).x} y1={T2(0, -mech.r - 50).y} x2={T2(p.e, mech.Y_TDC + 50).x} y2={T2(0, mech.Y_TDC + 50).y} {...ST2.center} />
                                    <line x1={T2(-200, 0).x} y1={T2(0, 0).y} x2={T2(200, 0).x} y2={T2(0, 0).y} {...ST2.center} />
                                    <circle cx={T2(0,0).x} cy={T2(0,0).y} r={S2(mech.r)} {...ST2.solid} />
                                </g>
                                <g id="positions-fig3">
                                    {positions.standard.map((pos, index) => {
                                        const isA11 = index === 11;
                                        const lineStyle = isA11 ? ST2.thick : ST2.thin;
                                        return (
                                        <g key={index}>
                                            <line x1={T2(0,0).x} y1={T2(0,0).y} x2={T2(pos.Ax, pos.Ay).x} y2={T2(pos.Ax, pos.Ay).y} {...lineStyle} />
                                            <line x1={T2(pos.Ax, pos.Ay).x} y1={T2(pos.Ax, pos.Ay).y} x2={T2(pos.Bx, pos.By).x} y2={T2(pos.Bx, pos.By).y} {...lineStyle} />
                                            <circle cx={T2(pos.Ax, pos.Ay).x} cy={T2(pos.Ax, pos.Ay).y} r={S2(2)} fill="black" />
                                            <text x={T2(pos.Ax * 1.15, pos.Ay * 1.15).x} y={T2(pos.Ax * 1.15, pos.Ay * 1.15).y} {...ST2.text}>{pos.label}</text>
                                            {index === 0 && (<rect x={T2(pos.Bx, pos.By).x - S2(20)} y={T2(pos.Bx, pos.By).y - S2(12)} width={S2(40)} height={S2(24)} {...ST2.solid} fill="white" />)}
                                            <circle cx={T2(pos.Bx, pos.By).x} cy={T2(pos.Bx, pos.By).y} r={S2(1.0)} fill="black" />
                                            <text x={T2(pos.Bx + 25, pos.By).x} y={T2(0, pos.By).y} {...ST2.labelB} textAnchor="start">{pos.labelB}</text>
                                        </g>
                                    )})}
                                    <g>
                                        <line x1={T2(0,0).x} y1={T2(0,0).y} x2={T2(positions.A6p.Ax, positions.A6p.Ay).x} y2={T2(0, positions.A6p.Ay).y} {...ST2.thin} strokeDasharray="5,2" />
                                        <line x1={T2(positions.A6p.Ax, positions.A6p.Ay).x} y1={T2(0, positions.A6p.Ay).y} x2={T2(positions.A6p.Bx, positions.A6p.By).x} y2={T2(0, positions.A6p.By).y} {...ST2.thin} strokeDasharray="5,2" />
                                        <text x={T2(positions.A6p.Ax * 1.15, positions.A6p.Ay * 1.15).x} y={T2(positions.A6p.Ax * 1.15, positions.A6p.Ay * 1.15).y} {...ST2.text}>A'6</text>
                                        <circle cx={T2(positions.A6p.Bx, positions.A6p.By).x} cy={T2(positions.A6p.By).y} r={S2(1.0)} fill="black" />
                                    </g>
                                </g>
                                <text x={T2(-15, -15).x} y={T2(0, -15).y} {...ST2.label}>O</text>
                            </svg>
                        </div>
                        <p className="mt-2 text-sm text-slate-600 font-serif font-bold">图 3 连杆位置简图</p>
                    </div>

                    {/* ======================= 2.3 内容 (速度分析) ======================= */}
                    <div className="my-16 border-t pt-8"></div>

                    <h3 className="text-[18px] font-bold mb-6 text-[#1a1a1a]">2.3 绘制机构15个位置的速度多边形</h3>
                    <p className="text-[16px] font-serif text-justify mb-6 indent-8 leading-8 text-[#000]">
                        根据理论力学所学知识，列出速度方程 <i className="font-times font-bold">v<sub>B</sub> = v<sub>A</sub> + v<sub>BA</sub></i>。
                        <span className="block mt-1 text-blue-700 font-bold">（注：所有数据均已统一为国际单位制 SI，速度为 m/s）</span>
                    </p>
                    <div className="grid grid-cols-3 gap-8 mb-6 bg-gray-50 p-8 border rounded">
                        {calculationData.map((pt, idx) => (
                            <VelPolygonCard key={idx} data={pt} name={pt.name} />
                        ))}
                    </div>

                    <div className="w-full flex justify-center mb-8">
                        <div className="w-[80%]">
                            <p className="text-center font-bold text-sm mb-2 font-serif">
                                表 1 <i className="font-times">v<sub>BA</sub>, v<sub>C2</sub>, v<sub>B</sub>, ω₂</i> 的数值
                                (单位: <i className="font-times">v/(m·s⁻¹), ω/(rad·s⁻¹)</i>)
                            </p>
                            <table className="w-full border-t-2 border-b-2 border-black">
                                <thead>
                                    <tr>
                                        <th className={thClass}>位置</th>
                                        <th className={thClass}>φ (°)</th>
                                        <th className={thClass}>v<sub>BA</sub></th>
                                        <th className={thClass}>v<sub>C2</sub></th>
                                        <th className={thClass}>v<sub>B</sub></th>
                                        <th className={thClass}>ω<sub>2</sub></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {calculationData.map((pt, i) => (
                                        <tr key={i} className="hover:bg-gray-50">
                                            <td className={tdClass + " font-bold"}>{pt.name}</td>
                                            <td className={tdClass}>{pt.angle.toFixed(1)}</td>
                                            <td className={tdClass}>{pt.Vba.toFixed(2)}</td>
                                            <td className={tdClass}>{pt.Vc2.toFixed(2)}</td>
                                            <td className={tdClass}>{pt.Vb.toFixed(2)}</td>
                                            <td className={tdClass}>{pt.w2.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ======================= 2.4 内容 (加速度分析) ======================= */}
                    <div className="my-16 border-t pt-8"></div>

                    <h3 className="text-[18px] font-bold mb-6 text-[#1a1a1a]">2.4 绘制机构的15个位置的加速度多边形</h3>
                    <p className="text-[16px] font-serif text-justify mb-6 indent-8 leading-8 text-[#000]">
                        根据加速度方程 <i className="font-times font-bold">a<sub>B</sub> = a<sub>A</sub> + a<sup>n</sup><sub>BA</sub> + a<sup>t</sup><sub>BA</sub></i> 进行求解。
                    </p>
                    <div className="grid grid-cols-3 gap-8 mb-6 bg-gray-50 p-8 border rounded">
                        {calculationData.map((pt, idx) => (
                            <AccPolygonCard key={idx} data={pt} name={pt.name} />
                        ))}
                    </div>

                    <div className="w-full flex justify-center mb-8">
                        <div className="w-full">
                            <p className="text-center font-bold text-sm mb-2 font-serif">
                                表 2 <i className="font-times">a</i> 与 <i className="font-times">α</i> 的数值
                                (单位: <i className="font-times">a/(m·s⁻²), α/(rad·s⁻²)</i>)
                            </p>
                            <table className="w-full border-t-2 border-b-2 border-black">
                                <thead>
                                    <tr>
                                        <th className={thClass}>位置</th>
                                        <th className={thClass}>a<sup>n</sup><sub>BA</sub></th>
                                        <th className={thClass}>a<sup>t</sup><sub>BA</sub></th>
                                        <th className={thClass}>a<sub>BA</sub></th>
                                        <th className={thClass}>α<sub>2</sub></th>
                                        <th className={thClass}>a<sub>C2</sub></th>
                                        <th className={thClass}>a<sub>B</sub></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {calculationData.map((pt, i) => (
                                        <tr key={i} className="hover:bg-gray-50">
                                            <td className={tdClass + " font-bold"}>{pt.name}</td>
                                            <td className={tdClass}>{pt.Aba_n.toFixed(1)}</td>
                                            <td className={tdClass}>{pt.Aba_t.toFixed(1)}</td>
                                            <td className={tdClass}>{pt.Aba.toFixed(1)}</td>
                                            <td className={tdClass}>{pt.alpha2.toFixed(1)}</td>
                                            <td className={tdClass}>{pt.Ac2.toFixed(1)}</td>
                                            <td className={tdClass}>{pt.Ab.toFixed(1)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ======================= 2.5 内容 (曲线图) ======================= */}
                    <div className="my-16 border-t pt-8"></div>

                    <h3 className="text-[18px] font-bold mb-6 text-[#1a1a1a]">2.5 滑块的位移、速度、加速度曲线</h3>
                    <p className="text-[16px] font-serif text-justify mb-6 indent-8 leading-8 text-[#000]">
                        图中红点对应上述表格中计算的15个关键位置。
                    </p>

                    <div className="space-y-12 p-4">
                        <EngineeringChart data={curveData} markers={markerData} dataKey="Sb" title={<span>图 6 滑块 B 点位移曲线 <i className="font-times">S<sub>B</sub>(φ)</i></span>} unit="m" />
                        <EngineeringChart data={curveData} markers={markerData} dataKey="Vb" title={<span>图 7 滑块 B 点速度曲线 <i className="font-times">v<sub>B</sub>(φ)</i></span>} unit="m/s" />
                        <EngineeringChart data={curveData} markers={markerData} dataKey="Ab" title={<span>图 8 滑块 B 点加速度曲线 <i className="font-times">a<sub>B</sub>(φ)</i></span>} unit="m/s²" />
                    </div>

                </div>
            </div>
        </main>
    </div>
  );
};
export default Stage2View;