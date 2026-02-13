import React, { useState, useRef, useMemo } from 'react';
// 修改点 1：删除了不再需要的图标引用 (ChevronRight, ChevronDown, AlignJustify)
import { Image as ImageIcon } from 'lucide-react';

// --- 1. 导出预设方案数据 (保持不变) ---
export const SCHEMES = {
  "I":   { h: 225, d: 170, e: 50, k: 1.04, lac: 0.35, q1: 160, q2: 120, q3: 190, rho: 0.16, n1: 620, delta: 100, cam1: {h:8, e:5, r:55}, cam2: {h:10, e:0, r:60} },
  "II":  { h: 270, d: 220, e: 60, k: 1.05, lac: 0.36, q1: 170, q2: 135, q3: 210, rho: 0.165, n1: 610, delta: 100, cam1: {h:10, e:0, r:60}, cam2: {h:8, e:5, r:55} },
  "III": { h: 320, d: 230, e: 70, k: 1.06, lac: 0.38, q1: 190, q2: 140, q3: 230, rho: 0.17, n1: 590, delta: 80,  cam1: {h:9, e:3, r:55}, cam2: {h:9, e:6, r:55} },
  "IV":  { h: 185, d: 150, e: 55, k: 1.07, lac: 0.40, q1: 120, q2: 110, q3: 180, rho: 0.18, n1: 630, delta: 100, cam1: {h:6, e:0, r:60}, cam2: {h:7, e:0, r:60} },
  "V":   { h: 220, d: 160, e: 68, k: 1.08, lac: 0.35, q1: 135, q2: 125, q3: 200, rho: 0.15, n1: 640, delta: 90,  cam1: {h:7, e:0, r:55}, cam2: {h:6, e:0, r:60} },
  "VI":  { h: 200, d: 180, e: 40, k: 1.035, lac: 0.38, q1: 140, q2: 115, q3: 190, rho: 0.17, n1: 650, delta: 100, cam1: {h:8, e:4, r:60}, cam2: {h:8, e:5, r:60} },
  "VII": { h: 215, d: 170, e: 45, k: 1.04, lac: 0.35, q1: 150, q2: 120, q3: 200, rho: 0.16, n1: 600, delta: 90,  cam1: {h:10, e:0, r:55}, cam2: {h:10, e:7, r:60} },
  "VIII":{ h: 210, d: 160, e: 65, k: 1.08, lac: 0.35, q1: 140, q2: 120, q3: 190, rho: 0.15, n1: 580, delta: 100, cam1: {h:6, e:0, r:55}, cam2: {h:10, e:3, r:55} },
};

// --- 2. 导出核心计算逻辑 (保持不变) ---
export const calculateKinematics = ({ k, h, e }) => {
    // 1. 极位夹角 theta
    const thetaDeg = 180 * (k - 1) / (k + 1);
    const thetaRad = thetaDeg * Math.PI / 180;

    // 2. 辅助圆半径 R = H / (2 * sin(theta))
    const R = h / (2 * Math.sin(thetaRad));

    // 3. 计算 l 和 r
    // CD = R * cos(theta) (圆心到弦的垂直距离)
    const CD = R * Math.cos(thetaRad);

    // OE: O点相对于圆心轴线的水平偏移
    // 修正逻辑：当 K 接近 1 时，辅助圆心 C 和曲柄中心 O 位于行程线同侧。
    // 因此垂直距离为 |CD - e|，而不是 CD + e。
    const verticalDist = Math.abs(CD - e);
    const OE = Math.sqrt(Math.pow(R, 2) - Math.pow(verticalDist, 2));

    // OF = OE + H/2
    const OF = OE + h / 2;

    // 求解 l+r
    const distMax = Math.sqrt(Math.pow(OF, 2) + Math.pow(e, 2));

    // alpha = arcsin(OE / OC)，其中 OC = R
    const alphaRad = Math.asin(OE / R);
    const alphaDeg = alphaRad * 180 / Math.PI;

    // delta = alpha - theta
    const deltaDeg = alphaDeg - thetaDeg;
    const deltaRad = deltaDeg * Math.PI / 180;

    // l-r = 2R * sin(delta / 2)
    const distMin = 2 * R * Math.sin(deltaRad / 2);

    // 解方程组
    const l = (distMax + distMin) / 2;
    const r = (distMax - distMin) / 2;

    return {
      theta: thetaDeg,
      R, CD, OE, OF,
      distMax, // l+r
      distMin, // l-r
      alpha: alphaDeg,
      delta: deltaDeg,
      l,
      r
    };
};

// --- 数学格式组件 (保持不变) ---
const MathFraction = ({ num, den }) => (
  <span className="inline-block align-middle text-center mx-1">
    <span className="block border-b border-black text-[0.9em] px-1 leading-tight mb-[1px]">{num}</span>
    <span className="block text-[0.9em] px-1 leading-tight mt-[1px]">{den}</span>
  </span>
);

const MathSqrt = ({ children }) => (
  <span className="inline-flex items-baseline whitespace-nowrap">
    <span className="text-lg leading-none font-serif">√</span>
    <span className="border-t border-black leading-none self-center px-0.5">{children}</span>
  </span>
);

export default function Stage1View({ onDataChange, onSchemeChange }) {
  const [currentScheme, setCurrentScheme] = useState("VII");

  const [params, setParams] = useState({
    h: 215, d: 170, e: 45, k: 1.04, lAC_ratio: 0.35,
    q1: 150, q2: 120, q3: 200, rho_ratio: 0.16,
    n1: 600, delta_limit_inv: 1100,
    valve_in: -10, valve_out: -32,
    m: 3.5, z1: 36, z2: 14, z3: 72, alpha: 20, ha_star: 1,
    cam1_h: 10, cam1_r0: 55, cam1_e: 0,
    cam2_h: 10, cam2_e: 7, cam2_r0: 60,
  });
  React.useEffect(() => {
    if (onDataChange) {
        onDataChange(params); // 将当前的输入值传出去
    }
  }, [params, onDataChange]);
  // 章节引用 (虽然删除了目录，但保留ref定义以免报错，如果不需要滚动定位也可以删除)
  const refs = {
    abstract: useRef(null),
    one: useRef(null),
    one_1: useRef(null),
    one_1_1: useRef(null),
    one_1_2: useRef(null),
    one_1_3: useRef(null),
    one_1_4: useRef(null),
    one_1_5: useRef(null),
    one_1_6: useRef(null),
    one_1_7: useRef(null),
    one_1_8: useRef(null),
    one_1_9: useRef(null),
    one_1_10: useRef(null),
    one_1_11: useRef(null),
    one_1_12: useRef(null),
    one_1_13: useRef(null),
    one_1_14: useRef(null),
    one_2: useRef(null),
  };

  const handleSchemeChange = (schemeKey) => {
    setCurrentScheme(schemeKey);
    if (onSchemeChange) {
      onSchemeChange(schemeKey);
    }
    if (schemeKey === "Custom") {
      return;
    }
    const data = SCHEMES[schemeKey];

    if (data) {
      setParams(prev => ({
        ...prev,
        h: data.h, d: data.d, e: data.e, k: data.k, lAC_ratio: data.lac,
        q1: data.q1, q2: data.q2, q3: data.q3, rho_ratio: data.rho,
        n1: data.n1, delta_limit_inv: data.delta,
        cam1_h: data.cam1.h, cam1_r0: data.cam1.r, cam1_e: data.cam1.e,
        cam2_h: data.cam2.h, cam2_e: data.cam2.e, cam2_r0: data.cam2.r,
      }));
    }
  };

  const handleChange = (key, value) => {
    setParams(prev => ({ ...prev, [key]: value }));
  };

  // --- 1.2 核心计算逻辑 (使用导出的函数) ---
  const calculationResults = useMemo(() => {
    return calculateKinematics({
        k: params.k,
        h: params.h,
        e: params.e
    });
  }, [params.k, params.h, params.e]);

  return (
    // 修改点 2：移除了 flex, h-screen, overflow-hidden 和 bg-[#f7f9fc]。改为白色背景，允许自然滚动。
    <div className="min-h-screen bg-white p-8 font-sans text-slate-800">

      <main className="w-full">
        <div className="w-full max-w-[210mm] min-h-full mx-auto bg-white shadow-sm border border-slate-200 px-16 py-16 box-border text-slate-900 leading-normal">
          <h1 className="text-[36px] font-bold mb-10 font-sans tracking-tight text-[#1a1a1a] border-b pb-4">四冲程内燃机设计</h1>
          <section ref={refs.abstract} className="mb-12 scroll-mt-8">
            <h2 className="text-[20px] font-bold mb-4 text-[#1a1a1a] bg-slate-50 inline-block px-2 py-1 rounded">摘要</h2>
            <div className="text-[15px] leading-8 text-justify indent-8 font-serif text-[#333] space-y-4">
              <p>
                本文基于本学期所学习的机械原理知识内容，整体把握与运用机构自由度、机构运动与受力分析、机械的平衡、机械的调速、连杆机构、凸轮机构以及齿轮机构等知识来综合解决四冲程内燃机的简单设计与分析问题。
              </p>
              <p>
                将本学期的知识融会贯通利用到课程设计当中，使用作图法与解析法，较为清晰的计算出速度值、加速度值、力值、力矩值以及凸轮轮廓曲线等。得出较好的结果以及完整的设计方案。
              </p>
            </div>
            <p className="text-[14px] font-serif mt-4 text-slate-500">
              <span className="font-bold text-slate-700">关键词：</span>
              图解法；解析法；机械原理；工作冲程
            </p>
          </section>

          {/* 一、基本参数的设置 */}
          <section ref={refs.one} className="scroll-mt-8">
            <h2 className="text-[24px] font-bold mb-8 text-[#1a1a1a] flex items-center">
              <span className="mr-2 text-slate-300"></span>
              一、基本参数的设置
            </h2>

            <div ref={refs.one_1} className="pl-2 scroll-mt-8">
              <h3 className="text-[18px] font-bold mb-6 text-[#1a1a1a]">1.1 初始参数及设计过程</h3>

              <div ref={refs.one_1_1} className="pl-0 mb-10 scroll-mt-8">
                <h4 className="font-bold mb-6 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.1 已知条件</h4>

                {/* --- 核心参数输入区 --- */}
                <div className="space-y-4 text-[16px] font-serif text-[#000] ml-2">

                  <div className="flex items-center whitespace-nowrap h-10 p-2 bg-slate-50 rounded-md -ml-2 mb-4 w-fit">
                    <span className="font-bold mr-3 text-slate-700"></span>
                    <select
                      className="border-b-2 border-blue-600 outline-none bg-transparent font-sans font-bold text-blue-700 pr-2 cursor-pointer hover:bg-blue-50 appearance-none text-center min-w-[140px] transition-colors"
                      value={currentScheme}
                      onChange={(e) => handleSchemeChange(e.target.value)}
                    >
                      {Object.keys(SCHEMES).map(key => (
                        <option key={key} value={key}>{`方案${key}`}</option>
                      ))}
                      <option value="Custom">自定义 (Custom)</option>
                    </select>
                  </div>

                  <WordInputRow label="活塞行程" symbol="H =" val={params.h} unit="(mm)" onChange={(v) => handleChange('h', v)} />
                  <WordInputRow label="活塞直径" symbol="D =" val={params.d} unit="(mm)" onChange={(v) => handleChange('d', v)} />
                  <WordInputRow label="活塞移动导路相对于曲柄中心的距离" symbol="e =" val={params.e} unit="(mm)" onChange={(v) => handleChange('e', v)} />
                  <WordInputRow label="行程速比系数" symbol="K =" val={params.k} unit="" onChange={(v) => handleChange('k', v)} />

                  <div className="flex items-center whitespace-nowrap h-9 hover:bg-slate-50 transition-colors px-2 -ml-2 rounded">
                    <span className="mr-3">连杆重心 C 至 A 点的距离</span>
                    <span className="mr-2 italic font-times">l<sub className="not-italic">AC</sub> =</span>
                    <input className="w-16 text-center border-b border-black outline-none font-serif bg-transparent font-bold" type="number" value={params.lAC_ratio} onChange={(e) => handleChange('lAC_ratio', parseFloat(e.target.value))} />
                    <span className="italic ml-1 font-times">l<sub className="not-italic">AB</sub></span>
                  </div>

                  <WordInputRow label="曲柄重量" symbol="Q₁ =" val={params.q1} unit="(N)" onChange={(v) => handleChange('q1', v)} />
                  <WordInputRow label="连杆重量" symbol="Q₂ =" val={params.q2} unit="(N)" onChange={(v) => handleChange('q2', v)} />
                  <WordInputRow label="活塞重量" symbol="Q₃ =" val={params.q3} unit="(N)" onChange={(v) => handleChange('q3', v)} />

                  <div className="flex items-center whitespace-nowrap h-9 hover:bg-slate-50 transition-colors px-2 -ml-2 rounded">
                    <span className="mr-3">连杆通过质心 C 的转动惯性半径</span>
                    <span className="mr-2 italic font-times">ρ<sup className="not-italic">2</sup><sub className="not-italic">c</sub> =</span>
                    <input className="w-16 text-center border-b border-black outline-none font-serif bg-transparent font-bold" type="number" value={params.rho_ratio} onChange={(e) => handleChange('rho_ratio', parseFloat(e.target.value))} />
                    <span className="italic ml-1 mr-2 font-times">l<sub className="not-italic">AB</sub></span>
                    <span>(mm²)</span>
                  </div>

                  <WordInputRow label="曲柄的转速" symbol="n₁ =" val={params.n1} unit="(rpm)" onChange={(v) => handleChange('n1', v)} />

                  <div className="flex items-center whitespace-nowrap h-9 hover:bg-slate-50 transition-colors px-2 -ml-2 rounded">
                    <span className="mr-3">发动机的许用速度不均匀系数</span>
                    <span className="mr-2 italic font-times">[δ] =</span>
                    <span className="mr-1">1</span>
                    <span>/</span>
                    <input className="w-16 text-center border-b border-black outline-none font-serif bg-transparent ml-1 font-bold" type="number" value={params.delta_limit_inv} onChange={(e) => handleChange('delta_limit_inv', parseFloat(e.target.value))} />
                  </div>

                  <div className="flex items-center whitespace-nowrap h-9 hover:bg-slate-50 transition-colors px-2 -ml-2 rounded">
                    <span className="mr-3">曲柄不平衡的重心到 O 点的距离</span>
                    <span className="mr-2 italic font-times">l<sub className="not-italic">OC</sub> = l<sub className="not-italic">OA</sub></span>
                    <span>(mm)</span>
                  </div>

                  <div className="flex items-center whitespace-nowrap h-9 hover:bg-slate-50 transition-colors px-2 -ml-2 rounded">
                    <span className="mr-3 font-bold text-slate-700">开放提前角：</span>
                    <span className="mr-1">进气门</span>
                    <input className="w-12 text-center border-b border-black outline-none font-serif bg-transparent font-bold" type="number" value={params.valve_in} onChange={(e) => handleChange('valve_in', parseFloat(e.target.value))} />
                    <span className="mr-4">° ；</span>
                    <span className="mr-1">排气门</span>
                    <input className="w-12 text-center border-b border-black outline-none font-serif bg-transparent font-bold" type="number" value={params.valve_out} onChange={(e) => handleChange('valve_out', parseFloat(e.target.value))} />
                    <span>°</span>
                  </div>

                  <div className="flex items-center whitespace-nowrap h-9 hover:bg-slate-50 transition-colors px-2 -ml-2 rounded">
                    <span className="mr-3 font-bold text-slate-700">齿轮参数：</span>
                    <span className="italic mr-1 font-times">m =</span>
                    <input className="w-10 text-center border-b border-black outline-none font-serif bg-transparent font-bold" type="number" value={params.m} onChange={(e) => handleChange('m', parseFloat(e.target.value))} />
                    <span className="mr-3">(mm) ；</span>
                    <span className="italic mr-1 font-times">α =</span>
                    <input className="w-10 text-center border-b border-black outline-none font-serif bg-transparent font-bold" type="number" value={params.alpha} onChange={(e) => handleChange('alpha', parseFloat(e.target.value))} />
                    <span className="mr-3">° ；</span>
                    <span className="italic mr-1 font-times">h*<sub className="not-italic">a</sub> =</span>
                    <input className="w-10 text-center border-b border-black outline-none font-serif bg-transparent font-bold" type="number" value={params.ha_star} onChange={(e) => handleChange('ha_star', parseFloat(e.target.value))} />
                  </div>

                  <div className="flex items-center whitespace-nowrap h-9 hover:bg-slate-50 transition-colors px-2 -ml-2 rounded">
                    <span className="italic mr-1 font-times">Z₂ = Z'₂ =</span>
                    <input className="w-12 text-center border-b border-blue-700 text-blue-900 font-bold outline-none font-serif bg-transparent" type="number" value={params.z2} onChange={(e) => handleChange('z2', parseFloat(e.target.value))} />
                    <span className="mr-5"> ；</span>
                    <span className="italic mr-1 font-times">Z₃ = Z'₃ =</span>
                    <input className="w-12 text-center border-b border-blue-700 text-blue-900 font-bold outline-none font-serif bg-transparent" type="number" value={params.z3} onChange={(e) => handleChange('z3', parseFloat(e.target.value))} />
                    <span className="mr-5"> ；</span>
                    <span className="italic mr-1 font-times">Z₁ =</span>
                    <input className="w-12 text-center border-b border-black outline-none font-serif bg-transparent font-bold" type="number" value={params.z1} readOnly />
                  </div>

                  <div className="h-px bg-slate-200 my-4 w-full"></div>

                  <WordInputRow label="凸轮 I 行程" symbol="h₁ =" val={params.cam1_h} unit="mm" onChange={(v) => handleChange('cam1_h', v)} />
                  <WordInputRow label="凸轮 I 偏心距" symbol="e₁ =" val={params.cam1_e} unit="mm" onChange={(v) => handleChange('cam1_e', v)} />
                  <WordInputRow label="凸轮 I 的基圆半径" symbol="r₁ =" val={params.cam1_r0} unit="mm" onChange={(v) => handleChange('cam1_r0', v)} />

                  <div className="h-2"></div>

                  <WordInputRow label="凸轮 II 行程" symbol="h₂ =" val={params.cam2_h} unit="mm" onChange={(v) => handleChange('cam2_h', v)} />
                  <WordInputRow label="凸轮 II 偏心距" symbol="e₂ =" val={params.cam2_e} unit="mm" onChange={(v) => handleChange('cam2_e', v)} />
                  <WordInputRow label="凸轮 II 的基圆半径" symbol="r₂ =" val={params.cam2_r0} unit="mm" onChange={(v) => handleChange('cam2_r0', v)} />
                </div>
              </div>

              {/* 1.1.2 机构设计 */}
              <div ref={refs.one_1_2} className="pl-0 mb-8 scroll-mt-8 text-[16px] font-serif text-[#000]">
                <h4 className="font-bold mb-4 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.2 机构设计</h4>
                <p className="leading-8 text-justify indent-8 ml-2">
                  按照行程速比系数 <span className="font-times italic">K</span> 及已知尺寸决定机构的主要尺寸，并绘出机构运动简图（4号图纸）。（凸轮要计算出安装角后才画在该图上）
                </p>
              </div>

              {/* 1.1.3 */}
              <div ref={refs.one_1_3} className="pl-0 mb-8 scroll-mt-8 text-[16px] font-serif text-[#000]">
                <h4 className="font-bold mb-4 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.3 选定长度比例尺绘制连杆机构的位置图</h4>
                <p className="leading-8 text-justify indent-8 ml-2">
                  以活塞在最高位置时为起点，将曲柄回转一周按顺时针方向分为十二等分，然后找出活塞在最低位置时和活塞速度为最大时的曲柄位置（即曲柄旋转一周共分十五个位置）并绘制机构各位置时的机构位置图，求出滑块的相对位移。
                </p>
              </div>

              {/* 1.1.4 */}
              <div ref={refs.one_1_4} className="pl-0 mb-8 scroll-mt-8 text-[16px] font-serif text-[#000]">
                <h4 className="font-bold mb-4 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.4 绘制机构15个位置的速度多边形</h4>
                <p className="leading-8 text-justify indent-8 ml-2">
                  求出这15个位置的 <span className="font-times italic">V<sub>BA</sub></span>、<span className="font-times italic">V<sub>C2</sub></span>、<span className="font-times italic">V<sub>B</sub></span>、<span className="font-times italic">ω<sub>2</sub></span> 的数值，并列表表示。（表一）
                </p>
              </div>

              {/* 1.1.5 */}
              <div ref={refs.one_1_5} className="pl-0 mb-8 scroll-mt-8 text-[16px] font-serif text-[#000]">
                <h4 className="font-bold mb-4 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.5 绘制机构的 15个位置的加速度多边形</h4>
                <p className="leading-8 text-justify indent-8 ml-2">
                  求出 15个位置的 <span className="font-times italic">a<sup>n</sup><sub>BA</sub></span>、<span className="font-times italic">a<sup>t</sup><sub>BA</sub></span>、<span className="font-times italic">a<sub>BA</sub></span>、<span className="font-times italic">α<sub>2</sub></span>、<span className="font-times italic">a<sub>C2</sub></span>、<span className="font-times italic">a<sub>b</sub></span> 的数值，并列表表示。（表二）
                </p>
              </div>

              {/* 1.1.6 */}
              <div ref={refs.one_1_6} className="pl-0 mb-8 scroll-mt-8 text-[16px] font-serif text-[#000]">
                <h4 className="font-bold mb-4 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.6 绘制滑块运动曲线</h4>
                <p className="leading-8 text-justify indent-8 ml-2">
                  用直角坐标作滑块B点的位移曲线 <span className="font-times italic">S<sub>B</sub> = S<sub>B</sub>(φ)</span>，速度曲线 <span className="font-times italic">V<sub>B</sub> = V<sub>B</sub>(φ)</span> 及加速度曲线 <span className="font-times italic">a<sub>B</sub> = a<sub>B</sub>(φ)</span>。（把以上 2、3、4、5作在一张 2号图纸上）
                </p>
              </div>

              {/* 1.1.7 */}
              <div ref={refs.one_1_7} className="pl-0 mb-8 scroll-mt-8 text-[16px] font-serif text-[#000]">
                <h4 className="font-bold mb-4 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.7 动态静力分析（1号图纸）</h4>
                <div className="leading-8 text-justify indent-8 ml-2">
                  <p>求出机构在各位置时各运动副的反力及应加于曲柄OA的平衡力 <span className="font-times italic">M<sub>b</sub></span>（每人完成五个位置）各种数据均要列表表示：</p>
                  <div className="pl-4 mt-2 indent-0">
                    <p>（1） 将各个位置的 <span className="font-times italic">P<sub>I2</sub></span>、<span className="font-times italic">M<sub>I2</sub></span>、<span className="font-times italic">P<sub>I3</sub></span> 等数值列于表三。</p>
                    <p>（2） 列出各个位置的 <span className="font-times italic">R<sub>12t</sub></span> 的计算公式，并计算出其数值。</p>
                    <p>（3） 将各个位置的 <span className="font-times italic">P'</span>、<span className="font-times italic">R<sub>12n</sub></span>、<span className="font-times italic">R<sub>12t</sub></span>、<span className="font-times italic">R<sub>12</sub></span>、<span className="font-times italic">R<sub>03</sub></span>、<span className="font-times italic">R<sub>23</sub></span> 等数值列于表四。</p>
                    <p>（4） 将各个位置的 <span className="font-times italic">R<sub>01</sub></span>、<span className="font-times italic">M<sub>b</sub></span> 等数值列于表五。</p>
                  </div>
                </div>
              </div>

              {/* 1.1.8 */}
              <div ref={refs.one_1_8} className="pl-0 mb-8 scroll-mt-8 text-[16px] font-serif text-[#000]">
                <h4 className="font-bold mb-4 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.8 绘制 Mb 曲线</h4>
                <p className="leading-8 text-justify indent-8 ml-2">
                  用直角坐标绘制 <span className="font-times italic">M<sub>b</sub> = M<sub>b</sub>(φ)</span> 曲线。（用方格纸绘制，<span className="font-times italic">M<sub>b</sub></span> 统一用“动态静力分析”所求得的值）。
                </p>
              </div>

              {/* 1.1.9 */}
              <div ref={refs.one_1_9} className="pl-0 mb-8 scroll-mt-8 text-[16px] font-serif text-[#000]">
                <h4 className="font-bold mb-4 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.9 计算飞轮转动惯量</h4>
                <p className="leading-8 text-justify indent-8 ml-2">
                  计算当不考虑机构各构件的质量和转动惯量时的飞轮转动惯量 <span className="font-times italic">J<sub>F</sub></span>。
                </p>
              </div>

              {/* 1.1.10 */}
              <div ref={refs.one_1_10} className="pl-0 mb-8 scroll-mt-8 text-[16px] font-serif text-[#000]">
                <h4 className="font-bold mb-4 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.10 计算发动机功率</h4>
                <p className="leading-8 text-justify indent-8 ml-2">
                  计算发动机功率。
                </p>
              </div>

              {/* 1.1.11 */}
              <div ref={refs.one_1_11} className="pl-0 mb-8 scroll-mt-8 text-[16px] font-serif text-[#000]">
                <h4 className="font-bold mb-4 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.11 机构部分平衡</h4>
                <p className="leading-8 text-justify indent-8 ml-2">
                  对曲柄滑块机构进行机构部分平衡（平衡A点的质量）。
                </p>
              </div>

              {/* 1.1.12 */}
              <div ref={refs.one_1_12} className="pl-0 mb-8 scroll-mt-8 text-[16px] font-serif text-[#000]">
                <h4 className="font-bold mb-4 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.12 凸轮设计</h4>
                <p className="leading-8 text-justify indent-8 ml-2">
                  用图解法设计凸轮Ⅰ和Ⅱ的实际轮廓曲线（4号图纸2张）。
                </p>
              </div>

              {/* 1.1.13 */}
              <div ref={refs.one_1_13} className="pl-0 mb-8 scroll-mt-8 text-[16px] font-serif text-[#000]">
                <h4 className="font-bold mb-4 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.13 工作循环图</h4>
                <p className="leading-8 text-justify indent-8 ml-2">
                  绘制内燃机的工作循环图（4号图纸）。根据工作循环图及曲柄的位置，求出凸轮的安装角，把凸轮画在机构运动简图上。
                </p>
              </div>

              {/* 1.1.14 */}
              <div ref={refs.one_1_14} className="pl-0 mb-8 scroll-mt-8 text-[16px] font-serif text-[#000]">
                <h4 className="font-bold mb-4 text-[16px] text-[#1a1a1a] border-l-4 border-blue-500 pl-3">1.1.14 说明书</h4>
                <p className="leading-8 text-justify indent-8 ml-2">
                  最后将设计过程写成20页左右的详细说明书。
                </p>
              </div>
            </div>
          </section>

          {/* 1.2 连杆与曲柄长度计算 */}
          <section ref={refs.one_2} className="scroll-mt-8">
            <h3 className="text-[18px] font-bold mb-6 text-[#1a1a1a]">1.2 连杆与曲柄长度计算</h3>

            <div className="flex flex-col md:flex-row gap-6">
              {/* 左侧：计算过程 */}
              <div className="flex-1 space-y-4 text-[16px] font-serif text-[#000]">
                <p className="indent-8">
                  设连杆的长度为<i className="font-times">l</i>、曲柄长度为<i className="font-times">r</i>
                </p>

                <p>
                  ∴ <i className="font-times">OB<sub>I</sub> = l - r</i>
                </p>
                <p className="pl-4">
                  <i className="font-times">OB<sub>II</sub> = l + r</i>
                </p>

                <p className="flex items-center">
                  ∵ <i className="font-times mx-2">θ = 180° × </i> <MathFraction num="K-1" den="K+1" /> <i className="font-times mx-2">= {calculationResults.theta.toFixed(2)}°</i> <span className="ml-auto">(1)</span>
                </p>

                <p className="flex items-center">
                  又 ∵ <i className="font-times mx-2">R = CB<sub>I</sub> = </i> <MathFraction num="H" den={<span>2sin<i className="font-times">θ</i></span>} /> <i className="font-times mx-2">= {calculationResults.R.toFixed(2)} mm</i>
                </p>

                <p>
                  <i className="font-times">CD = R</i> cos<i className="font-times">θ = {calculationResults.CD.toFixed(2)} mm</i>
                </p>

                <div className="space-y-1">
                  <p className="flex items-center">
                    <i className="font-times mr-2">OE = </i> <MathSqrt>(OC)² - (CE)²</MathSqrt>
                  </p>
                  <p className="flex items-center pl-8">
                    = <MathSqrt>(OC)² - (CD - DE)²</MathSqrt>
                  </p>
                  <p className="flex items-center pl-8">
                    = <MathSqrt>R² - (CD - e)²</MathSqrt>
                  </p>
                  <p className="pl-8">
                    = <i className="font-times">{calculationResults.OE.toFixed(2)} mm</i>
                  </p>
                </div>

                <p className="flex items-center">
                  <i className="font-times mr-2">OF = OE + </i> <MathFraction num="H" den="2" /> <i className="font-times ml-2">= {calculationResults.OF.toFixed(2)} mm</i>
                </p>

                <p className="flex items-center">
                  <i className="font-times mr-2">l + r = </i> <MathSqrt>(OF)² + e²</MathSqrt> <i className="font-times ml-2">= {calculationResults.distMax.toFixed(2)} mm</i> <span className="ml-auto">(2)</span>
                </p>

                <p className="flex items-center">
                  <i className="font-times mr-2">α = </i> sin<sup>-1</sup><MathFraction num="OE" den="OC" /> <i className="font-times ml-2">= {calculationResults.alpha.toFixed(2)}°</i>
                </p>

                <p>
                  <i className="font-times">δ = α - θ = {calculationResults.delta.toFixed(2)}°</i>
                </p>

                <p className="flex items-center">
                  <i className="font-times mr-2">l - r = 2R</i> sin<MathFraction num="δ" den="2" /> <i className="font-times ml-2">= {calculationResults.distMin.toFixed(2)} mm</i> <span className="ml-auto">(3)</span>
                </p>

                <p className="indent-8 mt-4">
                  联立（2）、（3）式求解，可求出连杆的长度<i className="font-times">l</i>及曲柄的长度<i className="font-times">r</i>。
                </p>

                <p className="font-bold text-[18px] mt-2 flex justify-start gap-12 text-blue-800">
                  <span><i className="font-times">l</i> = {calculationResults.l.toFixed(2)} <i className="font-times">mm</i></span>
                  <span><i className="font-times">r</i> = {calculationResults.r.toFixed(2)} <i className="font-times">mm</i></span>
                </p>
              </div>

              {/* 右侧：图1 */}
              <div className="w-full md:w-[320px] flex-shrink-0 flex flex-col items-center mt-4 md:mt-0">
                <img
                  src="/image_5a96c5.png"
                  alt="图1 曲柄（曲轴）连杆机构设计图"
                  className="max-w-full h-auto mb-2"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.parentNode.innerHTML = '<div class="w-full h-[200px] bg-slate-100 flex flex-col items-center justify-center text-slate-400 border border-slate-300"><span class="text-sm">图1 加载失败</span></div>'
                  }}
                />
                <p className="text-sm text-center text-slate-600 font-serif">图1 曲柄（曲轴）连杆机构设计图</p>
              </div>
            </div>
          </section>

          {/* 页脚装饰 */}
          <div className="mt-20 pt-8 border-t border-slate-100 flex justify-center text-xs text-slate-400 font-sans">
          </div>
        </div>
      </main>

      {/* 修改点 5：删除了 <TocRightSidebar /> 组件的调用 */}

    </div>
  );
}

// --- 组件：Word 风格单行输入 (严格不换行) ---
function WordInputRow({ label, symbol, val, unit, onChange }) {
  return (
    <div className="flex items-center h-9 whitespace-nowrap hover:bg-slate-50 transition-colors px-2 -ml-2 rounded">
      <span className="mr-3">{label}</span>
      <span className="mr-2 italic font-times">{symbol}</span>
      <input
        type="number"
        className="w-16 text-center border-b border-black outline-none bg-transparent font-serif font-bold"
        value={val}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
      <span className="ml-2">{unit}</span>
    </div>
  );
}

// 修改点 6：删除了 TocRightSidebar 和 TocItem 组件的定义