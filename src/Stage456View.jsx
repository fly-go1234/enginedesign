import React, { useState, useMemo } from 'react';
import { SCHEMES, calculateKinematics } from './Stage1View';

// ==========================================
// 1. 核心解算逻辑
// ==========================================

const GAS_HEIGHT_MAP = {
    0: 0, 30: 1, 60: 1, 73.5: 1, 90: 1, 120: 1, 150: 1, 180: 1, 180.1: 1,
    210: 1, 240: 1.5, 270: 5, 283.5: 8, 300: 15, 330: 43.5, 360: 140,
    390: 140, 420: 72.5, 433.5: 50.5, 450: 32.5, 480: 15, 510: 7.5,
    540: 2.5, 540.1: 2.5, 570: 1, 600: 1, 630: 1, 643.5: 1, 660: 1,
    690: 1, 720: 0
};

const getGasHeight = (angle) => {
    const normAngle = angle % 720;
    const exactMatch = Object.keys(GAS_HEIGHT_MAP).find(k => Math.abs(parseFloat(k) - normAngle) < 0.01);
    if (exactMatch !== undefined) return GAS_HEIGHT_MAP[exactMatch];
    const keys = Object.keys(GAS_HEIGHT_MAP).map(Number).sort((a,b)=>a-b);
    let prev = keys[0], next = keys[keys.length-1];
    for (let i = 0; i < keys.length - 1; i++) {
        if (normAngle >= keys[i] && normAngle <= keys[i+1]) {
            prev = keys[i]; next = keys[i+1]; break;
        }
    }
    const ratio = (normAngle - prev) / (next - prev);
    return GAS_HEIGHT_MAP[prev] + (GAS_HEIGHT_MAP[next] - GAS_HEIGHT_MAP[prev]) * ratio;
};

const ANALYSIS_POINTS = [
    0, 30, 60, 73.5, 90, 120, 150, 180, 180.1,
    210, 240, 270, 283.5, 300, 330, 360, 390, 420,
    433.5, 450, 480, 510, 540, 540.1, 570, 600, 630,
    643.5, 660, 690
];

const toRad = (deg) => deg * Math.PI / 180;

const Vec2 = {
    add: (v1, v2) => ({ x: v1.x + v2.x, y: v1.y + v2.y }),
    sub: (v1, v2) => ({ x: v1.x - v2.x, y: v1.y - v2.y }),
    scale: (v, s) => ({ x: v.x * s, y: v.y * s }),
    cross: (v1, v2) => v1.x * v2.y - v1.y * v2.x,
    normalize: (v) => {
        const m = Math.sqrt(v.x*v.x + v.y*v.y);
        return m === 0 ? {x:0,y:0} : { x: v.x/m, y: v.y/m };
    }
};

const solveMd = (scheme, angleDeg) => {
    const kine = calculateKinematics({ k: scheme.k, h: scheme.h, e: scheme.e });
    const l_m = kine.l / 1000;
    const r_m = kine.r / 1000;
    const e_m = scheme.e / 1000;
    const omega1 = (2 * Math.PI * scheme.n1) / 60;
    const phiFromTDC = toRad(angleDeg);

    const angTDC_Geo = Math.asin(e_m / (l_m + r_m));
    const phiGeo = angTDC_Geo + phiFromTDC;
    const sinBeta = (e_m - r_m * Math.sin(phiGeo)) / l_m;
    const beta = Math.asin(Math.max(-1, Math.min(1, sinBeta)));
    const cosBeta = Math.cos(beta);

    const rA = { x: r_m * Math.sin(phiFromTDC), y: r_m * Math.cos(phiFromTDC) };
    const rB = { x: e_m, y: rA.y + l_m * cosBeta };

    const omega2 = - (r_m * omega1 * Math.cos(phiGeo)) / (l_m * cosBeta);
    const alpha2 = (r_m * Math.pow(omega1, 2) * Math.sin(phiGeo) + l_m * Math.pow(omega2, 2) * sinBeta) / (l_m * cosBeta);

    const Aa_vec = { x: -r_m * Math.pow(omega1, 2) * Math.sin(phiGeo), y: -r_m * Math.pow(omega1, 2) * Math.cos(phiGeo) };
    const Aba_n_vec = { x: -l_m * Math.pow(omega2, 2) * Math.sin(beta), y: -l_m * Math.pow(omega2, 2) * Math.cos(beta) };
    const Aba_t_vec = { x: l_m * alpha2 * Math.cos(beta), y: -l_m * alpha2 * Math.sin(beta) };
    const Aba_vec = Vec2.add(Aba_n_vec, Aba_t_vec);
    const Ab_vec = Vec2.add(Aa_vec, Aba_vec);

    const lacVal = scheme.lac !== undefined ? scheme.lac : scheme.lac_ratio;
    const Ac2a_n = Vec2.scale(Aba_n_vec, lacVal);
    const Ac2a_t = Vec2.scale(Aba_t_vec, lacVal);
    const Ac2_vec = Vec2.add(Aa_vec, Vec2.add(Ac2a_n, Ac2a_t));

    const g = 9.8;
    const q2Val = scheme.q2 !== undefined ? scheme.q2 : scheme.Q2;
    const q3Val = scheme.q3 !== undefined ? scheme.q3 : scheme.Q3;
    const m2 = q2Val / g;
    const m3 = q3Val / g;

    const rhoVal = scheme.rho !== undefined ? scheme.rho : scheme.rho_ratio;
    const Jc2 = m2 * Math.pow(rhoVal * l_m, 2);

    const p_height = getGasHeight(angleDeg);
    const mu_pi = 2;
    const D_cm = scheme.d / 10;
    const area_cm2 = Math.PI * Math.pow(D_cm / 2, 2);
    const F_gas_mag = p_height * mu_pi * area_cm2;
    const Fp = { x: 0, y: -F_gas_mag };

    const PI2 = Vec2.scale(Ac2_vec, -m2);
    const PI3 = Vec2.scale(Ab_vec, -m3);
    const MI2 = -Jc2 * alpha2;

    const G3 = { x: 0, y: -q3Val };
    const G2 = { x: 0, y: -q2Val };
    const P_total = Vec2.add(Fp, Vec2.add(PI3, G3));

    const rC2 = {
        x: rA.x * (1 - lacVal) + rB.x * lacVal,
        y: rA.y * (1 - lacVal) + rB.y * lacVal
    };

    const rBA = Vec2.sub(rA, rB);
    const uBA = Vec2.normalize(rBA);
    const ut = { x: -uBA.y, y: uBA.x };
    const rC2B = Vec2.sub(rC2, rB);

    const m_G2 = Vec2.cross(rC2B, G2);
    const m_PI2 = Vec2.cross(rC2B, PI2);

    const R12t_mag = -(m_G2 + m_PI2 + MI2) / l_m;
    const R12t = Vec2.scale(ut, R12t_mag);
    const known_y = R12t.y + G2.y + PI2.y + P_total.y;
    const R12n_mag = -known_y / uBA.y;
    const R12n = Vec2.scale(uBA, R12n_mag);
    const R12 = Vec2.add(R12n, R12t);
    const R21 = Vec2.scale(R12, -1);

    const m_R21 = Vec2.cross(rA, R21);
    return -m_R21; // Md = Mb
};

// 辅助计算: 提取波瓣 (严格按照物理坐标系：纵轴、横轴与曲线围成)
const calculateLobes = (data, baseline, scaleM, scalePhi) => {
    const lobes = [];

    const getVal = (d) => d.Md - baseline;

    // 初始化：确保从索引0开始积分，不跳过任何一段
    let currentArea = 0;

    for(let i=0; i<data.length-1; i++) {
        const p1 = data[i];
        const p2 = data[i+1];
        const val1 = getVal(p1);
        const val2 = getVal(p2);

        // 梯形积分 -> 转换为图纸面积 (mm²)
        const dA_phys = (val1 + val2) / 2 * toRad(1); // 物理功 (N·m·rad)
        const dA_mm2 = dA_phys / (scaleM * scalePhi); // 图纸面积 (mm²)

        currentArea += dA_mm2;

        // 过零检测
        // 当 val1 和 val2 异号时，视为一个波瓣结束
        const isCrossing = (val1 >= 0 && val2 < 0) || (val1 < 0 && val2 >= 0);

        if (isCrossing) {
            lobes.push({ areaMm2: currentArea });
            currentArea = 0;
        }
    }
    // 添加最后一段
    if (Math.abs(currentArea) > 0.01) {
        lobes.push({ areaMm2: currentArea });
    }

    return lobes;
};

// ==========================================
// 2. CSS Helper Components (Fixed: Defined Outside)
// ==========================================

const Fraction = ({ top, bottom }) => (
    <span style={{ display: 'inline-flex', flexDirection: 'column', textAlign: 'center', verticalAlign: 'middle', margin: '0 4px' }}>
        <span style={{ borderBottom: '1px solid black', paddingBottom: '1px' }}>{top}</span>
        <span>{bottom}</span>
    </span>
);

const VectorText = ({ text }) => (
    <span className="inline-flex flex-col items-center leading-none align-middle mx-0.5 relative top-1">
        <span className="text-[10px] relative top-1">&rarr;</span>
        <span>{text}</span>
    </span>
);

// ==========================================
// 3. Stage 4 主视图
// ==========================================

const Stage456View = ({ schemeProp, customParams }) => {
  const [localScheme, setLocalScheme] = useState('VII');
  const effectiveScheme = schemeProp || localScheme;

  // 准备数据对象
  const currentData = useMemo(() => {
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

  // 重要：把这个变量名统一为 schemeKey，以便下面代码不用改太多，但逻辑要是对的
  // 其实这里我们可以直接用 currentData
  const schemeKey = effectiveScheme;      // 定义 schemeKey
  const setSchemeKey = setLocalScheme;    // 定义 setSchemeKey
    // 1. 获取 Mr (严格 Stage 3 算法)
  const Mr = useMemo(() => {
    // 【修复白屏】使用 currentData 而不是 SCHEMES[schemeKey]
    const scheme = currentData;
    if(!scheme) return 0;

    let sum = 0;
    ANALYSIS_POINTS.forEach(angle => {
      sum += solveMd(scheme, angle);
    });
    return sum / ANALYSIS_POINTS.length;
  }, [currentData]);

  // 2. 全周期数据
  const cycleData = useMemo(() => {
    const scheme = currentData; // 【修复】使用 currentData
    const data = [];
    for(let phi=0; phi<=720; phi+=1) {
      data.push({ angle: phi, Md: solveMd(scheme, phi) });
    }
    return data;
  }, [currentData]);

  // 3. 比例尺设定
  const scales = useMemo(() => {
    const vals = cycleData.map(d => d.Md);
    const maxVal = Math.max(...vals);
    const minVal = Math.min(...vals);
    const mu_phi_deg = 3;
    const mu_phi = toRad(mu_phi_deg);
    const L_mm = 720 / mu_phi_deg;
    const mu_M = (maxVal + Math.abs(minVal)) / 160;
    return { mu_M, mu_phi, L_mm, mu_phi_deg };
  }, [cycleData]);

  // 4. 表 6 数据
  const table6Data = useMemo(() => {
    if(cycleData.length === 0) return [];
    let lobes = calculateLobes(cycleData, 0, scales.mu_M, scales.mu_phi);
    return lobes.map((lobe, index) => ({
      id: index + 1,
      area: lobe.areaMm2
    }));
  }, [cycleData, scales]);

  // 5. 表 7 数据 & W_max
  const { table7Data, W_max_phys } = useMemo(() => {
    if(cycleData.length === 0) return { table7Data: [], W_max_phys: 0 };
    let lobes = calculateLobes(cycleData, Mr, scales.mu_M, scales.mu_phi);
    let maxE = -Infinity, minE = Infinity, currE = 0;
    for(let i=0; i < cycleData.length; i++) {
        const val = cycleData[i].Md - Mr;
        const dA = val * toRad(1);
        currE += dA;
        if(currE > maxE) maxE = currE;
        if(currE < minE) minE = currE;
    }
    const res = lobes.map((lobe, index) => ({
      id: index + 1,
      area: lobe.areaMm2
    }));
    return { table7Data: res, W_max_phys: maxE - minE };
  }, [cycleData, Mr, scales]);

  // 6. 最终计算
  const finalCalc = useMemo(() => {
    const scheme = currentData; // 【修复】使用 currentData
    if(!scheme) return {};

    const omega_m = (2 * Math.PI * scheme.n1) / 60;
    const delta = 1 / scheme.delta;
    const Jf = W_max_phys / (Math.pow(omega_m, 2) * delta);
    const PowerHP = (Mr * scheme.n1) / (9550 * 0.735);

    // 平衡计算
    const q2 = scheme.q2 !== undefined ? scheme.q2 : scheme.Q2;
    const q1 = scheme.q1 !== undefined ? scheme.q1 : scheme.Q1;
    const m2 = q2 / 9.8;
    const m1 = q1 / 9.8;
    const lac = scheme.lac !== undefined ? scheme.lac : scheme.lac_ratio;
    const m2A = m2 * (1 - lac);
    const m_rot = m1 + m2A;
    const r_m = calculateKinematics({ k: scheme.k, h: scheme.h, e: scheme.e }).r / 1000;
    const mr_bal = m_rot * r_m;

    return {
      Jf, omega_m, delta, PowerHP,
      mr_bal, m2A, m_rot, r_m, lac, m1
    };
  }, [W_max_phys, Mr, currentData]); // 依赖项改为 currentData

  // 计算 H
  const scheme = currentData; // 【修复】确保渲染部分也用 currentData
  const sumFi = table6Data.reduce((acc, cur) => acc + cur.area, 0);
  const H_val = sumFi / scales.L_mm;

    return (
        <div className="min-h-screen bg-white p-8 font-serif text-black print:p-0 leading-relaxed">
             <div className="fixed top-4 right-4 z-50 bg-white border shadow p-2 print:hidden text-sm">
                <span className="font-bold mr-2">方案:</span>
                {Object.keys(SCHEMES).map(k => (
                    <button key={k} onClick={()=>setSchemeKey(k)} className={`mx-1 px-2 border ${schemeKey===k?'bg-gray-800 text-white':''}`}>{k}</button>
                ))}
            </div>

            <div className="max-w-[180mm] mx-auto">
                <h2 className="text-xl font-bold mb-4">四、飞轮转动惯量的确定</h2>

                <div className="mb-4 indent-8">
                    （2） 在本课程设计中，决定飞轮的转动惯量时，不考虑机构各构件的质量和转动惯量。
                </div>
                <div className="mb-4 indent-8">
                    （3） 把 <i>M<sub>b</sub></i> = <i>M<sub>b</sub></i>(<i>&phi;</i>) 曲线作为 <i>M<sub>d</sub></i> = <i>M<sub>d</sub></i>(<i>&phi;</i>) 曲线（驱动力矩曲线）
                </div>
                <div className="mb-4 indent-8">
                    规定：当 <i>M<sub>b</sub></i> 与 <i>&omega;<sub>1</sub></i> 的方向一致时为负，画在横坐标的下方。
                    当 <i>M<sub>b</sub></i> 与 <i>&omega;<sub>1</sub></i> 的方向相反时为正，画在横坐标的上方。
                    （在本课程设计中，<i>&omega;<sub>1</sub></i> 的方向为顺时针）
                </div>
                <div className="mb-4 indent-8">
                    （4） 以 <i>M<sub>b</sub></i> 的平均值作为阻抗力矩 <i>M<sub>r</sub></i> （常数）。这是因为在周期性的速度波动中，一个波动周期内的输入功等于输出功。即
                    <span className="mx-2">
                        &Delta;<i>E</i> = &int;<sub>0</sub><sup>4&pi;</sup> (<i>M<sub>d</sub></i> - <i>M<sub>r</sub></i>)d<i>&omega;</i> = 0
                    </span>
                </div>

                <div className="mb-4 indent-8">
                    （a）首先求出下列各单元的面积：
                    {table6Data.map((d, i) => <span key={d.id}> <i>f<sub>{d.id}</sub></i> {i < table6Data.length - 1 ? '、' : ''}</span>)}
                </div>

                <h3 className="text-lg font-bold mb-2">4.1 求出阻抗力矩 <i>M<sub>r</sub></i> 的纵坐标</h3>

                <div className="mb-6">
                    <p className="text-center font-bold text-sm mb-1">表 6 驱动力矩各单元面积</p>
                    <table className="w-full border-t-2 border-b-2 border-black text-center text-sm" style={{borderCollapse: 'collapse'}}>
                        <thead>
                            <tr className="border-b border-black">
                                <th className="py-1">单元</th>
                                {table6Data.map(d => <th key={d.id} className="font-normal"><i>f<sub>{d.id}</sub></i></th>)}
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="py-1">面积 (mm<sup>2</sup>)</td>
                                {table6Data.map(d => <td key={d.id}>{d.area.toFixed(2)}</td>)}
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="mb-4 text-left">
                    求出阻抗力矩（ <i>M<sub>r</sub></i> = <i>M<sub>r</sub></i>(<i>&phi;</i>) ）的纵坐标H(L=4&pi;)：
                </div>
                <div className="mb-4 indent-8 text-[15px]">
                    选取比例尺：
                    <span className="mx-4">
                        <i>&mu;<sub>M</sub></i> = {scales.mu_M.toFixed(2)} (N&middot;m/mm)
                    </span>
                    <span className="mx-4">
                        <i>&mu;<sub>&phi;</sub></i> = {scales.mu_phi_deg} (&deg;/mm)
                    </span>
                </div>
                <div className="flex justify-center items-center my-4">
                    H = <Fraction top={<span>
                        {table6Data.map((d, i) => <span key={d.id}><i>f<sub>{d.id}</sub></i>{i < table6Data.length - 1 ? '+' : ''}</span>)}
                    </span>} bottom="L" />
                    (mm) = {H_val.toFixed(2)}mm
                </div>

                <div className="mb-4 indent-8">
                    （其中
                    {table6Data.map((d, i) => <span key={d.id}> <i>f<sub>{d.id}</sub></i> {i < table6Data.length - 1 ? '，' : ''}</span>)}
                    ...... 表示各单元的面积，单位为 mm<sup>2</sup> ,在横坐标之下为负值，在横坐标之上为正值；H 的单位为毫米，当乘上比例尺 <i>&mu;<sub>M<sub>b</sub></sub></i> 之后，才得出 <i>M<sub>r</sub></i> 之值）
                </div>

                <div className="flex justify-center items-center my-4">
                    <i>M<sub>r</sub></i> = <i>&mu;<sub>m</sub></i> · H = {Mr.toFixed(1)} (N · m)
                </div>

                <div className="mb-4 indent-8">
                    根据求出的 H 值，作出 <i>M<sub>r</sub></i> = <i>M<sub>r</sub></i>(<i>&phi;</i>) 阻抗力矩曲线（现为水平线）。
                </div>

                <h3 className="text-lg font-bold mb-2">4.2 求出最大盈亏功</h3>

                <div className="mb-4 indent-8">
                    （5） 求出下列各单元的面积：
                     {table7Data.map((d, i) => <span key={d.id}> <i>f'<sub>{d.id}</sub></i> {i < table7Data.length - 1 ? '、' : ''}</span>)}
                </div>

                <div className="mb-6">
                    <p className="text-center font-bold text-sm mb-1">表 7 盈亏功各单元面积</p>
                    <table className="w-full border-t-2 border-b-2 border-black text-center text-sm" style={{borderCollapse: 'collapse'}}>
                        <thead>
                            <tr className="border-b border-black">
                                <th className="py-1">单元</th>
                                {table7Data.map(d => <th key={d.id} className="font-normal"><i>f'<sub>{d.id}</sub></i></th>)}
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="py-1">面积 (mm<sup>2</sup>)</td>
                                {table7Data.map(d => <td key={d.id}>{d.area.toFixed(2)}</td>)}
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div className="mb-4 indent-8">
                    在阻抗力矩曲线之上的面积表示盈功，在阻抗力矩曲线之下面积表示亏功。盈功为正，亏功为负值。
                </div>

                <div className="mb-4 indent-8">
                    （6） 根据上面各单元的面积求相应的功
                </div>

                <div className="pl-16 mb-4 space-y-1">
                    {table7Data.map((d, i) => (
                        <div key={d.id}>
                            <i>W<sub>{d.id}</sub></i> = <i>f'<sub>{d.id}</sub></i> · <i>&mu;<sub>M</sub></i> · <i>&mu;<sub>&phi;</sub></i> = {d.area.toFixed(2)} × {scales.mu_M.toFixed(2)} × {scales.mu_phi.toFixed(4)} = {(d.area * scales.mu_M * scales.mu_phi).toFixed(2)}（N·m）
                        </div>
                    ))}
                </div>

                <div className="mb-4 indent-8">
                    （7） 求出在各个位置上功的累积变化量
                </div>
                 <div className="mb-4 indent-8">
                     （8） 求出最大盈亏功 &Delta;<i>W<sub>max</sub></i>
                 </div>
                 <div className="flex justify-center items-center my-4">
                    &Delta;<i>W<sub>max</sub></i> = |<i>W<sub>max</sub></i> - <i>W<sub>min</sub></i>| = {W_max_phys.toFixed(2)} （N·m）
                 </div>

                <h3 className="text-lg font-bold mb-2">4.3 计算等效转动惯量</h3>

                <div className="mb-4 indent-8">
                    (8) 根据许用不均匀系数 [<i>&delta;</i>] ，求出等效构件上所需的等效转动惯量：
                </div>
                <div className="flex justify-center items-center my-4">
                    <i>J<sub>e</sub></i> = <Fraction top={<span>&Delta;<i>W<sub>max</sub></i></span>} bottom={<span><i>&omega;<sub>m</sub></i><sup>2</sup>[<i>&delta;</i>]</span>} /> (kg·m<sup>2</sup>)
                </div>
                <div className="flex justify-center items-center my-4">
                     ( <i>&omega;<sub>m</sub></i> = <Fraction top={<span>2&pi;<i>n<sub>1</sub></i></span>} bottom="60" /> = {finalCalc.omega_m?.toFixed(2)} )
                </div>
                <div className="flex justify-center items-center my-4">
                     <i>J<sub>e</sub></i> = {finalCalc.Jf?.toFixed(2)} (kg·m<sup>2</sup>)
                </div>

                <div className="mb-4 indent-8">
                    （9）确定飞轮的转动惯量：
                </div>
                <div className="flex justify-center items-center my-4">
                     <i>J<sub>F</sub></i> = <i>J<sub>e</sub></i> + <i>J<sub>c</sub></i>
                </div>
                <div className="mb-4 indent-8">
                     按题意：不考虑各构件的质量和转动惯量。
                </div>
                 <div className="mb-4 indent-8">
                     &there4; <i>J<sub>c</sub></i> 可忽略不计
                </div>
                 <div className="mb-4 indent-8">
                     &there4; <i>J<sub>F</sub></i> &asymp; <i>J<sub>e</sub></i> = {finalCalc.Jf?.toFixed(2)}
                </div>


                <h2 className="text-xl font-bold mb-4 mt-8">五、 计算发动机功率</h2>
                <div className="flex justify-center items-center my-4 text-lg">
                    N =
                    <div className="mx-2">
                        <Fraction
                            top={<span><VectorText text={<span>M<sub>r</sub></span>} /> · L · <i>&mu;<sub>M<sub>b</sub></sub></i> · <i>&mu;<sub>&phi;</sub></i></span>}
                            bottom="2"
                        />
                    </div>
                    ×
                    <div className="mx-2">
                        <Fraction top={<span><i>n<sub>1</sub></i></span>} bottom="60" />
                    </div>
                    ×
                    <div className="mx-2">
                        <Fraction top="1" bottom="750" />
                    </div>
                    (HP) = {finalCalc.PowerHP?.toFixed(2)} (HP)
                </div>

                <h2 className="text-xl font-bold mb-4 mt-8">六、 曲柄滑快机构的平衡</h2>
                <div className="mb-4 indent-8">
                    （1） 把连杆的质量代换到 A、B点
                </div>
                <div className="flex justify-center items-center my-4">
                    <div className="flex flex-col items-start border-l-2 border-black pl-2">
                        <div><i>m<sub>2</sub></i> = <i>m<sub>2A</sub></i> + <i>m<sub>2B</sub></i></div>
                        <div><i>m<sub>2A</sub></i> · <i>l<sub>AC<sub>2</sub></sub></i> = <i>m<sub>2B</sub></i>(<i>l<sub>AB</sub></i> - <i>l<sub>AC<sub>2</sub></sub></i>)</div>
                    </div>
                </div>
                <div className="mb-4 indent-8">
                    由上面的方程组可求得：
                </div>
                <div className="flex justify-center items-center my-4 space-x-8">
                     <span><i>m<sub>2B</sub></i> = {scheme.q2 ? (scheme.q2/9.8 - finalCalc.m2A).toFixed(3) : 0}</span> kg
                     <span><i>m<sub>2A</sub></i> = {finalCalc.m2A?.toFixed(3)}</span> kg
                </div>
                <div className="flex justify-center items-center my-4">
                     <div className="flex flex-col items-start border-l-2 border-black pl-2">
                         <div><i>m'<sub>B</sub></i> = <i>m<sub>3</sub></i> + <i>m<sub>2B</sub></i></div>
                         <div><i>m'<sub>A</sub></i> = <i>m<sub>1</sub></i> + <i>m<sub>2A</sub></i></div>
                     </div>
                </div>

                <div className="mb-4 indent-8">
                    （2） 把曲柄 A点的质量用距 O点为 a=0.5r的平衡质量 <i>m<sub>b</sub></i> 平衡。
                </div>
                <div className="flex justify-center items-center my-4">
                    <i>m<sub>b</sub></i> · <i>a</i> = <i>m'<sub>A</sub></i> · <i>r</i>
                </div>
                <div className="flex justify-center items-center my-4">
                     <i>m<sub>b</sub></i> · 0.5<i>r</i> = <i>m'<sub>A</sub></i> · <i>r</i>
                </div>
                 <div className="flex justify-center items-center my-4">
                     &there4; <i>m<sub>b</sub></i> = 2<i>m'<sub>A</sub></i> = {(finalCalc.m_rot * 2).toFixed(3)} kg
                </div>
            </div>
        </div>
    );
};

export default Stage456View;