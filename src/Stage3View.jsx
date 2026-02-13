import React, { useState, useMemo } from 'react';
import { SCHEMES, calculateKinematics } from './Stage1View';

// 气体压力表 (单位: mm 高度)
export const GAS_HEIGHT_MAP = {
    0: 0,
    30: 1,      // 1
    60: 1,      // 2
    73.5: 1,    // 2'
    90: 1,      // 3
    120: 1,     // 4
    150: 1,     // 5
    180: 1,     // 6
    180.1: 1,   // 6'
    210: 1,     // 7
    240: 1.5,   // 8
    270: 5,     // 9
    283.5: 8,   // 9'
    300: 15,    // 10
    330: 43.5,  // 11
    360: 140,   // 12
    390: 140,   // 13
    420: 72.5,  // 14
    433.5: 50.5,// 14'
    450: 32.5,  // 15
    480: 15,    // 16
    510: 7.5,   // 17
    540: 2.5,   // 18
    540.1: 2.5, // 18'
    570: 1,     // 19
    600: 1,     // 20
    630: 1,     // 21
    643.5: 1,   // 21'
    660: 1,     // 22
    690: 1,     // 23
    720: 0      // 24
};

// 获取压力高度
export const getGasHeight = (angle) => {
    const normAngle = angle % 720;
    const exactMatch = Object.keys(GAS_HEIGHT_MAP).find(k => Math.abs(parseFloat(k) - normAngle) < 0.01);
    if (exactMatch !== undefined) return GAS_HEIGHT_MAP[exactMatch];

    const keys = Object.keys(GAS_HEIGHT_MAP).map(Number).sort((a,b)=>a-b);
    let prev = keys[0];
    let next = keys[keys.length-1];
    for (let i = 0; i < keys.length - 1; i++) {
        if (normAngle >= keys[i] && normAngle <= keys[i+1]) {
            prev = keys[i];
            next = keys[i+1];
            break;
        }
    }
    if (prev === next) return GAS_HEIGHT_MAP[prev];
    const ratio = (normAngle - prev) / (next - prev);
    return GAS_HEIGHT_MAP[prev] + (GAS_HEIGHT_MAP[next] - GAS_HEIGHT_MAP[prev]) * ratio;
};

// 分析点位 (所有30个位置)
const ANALYSIS_POINTS = [
    { name: "A0", angle: 0 }, { name: "A1", angle: 30 }, { name: "A2", angle: 60 },
    { name: "A'2", angle: 73.5 }, { name: "A3", angle: 90 }, { name: "A4", angle: 120 },
    { name: "A5", angle: 150 }, { name: "A6", angle: 180 }, { name: "A'6", angle: 180.1 },
    { name: "A7", angle: 210 }, { name: "A8", angle: 240 }, { name: "A9", angle: 270 },
    { name: "A'9", angle: 283.5 }, { name: "A10", angle: 300 }, { name: "A11", angle: 330 },
    { name: "A12", angle: 360 }, { name: "A13", angle: 390 }, { name: "A14", angle: 420 },
    { name: "A'14", angle: 433.5 }, { name: "A15", angle: 450 }, { name: "A16", angle: 480 },
    { name: "A17", angle: 510 }, { name: "A18", angle: 540 }, { name: "A'18", angle: 540.1 },
    { name: "A19", angle: 570 }, { name: "A20", angle: 600 }, { name: "A21", angle: 630 },
    { name: "A'21", angle: 643.5 }, { name: "A22", angle: 660 }, { name: "A23", angle: 690 }
];

// ==========================================
// 2. 数学工具
// ==========================================
const toRad = (deg) => deg * Math.PI / 180;
export const Vec2 = {
    add: (v1, v2) => ({ x: v1.x + v2.x, y: v1.y + v2.y }),
    sub: (v1, v2) => ({ x: v1.x - v2.x, y: v1.y - v2.y }),
    scale: (v, s) => ({ x: v.x * s, y: v.y * s }),
    mag: (v) => Math.sqrt(v.x * v.x + v.y * v.y),
    cross: (v1, v2) => v1.x * v2.y - v1.y * v2.x,
    normalize: (v) => {
        const m = Math.sqrt(v.x*v.x + v.y*v.y);
        return m === 0 ? {x:0,y:0} : { x: v.x/m, y: v.y/m };
    }
};

// 辅助：从Stage23View复用的核心运动学逻辑
const calculateStage23Kinematics = (scheme, angleDeg) => {
    const l = calculateKinematics({ k: scheme.k, h: scheme.h, e: scheme.e }).l / 1000; // m
    const r = calculateKinematics({ k: scheme.k, h: scheme.h, e: scheme.e }).r / 1000; // m
    const e = scheme.e / 1000; // m
    const lac_ratio = scheme.lac_ratio;

    const omega1 = (2 * Math.PI * scheme.n1) / 60;
    const phiFromTDC = toRad(angleDeg);

    // 位置分析 (复用 Stage23)
    const angTDC_Geo = Math.asin(e / (l + r));
    const phiGeo = angTDC_Geo + phiFromTDC;

    const sinBeta = (e - r * Math.sin(phiGeo)) / l;
    const beta = Math.asin(Math.max(-1, Math.min(1, sinBeta)));
    const cosBeta = Math.cos(beta);

    // 坐标系转换：Stage23计算是基于y轴向上的几何关系，Stage3绘图基于Vector
    // 这里的rA, rB是用于后续力矩计算的位置矢量
    // rA: x=r*sin, y=r*cos (匹配 Stage3View 的绘图习惯)
    const rA = { x: r * Math.sin(phiFromTDC), y: r * Math.cos(phiFromTDC) };
    const rB = { x: e, y: Math.sqrt(Math.max(0, l*l - (e - rA.x)**2)) + rA.y }; // 简化的B点位置，需确保与beta一致
    // 更严谨的 rB 计算应基于 rA 和 beta
    // rB.y = rA.y + l * cos(beta) ??
    // Stage23: y_pos = r*cos(phiGeo) + l*cos(beta). 这对应于垂直方向距离。

    // 速度分析
    const omega2 = - (r * omega1 * Math.cos(phiGeo)) / (l * cosBeta);

    // 加速度分析 (复用 Stage23 公式)
    const alpha2 = (r * Math.pow(omega1, 2) * Math.sin(phiGeo) + l * Math.pow(omega2, 2) * sinBeta) / (l * cosBeta);
    const Aa_vec = { x: -r * Math.pow(omega1, 2) * Math.sin(phiGeo), y: -r * Math.pow(omega1, 2) * Math.cos(phiGeo) };

    // 连杆相对加速度
    const Aba_n_vec = { x: -l * Math.pow(omega2, 2) * Math.sin(beta), y: -l * Math.pow(omega2, 2) * Math.cos(beta) };
    const Aba_t_vec = { x: l * alpha2 * Math.cos(beta), y: -l * alpha2 * Math.sin(beta) };
    const Aba_vec = Vec2.add(Aba_n_vec, Aba_t_vec);

    // B点加速度
    const Ab_vec = Vec2.add(Aa_vec, Aba_vec);

    // C2点加速度
    const Ac2a_n = Vec2.scale(Aba_n_vec, lac_ratio);
    const Ac2a_t = Vec2.scale(Aba_t_vec, lac_ratio);
    const Ac2_vec = Vec2.add(Aa_vec, Vec2.add(Ac2a_n, Ac2a_t));

    // 注意：Stage23的坐标系定义可能与Stage3的 rA 定义（sin/cos）存在相位差
    // Stage3: rA = (r sin, r cos).  Stage23 Aa uses (sin(phiGeo), cos(phiGeo)).
    // 若 phiGeo = phi, 则 x对应sin, y对应cos.
    // 此时 Stage23 的 Aa_vec = {-r w^2 sin, -r w^2 cos}.
    // 这与 rA = {r sin, r cos} 的向心加速度方向 (-rA * w^2) 完全一致。
    // 因此直接使用这些 vector 是安全的。

    return {
        rA,
        rB: {x: e, y: rA.y + l*cosBeta}, // 使用一致的几何计算
        aC2: { x: Ac2_vec.x, y: Ac2_vec.y },
        aB: { x: Ab_vec.x, y: Ab_vec.y }, // 使用全矢量
        alpha2: alpha2,
        l: l,
        r: r
    };
};

// ==========================================
// 3. 核心解算器
// ==========================================
const solveSystem = (schemeRaw, angleDeg) => {
    // 1. 数据映射
    const scheme = {
        h: schemeRaw.h,
        e: schemeRaw.e,
        k: schemeRaw.k,
        d: schemeRaw.d,
        n1: schemeRaw.n1,
        Q1: schemeRaw.q1 !== undefined ? schemeRaw.q1 : schemeRaw.Q1,
        Q2: schemeRaw.q2 !== undefined ? schemeRaw.q2 : schemeRaw.Q2,
        Q3: schemeRaw.q3 !== undefined ? schemeRaw.q3 : schemeRaw.Q3,
        lac_ratio: schemeRaw.lac !== undefined ? schemeRaw.lac : schemeRaw.lac_ratio,
        rho_ratio: schemeRaw.rho !== undefined ? schemeRaw.rho : schemeRaw.rho_ratio,
    };

    // 2. 运动学计算 (从 Stage23View 导入逻辑)
    const kine = calculateStage23Kinematics(scheme, angleDeg);
    const { rA, rB, aC2, aB, alpha2, l, r } = kine;

    // 3. 动力学
    const g = 9.8;
    const m2 = scheme.Q2 / g;
    const m3 = scheme.Q3 / g;
    const Jc2 = m2 * Math.pow(scheme.rho_ratio * l, 2);

    // 气体压力
    const p_height = getGasHeight(angleDeg);
    const mu_pi = 2; // N/cm^2 / mm
    const D_cm = scheme.d / 10;
    const area_cm2 = Math.PI * Math.pow(D_cm / 2, 2);
    const F_gas_mag = p_height * mu_pi * area_cm2;
    const Fp = { x: 0, y: -F_gas_mag };

    const rC2 = {
        x: rA.x * (1 - scheme.lac_ratio) + rB.x * scheme.lac_ratio,
        y: rA.y * (1 - scheme.lac_ratio) + rB.y * scheme.lac_ratio
    };

    const PI2 = Vec2.scale(aC2, -m2);
    const PI3 = Vec2.scale(aB, -m3);
    const MI2 = -Jc2 * alpha2;

    const G3 = { x: 0, y: -scheme.Q3 };
    const G2 = { x: 0, y: -scheme.Q2 };
    const P_total = Vec2.add(Fp, Vec2.add(PI3, G3));

    // 解力
    const rBA = Vec2.sub(rA, rB);
    const uBA = Vec2.normalize(rBA); // B -> A
    const ut = { x: -uBA.y, y: uBA.x };

    const rC2B = Vec2.sub(rC2, rB);
    const m_G2 = Vec2.cross(rC2B, G2);
    const m_PI2 = Vec2.cross(rC2B, PI2);

    const R12t_mag = -(m_G2 + m_PI2 + MI2) / l;
    const R12t = Vec2.scale(ut, R12t_mag);

    const known_y = R12t.y + G2.y + PI2.y + P_total.y;
    const R12n_mag = -known_y / uBA.y;
    const R12n = Vec2.scale(uBA, R12n_mag);

    const R12 = Vec2.add(R12n, R12t);
    const R03_val = -(R12.x + G2.x + PI2.x + P_total.x);
    const R03 = { x: R03_val, y: 0 };
    const R23 = Vec2.scale(Vec2.add(P_total, R03), -1);

    const R21 = Vec2.scale(R12, -1);
    const m_R21 = Vec2.cross(rA, R21);
    const Md = -m_R21;

    return {
        rA, rB, rC2, F_gas_mag, P_total, PI2, MI2, PI3,
        R12t, R12n, R12, R03, R23, R01: R12, R21, Md, G2, uBA
    };
};

// ==========================================
// 4. 绘图组件
// ==========================================

const Arrow = ({ start, vec, color, label, fixedLen = null, scale = 1.0, dashed = false, width=1.5, offsetLabelY=0 }) => {
    if(!start || !vec) return null;
    let end;
    if (fixedLen) {
        const mag = Vec2.mag(vec);
        if (mag < 0.01) return null;
        const norm = Vec2.normalize(vec);
        end = { x: start.x + norm.x * fixedLen, y: start.y - norm.y * fixedLen };
    } else {
        end = { x: start.x + vec.x * scale, y: start.y - vec.y * scale };
    }
    return (
        <g>
            <line x1={start.x} y1={start.y} x2={end.x} y2={end.y}
                  stroke={color} strokeWidth={width} strokeDasharray={dashed ? "4,2" : ""}
                  markerEnd={`url(#arrow-${color})`} />
            {label && (
                <text x={end.x + 5} y={end.y - 5 + offsetLabelY} fill={color} fontSize="11" fontWeight="bold" fontFamily="serif">
                    {label}
                </text>
            )}
        </g>
    );
};

const PositionCard = ({ data }) => {
    const W = 420;
    const H = 1400; // 总高度
    const cx = W / 2;

    // --- 布局策略调整 (恢复原始设置) ---
    const geoScale = 0.55;
    const geoOffsetY = 20;
    const border1 = 100;
    const border2 = 1100;
    const oaCy = 1500;

    // 4. 中部：力多边形
    let polyCx = cx;
    const polyCy = (border1 + border2) / 2;

    // 特殊位置平移逻辑
    if ([ "A'2"].includes(data.name)) {
    polyCx -= 190;
    }
    if ([ "A3",].includes(data.name)) {
    polyCx -= 170;
    }
    if (["A4","A1","A16"].includes(data.name)) {
    polyCx -= 80;
    }
    if (["A2"].includes(data.name)) {
    polyCx -= 200;
    }
// 右移
    if (["A20"].includes(data.name)) {
    polyCx += 20;
    }
    if (["A'9"].includes(data.name)) {
    polyCx += 60;
    }
    if (["A10","A21"].includes(data.name)) {
    polyCx += 140;
    }
    if (["A'21", "A22"].includes(data.name)) {
    polyCx += 195;
    }
    if (["A23","A9","A'9"].includes(data.name)) {
    polyCx += 70;
    }

    const toSvg = (pt, ox=cx, oy=geoOffsetY) => ({
        x: ox + pt.x * geoScale * 1000,
        y: oy - pt.y * geoScale * 1000
    });

    const pA = toSvg(data.rA);
    const pB = toSvg(data.rB);
    const pC2 = toSvg(data.rC2);

    // --- 方向修正逻辑 ---
    let vis_R12n = data.R12n;
    let vis_MI2_sign = data.MI2 > 0 ? 1 : -1;

    if (["A7", "A'14", "A19"].includes(data.name)) {
        vis_R12n = Vec2.scale(data.uBA, 50);
    }
    if (data.name === "A2") vis_MI2_sign = 1;
    if (data.name === "A7") vis_MI2_sign = -1;
    if (data.name === "A10") vis_MI2_sign = -1;
    if (data.name === "A'14") vis_MI2_sign = 1;
    if (data.name === "A19") vis_MI2_sign = -1;

    const drawLink23 = () => (
        <g>
            <text x="10" y="20" fontSize="14" fontWeight="bold">1. 构件 2、3 受力</text>
            <line x1={pA.x} y1={pA.y} x2={pB.x} y2={pB.y} stroke="black" strokeWidth="2" />
            <circle cx={pA.x} cy={pA.y} r="3" fill="white" stroke="black"/>
            <circle cx={pB.x} cy={pB.y} r="3" fill="white" stroke="black"/>

            {/* 力矢量：所有长度加倍 (40->80, 45->90, 30->60, 50->100) */}
            {/* R12 不画 */}
            <Arrow start={pA} vec={vis_R12n} color="blue" label="R12n" fixedLen={80} dashed={true} offsetLabelY={-10}/>
            <Arrow start={pA} vec={data.R12t} color="blue" label="R12t" fixedLen={80} dashed={true}/>

            <Arrow start={pC2} vec={data.PI2} color="purple" label="PI2" fixedLen={90} />
            <Arrow start={pC2} vec={data.G2} color="purple" label="Q2" fixedLen={60} />

            {Math.abs(data.MI2) > 1 && (
                <g>
                   <path d={`M ${pC2.x-18} ${pC2.y} A 18 18 0 1 ${vis_MI2_sign > 0 ? 0 : 1} ${pC2.x+18} ${pC2.y}`}
                      fill="none" stroke="purple" markerEnd="url(#arrow-purple)" />
                   <text x={pC2.x+20} y={pC2.y} fill="purple" fontSize="10" fontWeight="bold">MI2</text>
                </g>
            )}

            <rect x={pB.x-15} y={pB.y-20} width="30" height="40" fill="none" stroke="black" />
            <Arrow start={pB} vec={data.P_total} color="red" label="P" fixedLen={100} />
            <Arrow start={pB} vec={data.R03} color="green" label="R03" fixedLen={90} />
        </g>
    );

    // 动态调整力多边形比例
    const polyTargetSize = 680;
    const forces = [data.P_total, data.PI2, data.G2, data.R12, data.R03];
    const maxForceVal = Math.max(...forces.map(f => Math.max(Math.abs(f.x), Math.abs(f.y))));

    // 特定位置放大 0.5 倍 (即比例尺变小)
    let polyScaleMultiplier = 1.0;
    if (["A3", "A9", "A'9", "A10"].includes(data.name)) {
        polyScaleMultiplier = 0.8;
    }
    if (["A'2","A20","A8","A'21"].includes(data.name)) {
        polyScaleMultiplier = 0.85;
    }
    if (["A0", "A1", "A4", "A'6", "A5", "A6","A8", "A'14", "A7", "A11", "A12", "A13", "A14","A'18", "A15", "A16", "A17", "A18", "A19","A20"].includes(data.name)) {
        polyScaleMultiplier = 1.4;
    }
    if (["A23"].includes(data.name)) {
        polyScaleMultiplier = 1.3;
    }
    if (["A21"].includes(data.name)) {
        polyScaleMultiplier = 0.75;
    }
    const baseScale = maxForceVal > 0 ? (polyTargetSize / 1.5) / maxForceVal : 0.001;
    const dynamicPolyScale = baseScale * polyScaleMultiplier;

    const scaleLabel = (1 / dynamicPolyScale).toFixed(1);

    const drawPoly = () => {
        const v_P = data.P_total;
        const v_QPI2 = Vec2.add(data.G2, data.PI2);
        const v_R12n = data.R12n;
        const v_R12t = data.R12t;

        const pp1 = { x: polyCx - v_P.x*dynamicPolyScale/2, y: polyCy + v_P.y*dynamicPolyScale/2 };
        const addVec = (pt, v) => ({ x: pt.x + v.x*dynamicPolyScale, y: pt.y - v.y*dynamicPolyScale });
        const pp2 = addVec(pp1, v_P);
        const pp3 = addVec(pp2, v_QPI2);
        const pp4 = addVec(pp3, v_R12n);
        const pp5 = addVec(pp4, v_R12t);

        // --- 角度计算逻辑 ---
        const toDeg = (rad) => rad * 180 / Math.PI;
        const getVecAngle = (v1, v2) => {
            const m1 = Math.sqrt(v1.x**2 + v1.y**2);
            const m2 = Math.sqrt(v2.x**2 + v2.y**2);
            if (m1 * m2 === 0) return 0;
            const dot = v1.x * v2.x + v1.y * v2.y;
            // 限制范围防止 acos NaN
            return toDeg(Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2)))));
        };

        // 1. R12n 与 竖直线 (0, 1) 的夹角 (锐角)
        const angle1 = Math.abs(toDeg(Math.atan(data.R12n.x / (data.R12n.y || 0.0001))));
        // 2. P 与 (Q2+PI2) 夹角
        const angle2 = getVecAngle(data.P_total, v_QPI2);
        // 3. (Q2+PI2) 与 R12n 夹角
        const angle3 = getVecAngle(v_QPI2, data.R12n);
        // 4. OA 与 竖直线 的夹角 (使用 rA 向量计算，结果为锐角)
        const angle4 = Math.abs(toDeg(Math.atan(data.rA.x / (data.rA.y || 0.0001))));

        return (
            <g>
                <text x="10" y={border1 + 30} fontSize="14" fontWeight="bold">2. 力多边形 (μF ≈ {scaleLabel} N/px)</text>
                <line x1={pp1.x} y1={pp1.y} x2={pp2.x} y2={pp2.y} stroke="red" markerEnd="url(#arrow-red)" />
                <text x={(pp1.x+pp2.x)/2+5} y={(pp1.y+pp2.y)/2} fill="red" fontSize="10">P</text>

                <line x1={pp2.x} y1={pp2.y} x2={pp3.x} y2={pp3.y} stroke="purple" markerEnd="url(#arrow-purple)" />
                <text x={(pp2.x+pp3.x)/2+5} y={(pp2.y+pp3.y)/2} fill="purple" fontSize="10">Q2+PI2</text>

                <line x1={pp3.x} y1={pp3.y} x2={pp4.x} y2={pp4.y} stroke="blue" strokeDasharray="3,3" markerEnd="url(#arrow-blue)" />
                <text x={(pp3.x+pp4.x)/2+5} y={(pp3.y+pp4.y)/2} fill="blue" fontSize="10">R12n</text>

                <line x1={pp4.x} y1={pp4.y} x2={pp5.x} y2={pp5.y} stroke="blue" strokeDasharray="3,3" markerEnd="url(#arrow-blue)" />
                <text x={(pp4.x+pp5.x)/2+5} y={(pp4.y+pp5.y)/2} fill="blue" fontSize="10">R12t</text>

                {/* 绘制 R12 合力 */}
                <line x1={pp3.x} y1={pp3.y} x2={pp5.x} y2={pp5.y} stroke="blue" strokeWidth="1.5" />
                <text x={(pp3.x+pp5.x)/2-15} y={(pp3.y+pp5.y)/2} fill="blue" fontSize="10" fontWeight="bold">R12</text>

                <line x1={pp5.x} y1={pp5.y} x2={pp1.x} y2={pp1.y} stroke="green" markerEnd="url(#arrow-green)" />
                <text x={(pp5.x+pp1.x)/2+5} y={(pp5.y+pp1.y)/2} fill="green" fontSize="10">R03</text>

                <text x={pp1.x-10} y={pp1.y-10} fontSize="10">o</text>

                {/* --- 文字显示区域 (向上调整Y坐标以容纳4行) --- */}
                <text x="10" y={border2 - 75} fontSize="12" fill="black">1、R12n与竖直线所成角：{angle1.toFixed(2)}°</text>
                <text x="10" y={border2 - 55} fontSize="12" fill="black">2、P与(Q2+PI2)所成角为：{angle2.toFixed(2)}°</text>
                <text x="10" y={border2 - 35} fontSize="12" fill="black">3、(Q2+PI2)与R12n所成角：{angle3.toFixed(2)}°</text>
                <text x="10" y={border2 - 15} fontSize="12" fill="black">4、OA与竖直方向所成角：{angle4.toFixed(2)}°</text>
            </g>
        );
    };

    const drawOA = () => {
        const pO_oa = { x: cx, y: oaCy };
        const pA_oa = { x: cx + data.rA.x * geoScale * 1000, y: oaCy - data.rA.y * geoScale * 1000 };
        // OA杆绘图比例尺 = 力多边形比例尺 * 2
        const oaForceScale = dynamicPolyScale * 0.4;

        // 增加比例尺文字
        const oaScaleLabel = (1 / oaForceScale).toFixed(1);

        return (
            <g>
                <text x="10" y={border2 + 30} fontSize="14" fontWeight="bold">3. OA杆受力 (μF ≈ {oaScaleLabel} N/px)</text>
                <line x1={pO_oa.x} y1={pO_oa.y} x2={pA_oa.x} y2={pA_oa.y} stroke="black" strokeWidth="3" />
                <circle cx={pO_oa.x} cy={pO_oa.y} r="4" fill="black" />
                <circle cx={pA_oa.x} cy={pA_oa.y} r="3" fill="white" stroke="black" />

                {/* 标出 O, A 点 */}
                <text x={pO_oa.x - 15} y={pO_oa.y + 5} fontSize="12" fontWeight="bold">O</text>
                <text x={pA_oa.x - 15} y={pA_oa.y} fontSize="12" fontWeight="bold">A</text>

                <Arrow start={pA_oa} vec={data.R21} color="blue" label="R21" scale={oaForceScale} />
                <Arrow start={pO_oa} vec={data.R01} color="orange" label="R01" scale={oaForceScale} />
                {Math.abs(data.Md) > 1 && (
                    <path d={`M ${pO_oa.x-30} ${pO_oa.y} A 30 30 0 1 ${data.Md>0?0:1} ${pO_oa.x+30} ${pO_oa.y}`}
                        fill="none" stroke="orange" markerEnd="url(#arrow-orange)" />
                )}
                <text x={pO_oa.x+35} y={pO_oa.y} fill="orange" fontWeight="bold">Md</text>
            </g>
        );
    };

    return (
        <div className="border border-black bg-white relative break-inside-avoid mb-4" style={{ width: '100%', height: `${H}px` }}>
            <div className="absolute top-0 left-0 bg-black text-white px-2 py-1 text-xs font-bold font-serif">
                位置 {data.name} ({data.angle.toFixed(1)}°)
            </div>
            <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
                <defs>
                    {['red', 'blue', 'green', 'purple', 'black', 'orange'].map(c => (
                        <marker key={c} id={`arrow-${c}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                            <path d="M0,0 L6,3 L0,6 z" fill={c} />
                        </marker>
                    ))}
                </defs>
                {/* 分隔线 */}
                <line x1="0" y1={border1} x2={W} y2={border1} stroke="#ddd" strokeDasharray="5,5" />
                <line x1="0" y1={border2} x2={W} y2={border2} stroke="#ddd" strokeDasharray="5,5" />
                {drawLink23()}
                {drawPoly()}
                {drawOA()}
            </svg>
        </div>
    );
};

// 5. 主视图组件

// 1. 修改参数接收
const Stage3View = ({ schemeProp, customParams }) => {
  const [localScheme, setLocalScheme] = useState('VII');
  const effectiveScheme = schemeProp || localScheme;

  // 2. 【核心修改】替换原来的 const analysisData 计算前的逻辑
  // 我们需要先确定使用哪份基础数据 (SCHEMES[k] 还是 customParams)
// 1. 先计算出当前要用的基础数据 data
  const currentData = useMemo(() => {
    // 【修复】确保 Custom 模式下返回正确构造的数据
    if (effectiveScheme === 'Custom' && customParams) {
      return {
        h: customParams.h, d: customParams.d, e: customParams.e, k: customParams.k,
        lac: customParams.lAC_ratio,
        q1: customParams.q1, q2: customParams.q2, q3: customParams.q3,
        rho: customParams.rho_ratio,
        n1: customParams.n1,
        delta: customParams.delta_limit_inv,
        cam1: { h: customParams.cam1_h, e: customParams.cam1_e, r: customParams.cam1_r0 },
        cam2: { h: customParams.cam2_h, e: customParams.cam2_e, r: customParams.cam2_r0 }
      };
    }
    return SCHEMES[effectiveScheme] || SCHEMES['VII'];
  }, [effectiveScheme, customParams]);
  const schemeKey = effectiveScheme;      // 定义 schemeKey
  const setSchemeKey = setLocalScheme;
  // 3. 修改 analysisData 的依赖
  const analysisData = useMemo(() => {
    const scheme = currentData; // 使用上面计算出来的数据
    if(!scheme) return [];

    return ANALYSIS_POINTS.map(pt => {
      const res = solveSystem(scheme, pt.angle);
      return { name: pt.name, angle: pt.angle, ...res };
    });
  }, [currentData]); // 依赖改为 currentData

    const Mr = useMemo(() => {
        if(analysisData.length === 0) return 0;
        return analysisData.reduce((acc, d) => acc + d.Md, 0) / analysisData.length;
    }, [analysisData]);

    const chartConfig = useMemo(() => {
        if(analysisData.length === 0) return { min: -100, max: 100, yTicks: [], xTicks: [] };
        const vals = analysisData.map(d => d.Md);
        const minVal = Math.min(...vals);
        const maxVal = Math.max(...vals);

        // 刻度设置：Y轴每300
        const yStep = 300;
        const minGrid = Math.floor(minVal / yStep) * yStep - yStep;
        const maxGrid = Math.ceil(maxVal / yStep) * yStep + yStep;
        const yTicks = [];
        for (let y = minGrid; y <= maxGrid; y += yStep) {
            yTicks.push(y);
        }

        // X轴刻度：每30度
        const xTicks = [];
        for (let x = 0; x <= 720; x += 30) {
            xTicks.push(x);
        }

        return { min: minGrid, max: maxGrid, yTicks, xTicks };
    }, [analysisData]);

    // 平滑曲线生成 (Catmull-Rom Spline)
    const getSmoothPath = (points, scaleX, scaleY) => {
        if (points.length < 2) return "";
        // 将数据点映射到绘图坐标
        const mapped = points.map(p => ({ x: scaleX(p.angle), y: scaleY(p.Md) }));
        let d = `M ${mapped[0].x} ${mapped[0].y}`;

        for (let i = 0; i < mapped.length - 1; i++) {
            const p0 = mapped[i === 0 ? 0 : i - 1];
            const p1 = mapped[i];
            const p2 = mapped[i + 1];
            const p3 = mapped[i + 2] || p2;

            const cp1x = p1.x + (p2.x - p0.x) / 6;
            const cp1y = p1.y + (p2.y - p0.y) / 6;
            const cp2x = p2.x - (p3.x - p1.x) / 6;
            const cp2y = p2.y - (p3.y - p1.y) / 6;

            d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
        }
        return d;
    };

    return (
        <div className="min-h-screen bg-white p-8 font-serif text-gray-900 print:p-0">
            <div className="fixed top-4 right-4 z-50 bg-white border shadow p-2 print:hidden">
                <span className="font-bold mr-2">方案:</span>
                {Object.keys(SCHEMES).map(k => (
                    <button key={k} onClick={()=>setSchemeKey(k)} className={`mx-1 px-2 border ${schemeKey===k?'bg-blue-600 text-white':''}`}>{k}</button>
                ))}
            </div>

            <div className="max-w-[210mm] mx-auto">
                <h1 className="text-2xl font-bold mb-6 border-b-2 border-black pb-2">三、 动态静力分析</h1>

                {/* 1:1 复刻原文内容及公式 */}
                <div className="text-justify leading-relaxed text-[15px] mb-6 font-serif indent-8">
                    <p className="mb-4">
                        动态静力分析－根据理论力学中所讲的达朗贝尔原理（亦称动静法），将惯
                        性力视为一般外力加在构件上，仍可采用静力学方法对其进行受力分析。这样的
                        力分析称为动态静力分析。
                    </p>
                    <div className="pl-4 space-y-3 indent-0">
                        <p>
                            惯性力： <i className="font-times">P<sub>I</sub> = −m · a<sub>s</sub></i> &nbsp;&nbsp;
                            <span className="text-sm">m 为构件质量， a<sub>s</sub> 为构件质心的加速度 （“-” 号表示 P<sub>I</sub> 的方向与 a<sub>s</sub> 的方向相反）</span>
                        </p>
                        <p>
                            惯性力偶矩： <i className="font-times">M<sub>I</sub> = −J<sub>s</sub> · α<sub>s</sub></i> &nbsp;&nbsp;
                            <span className="text-sm">J<sub>s</sub> 为对于其质心的转动惯量， α<sub>s</sub> 是构件的 角加速度（“-”号表示 M<sub>I</sub> 的方向与 α<sub>s</sub> 方向相反）。</span>
                        </p>

                        <p className="mt-2">对于构件 2：</p>
                        <div className="pl-8">
                            <p className="mb-2"><i className="font-times">P<sub>I2</sub> = −m<sub>2</sub> · a<sub>C2</sub> = − (Q<sub>2</sub> / g) a<sub>C2</sub></i> <span className="float-right mr-10">(2-1)</span></p>
                            <p><i className="font-times">M<sub>I2</sub> = −J<sub>C2</sub> · α<sub>2</sub> = − (Q<sub>2</sub> / g) ρ<sup>2</sup><sub>C2</sub> α<sub>2</sub></i> <span className="float-right mr-10">(2-2)</span></p>
                        </div>

                        <p className="mt-2">对于构件 3：</p>
                        <div className="pl-8">
                            <p><i className="font-times">P<sub>I3</sub> = −m<sub>3</sub> · a<sub>B</sub> = − (Q<sub>3</sub> / g) a<sub>B</sub></i> <span className="float-right mr-10">(2-3)</span></p>
                        </div>
                    </div>
                </div>

                <div className="mb-8 mt-4 text-center">
                    <div className="inline-block w-[90%]">
                         <img src="/shigt.png" alt="示功图" className="w-full h-auto border border-gray-300" />
                    </div>
                    <div className="font-bold text-sm mt-2">图 9 示工图</div>
                </div>

                <div className="break-inside-avoid">
                    <h3 className="text-lg font-bold mb-4">3.1 动态静力学分析步骤</h3>
                    <p className="indent-8 mb-4 text-[15px] font-serif">
                        本次课程设计中，将 30 点分成 6 组每个人负责 5 个点，我在本次课设中负
                        责 C 组（2、6、9、14、20）这五个点的受力分析。以下受力分析以 9 点为例说
                        明。
                    </p>
                    <div className="space-y-4 pl-4 text-[15px] font-serif">
                        <p>（1）活塞上的气体压力</p>
                        <div className="pl-8">
                            <i className="font-times">P' = p<sub>i</sub> · F</i> &nbsp;&nbsp; (N) <span className="float-right mr-10">(3-1)</span>
                            <div className="text-sm mt-1">F --活塞的面积 （cm<sup>2</sup>）</div>
                        </div>

                        <p>（2）求作用于构件上的惯性力</p>
                        <div className="pl-8 space-y-1">
                            <p><i className="font-times">P<sub>I2</sub> = −m<sub>2</sub> · a<sub>c2</sub></i> (N) <span className="float-right mr-10">(3-2)</span></p>
                            <p><i className="font-times">J<sub>c2</sub> = −m<sub>2</sub> · ρ<sub>c</sub><sup>2</sup></i> (N)</p>
                            <p><i className="font-times">P<sub>I3</sub> = −m<sub>3</sub> · a<sub>B</sub></i> (N)</p>
                        </div>

                        <p>（3）求出活塞上受力的大小及方向</p>
                        <div className="pl-8">
                            <i className="font-times font-bold">P</i> = <i className="font-times font-bold">P'</i> + <i className="font-times font-bold">P<sub>I3</sub></i> + <i className="font-times font-bold">Q<sub>3</sub></i>
                            <span className="text-sm ml-4">（注：其中的 P' 可由示功图按照比例尺具体求出）</span>
                        </div>

                        <p>（4）把作用在构件 2 上的反力 <i className="font-times">R<sub>12</sub></i> 分解为 <i className="font-times">R<sup>n</sup><sub>12</sub></i> 和 <i className="font-times">R<sup>t</sup><sub>12</sub></i>。</p>
                        <div className="pl-8">
                            <p className="mb-2"><i className="font-times">M<sub>I2</sub> = −J<sub>c2</sub> · α<sub>c2</sub></i> （<i className="font-times">α<sub>c2</sub></i> 方向可由前面的速度分析中可以确定，则 <i className="font-times">M<sub>I2</sub></i> 方向与之
                            相反）</p>
                            <p>计算公式： <i className="font-times">Q<sub>2</sub> · h<sub>1</sub> · μ<sub>l</sub> + P<sub>I2</sub> · h<sub>2</sub> · μ<sub>l</sub> + R<sup>t</sup><sub>12</sub> · L<sub>AB</sub> · μ<sub>l</sub> + M<sub>I2</sub> = 0</i></p>
                        </div>

                        <p className="indent-8 mt-4">
                            先假设 <i className="font-times">R<sup>t</sup><sub>12</sub></i> 的方向往右, 记 M 的方向为：顺时针为“-”，逆时针为“+”，取
                            <i className="font-times">∑M<sub>B</sub> = 0</i>，即可求出 <i className="font-times">R<sup>t</sup><sub>12</sub></i>
                            （若求得结果为正值，则 <i className="font-times">R<sup>t</sup><sub>12</sub></i> 方向与假设方向同向，反之
                            反向）
                        </p>
                    </div>
                </div>

                <div className="break-before-page">
                    <h3 className="text-lg font-bold mb-4">3.3 动态静力分析结果</h3>
                    <p className="indent-8 mb-4 text-[15px]">
                        通过计算汇总数据我们可以得到我们所需各点的参数，得到表 3、表 4、表 5：
                    </p>

                    <div className="mb-6">
                        <h4 className="text-center font-bold text-xs mb-1">表 3 构件 2、3 惯性力及惯性力矩数值</h4>
                        <table className="w-full border-collapse text-xs text-center border-t-2 border-b-2 border-black">
                            <thead>
                                <tr className="border-b border-black">
                                    <th className="py-2">位置</th><th>PI2 (N)</th><th>MI2 (N·m)</th><th>PI3 (N)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {analysisData.map((d, i) => (
                                    <tr key={i} className={i%2===0?'bg-gray-50':''}>
                                        <td className="py-1 font-bold">{d.name}</td>
                                        <td>{Vec2.mag(d.PI2).toFixed(1)}</td>
                                        <td>{d.MI2.toFixed(2)}</td>
                                        <td>{Vec2.mag(d.PI3).toFixed(1)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="mb-6">
                        <h4 className="text-center font-bold text-xs mb-1">表 4 各个构件间力数值</h4>
                        <table className="w-full border-collapse text-xs text-center border-t-2 border-b-2 border-black">
                            <thead>
                                <tr className="border-b border-black">
                                    <th className="py-2">位置</th><th>P' (N)</th><th>R12n (N)</th><th>R12t (N)</th><th>R12 (N)</th><th>R03 (N)</th><th>R23 (N)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {analysisData.map((d, i) => (
                                    <tr key={i} className={i%2===0?'bg-gray-50':''}>
                                        <td className="py-1 font-bold">{d.name}</td>
                                        <td className="text-red-700">{d.F_gas_mag.toFixed(0)}</td>
                                        <td>{Vec2.mag(d.R12n).toFixed(0)}</td>
                                        <td>{Vec2.mag(d.R12t).toFixed(0)}</td>
                                        <td className="font-bold">{Vec2.mag(d.R12).toFixed(0)}</td>
                                        <td>{Math.abs(d.R03.x).toFixed(0)}</td>
                                        <td>{Vec2.mag(d.R23).toFixed(0)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                     <div className="mb-6">
                        <h4 className="text-center font-bold text-xs mb-1">表 5 曲柄所受部分力和力矩数据</h4>
                        <table className="w-full border-collapse text-xs text-center border-t-2 border-b-2 border-black">
                            <thead>
                                <tr className="border-b border-black">
                                    <th className="py-2">位置</th><th>R01 (N)</th><th>Mb (N·m)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {analysisData.map((d, i) => (
                                    <tr key={i} className={i%2===0?'bg-gray-50':''}>
                                        <td className="py-1 font-bold">{d.name}</td>
                                        <td>{Vec2.mag(d.R01).toFixed(0)}</td>
                                        <td className="font-bold text-blue-800">{d.Md.toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="break-before-page mb-8">
                    <h3 className="text-lg font-bold mb-4">3.4 Mb=Mb(φ)曲线的绘制</h3>
                    <div className="border border-black p-4 bg-white">
                        <h4 className="text-center font-bold mb-4">图 13 驱动力矩-阻抗力矩曲线</h4>
                        <svg viewBox={`0 0 800 500`} className="w-full overflow-visible">
                            <defs>
                                <pattern id="smallGrid" width="10" height="10" patternUnits="userSpaceOnUse">
                                    <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#f0f0f0" strokeWidth="0.5"/>
                                </pattern>
                            </defs>

                            {(() => {
                                const { min, max, yTicks, xTicks } = chartConfig;
                                const W = 750;
                                const H = 450;
                                const paddingL = 60;
                                const paddingB = 30;
                                const plotW = W - paddingL;
                                const plotH = H - paddingB;

                                const scaleY = (val) => plotH - ((val - min) / (max - min)) * plotH;
                                const scaleX = (deg) => paddingL + (deg / 720) * plotW;

                                // 强制添加 720 度点 (Md = 0)
                                const plotPoints = [...analysisData, { angle: 720, Md: 0 }];

                                // 使用平滑曲线绘制 (Catmull-Rom Spline)
                                const pathD = getSmoothPath(plotPoints, scaleX, scaleY);
                                const mrY = scaleY(Mr);

                                return (
                                    <g>
                                        {/* 网格线 Y */}
                                        {yTicks.map(val => (
                                            <line key={val} x1={paddingL} y1={scaleY(val)} x2={W} y2={scaleY(val)} stroke="#e0e0e0" strokeWidth="1" />
                                        ))}
                                        {/* 网格线 X */}
                                        {xTicks.map(val => (
                                            <line key={val} x1={scaleX(val)} y1={0} x2={scaleX(val)} y2={plotH} stroke="#f5f5f5" strokeWidth="0.5" />
                                        ))}

                                        {/* 坐标轴 */}
                                        <line x1={paddingL} y1={scaleY(0)} x2={W} y2={scaleY(0)} stroke="black" strokeWidth="1.5" />
                                        <line x1={paddingL} y1={plotH} x2={paddingL} y2={0} stroke="black" strokeWidth="1.5" />

                                        {/* 曲线 (平滑) */}
                                        <path d={pathD} fill="none" stroke="black" strokeWidth="1.5" />

                                        {/* 阻抗力矩线 Mr */}
                                        <line x1={paddingL} y1={mrY} x2={W} y2={mrY} stroke="blue" strokeWidth="2" strokeDasharray="6,4" />
                                        <text x={W+5} y={mrY} fill="blue" fontSize="12" fontWeight="bold">Mr = {Mr.toFixed(2)} N·m</text>

                                        {/* 数据点 (表5来源) */}
                                        {plotPoints.map((d,i) => (
                                            <circle key={i} cx={scaleX(d.angle)} cy={scaleY(d.Md)} r="3" fill="red" stroke="none"/>
                                        ))}

                                        {/* X轴刻度 */}
                                        {xTicks.map((deg, i) => (
                                            <g key={deg}>
                                                <line x1={scaleX(deg)} y1={scaleY(0)} x2={scaleX(deg)} y2={scaleY(0)+5} stroke="black"/>
                                                {i%2===0 && (
                                                     <text x={scaleX(deg)} y={scaleY(0)+15} fontSize="9" textAnchor="middle">{deg}</text>
                                                )}
                                            </g>
                                        ))}

                                        {/* Y轴刻度 */}
                                        {yTicks.map(val => (
                                            <g key={val}>
                                                <text x={paddingL-5} y={scaleY(val)} fontSize="10" textAnchor="end" dominantBaseline="middle">{val}</text>
                                                <line x1={paddingL-5} y1={scaleY(val)} x2={paddingL} y2={scaleY(val)} stroke="black"/>
                                            </g>
                                        ))}

                                        <text x={W+10} y={scaleY(0)} fontSize="12" fontStyle="italic">φ (°)</text>
                                        <text x={paddingL} y={-10} fontSize="12" fontStyle="italic">M (N·m)</text>
                                    </g>
                                );
                            })()}
                        </svg>
                    </div>
                </div>

                <div className="break-before-page">
                    <h3 className="text-lg font-bold mb-4 border-b-2 border-black">附：动态静力分析矢量图 (全30位置)</h3>
                    {/* 使用响应式网格展示所有图 */}
                    {/*<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">*/}
                    <div className="grid grid-cols-3 gap-8">
                        {analysisData.map((d, i) => (
                            <PositionCard key={i} data={d} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Stage3View;
