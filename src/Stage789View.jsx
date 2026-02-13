import React, { useState, useMemo, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts';
// 1. 纯净导入
import { SCHEMES, calculateKinematics } from './Stage1View';

// --- 宪法级排版组件 ---
const Italic = ({ children }) => <i className="font-serif font-normal">{children}</i>;
const Sub = ({ children }) => <sub className="text-[0.7em] align-baseline relative -top-1">{children}</sub>;
const Sup = ({ children }) => <sup className="text-[0.7em] align-baseline relative -top-3">{children}</sup>;

// 分式组件
const Fraction = ({ num, den }) => (
  <div className="inline-flex flex-col items-center align-middle mx-1 align-middle" style={{ verticalAlign: 'middle' }}>
    <span className="border-b border-black px-1 pb-[1px] mb-[1px] leading-none text-center block w-full">{num}</span>
    <span className="pt-[1px] leading-none text-center block w-full">{den}</span>
  </div>
);

// 【修改点：接收参数并适配】
export default function Stage789View({ schemeProp, customParams }) {
  const [localScheme, setLocalScheme] = useState('VII');
  const effectiveScheme = schemeProp || localScheme;

  // 准备数据
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
  const currentScheme = effectiveScheme;      // 定义 currentScheme
  const setCurrentScheme = setLocalScheme;    // 定义 setCurrentScheme
  const data = currentData; // 让原来的代码直接用 data 变量

  // --- 1. 核心数据计算 ---
  const kinematics = useMemo(() => calculateKinematics({ k: data.k, h: data.h, e: data.e }), [data]);
  const camParams = useMemo(() => ({
    rise: 60,    // 升程角
    dwell: 10,   // 远休止
    fall: 60,    // 回程角
    cams: [
        { id: 1, name: "凸轮 I (进气)", ...data.cam1, rr: 10 },
        { id: 2, name: "凸轮 II (排气)", ...data.cam2, rr: 10 }
    ]
  }), [data]);

  // 1.3 核心算法：生成凸轮数据点 (含实际廓线计算 - 内包络修正)
  const calculateCamData = useCallback((camConfig) => {
    let points = [];
    const steps = 360;
    const { h, r: rb, e } = camConfig;
    const { rise, dwell, fall } = camParams;
    const rr = 10; // 滚子半径

    // 第一步：计算理论廓线
    for (let deg = 0; deg <= steps; deg++) {
      let s = 0;
      const rad = deg * Math.PI / 180;

      if (deg <= rise) {
        const ratio = deg / rise;
        s = h * (ratio - Math.sin(2 * Math.PI * ratio) / (2 * Math.PI));
      } else if (deg <= rise + dwell) {
        s = h;
      } else if (deg <= rise + dwell + fall) {
        const currentDelta = deg - rise - dwell;
        const ratio = currentDelta / fall;
        s = h * (1 - (ratio - Math.sin(2 * Math.PI * ratio) / (2 * Math.PI)));
      } else {
        s = 0;
      }

      // 理论廓线坐标 (反转法)
      const xTheo = (s + rb) * Math.sin(rad) + e * Math.cos(rad);
      const yTheo = (s + rb) * Math.cos(rad) - e * Math.sin(rad);

      // 偏心圆切点 (用于绘制推杆直线)
      const xTan = e * Math.cos(rad);
      const yTan = -e * Math.sin(rad);

      points.push({ deg, s, xTheo, yTheo, xTan, yTan });
    }

    // 第二步：计算实际廓线 (内包络 - 修正算法)
    for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const pNext = points[i === points.length - 1 ? 0 : i + 1];
        const pPrev = points[i === 0 ? points.length - 1 : i - 1];

        // 切向量
        const dx = pNext.xTheo - pPrev.xTheo;
        const dy = pNext.yTheo - pPrev.yTheo;
        const len = Math.sqrt(dx*dx + dy*dy);

        let xAct = p.xTheo;
        let yAct = p.yTheo;

        if (len > 0) {
            // 法向量分量 (基于坐标系推导，(dy, -dx) 指向内侧)
            const nx = dy / len;
            const ny = -dx / len;

            // 内包络：理论坐标 + 滚子半径 * 向内法向量
            xAct = p.xTheo + rr * nx;
            yAct = p.yTheo + rr * ny;
        }

        points[i].xAct = xAct;
        points[i].yAct = yAct;
    }

    return points;
  }, [camParams]);

  const cam1Data = useMemo(() => calculateCamData(camParams.cams[0]), [calculateCamData, camParams]);
  const cam2Data = useMemo(() => calculateCamData(camParams.cams[1]), [calculateCamData, camParams]);

  const installAngles = useMemo(() => {
      const theta = kinematics.theta;
      // PDF 公式: x0* = (720 - (540 + theta) + 32) / 2
      const x0_star = (720 - (540 + theta) + 32) / 2;
      const y0_star = 130 - x0_star;
      return { x0_star, y0_star, theta };
  }, [kinematics.theta]);

  // --- 2. 绘图渲染组件 ---

  // 渲染凸轮 II (Matlab 风格)
  const renderCam2MatlabStyle = (points, camConfig) => {
      const theoPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.xTheo} ${p.yTheo}`).join(' ') + " Z";
      const actPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.xAct} ${p.yAct}`).join(' ') + " Z";

      return (
          <svg viewBox="-110 -140 220 250" className="w-full h-full bg-[#f0f0f0] border border-gray-400">
             <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="white" strokeWidth="1"/>
             </pattern>
             <rect x="-110" y="-140" width="220" height="250" fill="url(#grid)" />
             <text x="0" y="-130" fontSize="8" textAnchor="middle" fontWeight="bold">凸轮完整轮廓曲线</text>
             <g transform="scale(1, -1)">
                <line x1="-100" y1="0" x2="100" y2="0" stroke="black" strokeWidth="0.5" />
                <line x1="0" y1="-100" x2="0" y2="100" stroke="black" strokeWidth="0.5" />
                <path d={actPath} fill="none" stroke="red" strokeWidth="2" />
                <path d={theoPath} fill="none" stroke="blue" strokeWidth="1.5" />
                <path d="M -3 0 L 3 0 M 0 -3 L 0 3" stroke="black" strokeWidth="1" />
             </g>
             <g transform="translate(60, -135)">
                <rect x="0" y="0" width="45" height="28" fill="white" stroke="black" strokeWidth="0.5" />
                <line x1="5" y1="8" x2="20" y2="8" stroke="blue" strokeWidth="2" />
                <text x="24" y="10" fontSize="6" fontFamily="sans-serif">理论廓线</text>
                <line x1="5" y1="16" x2="20" y2="16" stroke="red" strokeWidth="2" />
                <text x="24" y="18" fontSize="6" fontFamily="sans-serif">实际廓线</text>
                <text x="10" y="26" fontSize="8" fontFamily="sans-serif">+</text>
                <text x="24" y="26" fontSize="6" fontFamily="sans-serif">旋转中心</text>
             </g>
             <text x="80" y="90" fontSize="6">x (mm)</text>
             <text x="5" y="-105" fontSize="6" transform="rotate(-90 5,-105)">y (mm)</text>
          </svg>
      );
  };

  // 渲染凸轮 I (修正版)
  const renderCam1Corrected = (points, camConfig) => {
      const { r, e } = camConfig;
      const rr = 10;
      const rollerPoints = points.filter((p, i) => i % 10 === 0 && p.deg <= 140);
      const theoPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.xTheo} ${p.yTheo}`).join(' ') + " Z";
      const actPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.xAct} ${p.yAct}`).join(' ') + " Z";

      return (
          <div className="flex flex-col w-full h-full items-center">
            <div className="w-full aspect-square border border-gray-300 bg-white relative">
                <svg viewBox="-110 -140 220 250" className="w-full h-full font-serif">
                    <text x="0" y="-130" fontSize="8" textAnchor="middle" fontWeight="bold">凸轮完整轮廓曲线</text>
                    <g transform="scale(1, -1)">
                        <line x1="-100" y1="0" x2="100" y2="0" stroke="black" strokeWidth="0.5" strokeDasharray="4 4"/>
                        <line x1="0" y1="-100" x2="0" y2="100" stroke="black" strokeWidth="0.5" strokeDasharray="4 4"/>
                        <circle cx="0" cy="0" r={r} fill="none" stroke="green" strokeWidth="0.5" strokeDasharray="5 2"/>
                        {e > 0 && (<circle cx="0" cy="0" r={e} fill="none" stroke="purple" strokeWidth="0.8" strokeDasharray="3 3"/>)}
                        <path d={theoPath} fill="none" stroke="blue" strokeWidth="0.8" strokeDasharray="4 2" />
                        {rollerPoints.map((p, i) => (
                            <g key={i}>
                                <circle cx={p.xTheo} cy={p.yTheo} r={rr} fill="none" stroke="#999" strokeWidth="0.3" />
                                <line x1={p.xTheo} y1={p.yTheo} x2={p.xTan} y2={p.yTan} stroke="#ccc" strokeWidth="0.3"/>
                            </g>
                        ))}
                        <path d={actPath} fill="none" stroke="black" strokeWidth="1.5" />
                        <circle cx="0" cy="0" r="1.5" fill="black" />
                        <text x="3" y="3" fontSize="8" transform="scale(1, -1)">O</text>
                        <circle cx={points[0].xTheo} cy={points[0].yTheo} r={rr} fill="none" stroke="red" strokeWidth="1" />
                        <line x1={points[0].xTheo} y1={points[0].yTheo} x2={points[0].xTan} y2={points[0].yTan} stroke="red" strokeWidth="0.8" strokeDasharray="2 2" />
                    </g>
                    <g transform="translate(60, -135)">
                        <rect x="0" y="0" width="45" height="42" fill="white" stroke="black" strokeWidth="0.5" />
                        <line x1="5" y1="6" x2="15" y2="6" stroke="blue" strokeDasharray="4 2" />
                        <text x="18" y="8" fontSize="5">理论廓线</text>
                        <line x1="5" y1="12" x2="15" y2="12" stroke="black" strokeWidth="1.5" />
                        <text x="18" y="14" fontSize="5">实际廓线</text>
                        <circle cx="10" cy="18" r="2" stroke="#999" fill="none"/>
                        <text x="18" y="20" fontSize="5">滚子示意</text>
                        <line x1="5" y1="24" x2="15" y2="24" stroke="green" strokeDasharray="5 2" />
                        <text x="18" y="26" fontSize="5">基圆</text>
                        {e > 0 && <><line x1="5" y1="30" x2="15" y2="30" stroke="purple" strokeDasharray="3 3" /><text x="18" y="32" fontSize="5">偏心圆</text></>}
                        <text x="18" y="38" fontSize="5">r<tspan baselineShift="sub">r</tspan>=10mm</text>
                    </g>
                    <text x="70" y="100" fontSize="6">μ<tspan dy="2" fontSize="4">L</tspan><tspan dy="-2">=0.001 m/mm</tspan></text>
                </svg>
            </div>
            <div className="w-full h-64 border border-gray-300 bg-[#f0f0f0] mt-0 relative z-10" style={{marginTop: '-2px'}}>
                 <div className="h-full w-full relative">
                    <p className="text-center text-xs font-sans absolute top-1 w-full z-10">推杆位移曲线</p>
                    <ResponsiveContainer width="100%" height={250}>
                        <LineChart data={points.filter(d => d.deg <= 130)} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="white" />
                            <XAxis dataKey="deg" type="number" domain={[0, 130]} tickCount={7} label={{ value: '凸轮转角 (°)', position: 'insideBottom', offset: -10, fontSize: 12 }} tick={{fontSize:10}} height={50} />
                            <YAxis domain={[0, 'auto']} label={{ value: '位移 (mm)', angle: -90, position: 'insideLeft', fontSize: 12 }} tick={{fontSize:10}} />
                            <Line type="monotone" dataKey="s" stroke="#0072bd" strokeWidth={2} dot={false} />
                        </LineChart>
                    </ResponsiveContainer>
                 </div>
            </div>
            <p className="text-center font-bold text-[15px] font-serif mt-2">图 17 凸轮Ⅰ轮廓曲线与推杆位移图</p>
          </div>
      );
  };

  // --- 图 18 工作循环图 重绘逻辑 ---
  const renderWorkingCycle = () => {
    // 1. 获取核心数据
    const { theta, l, r } = kinematics;
    const e_mech = data.e;
    const { x0_star, y0_star } = installAngles;

    // 2. 布局常量
    const ChartWidth = 400; // 长方形宽度
    const ChartHeight = 60; // 长方形高度
    const Gap = 115; // 间距加长 (1.5倍)
    const StartX = 50; // 左边距
    const SvgHeight = 850; // SVG 总高度增加以容纳大间距

    // 垂直居中计算
    const TotalChartGroupHeight = 3 * ChartHeight + 2 * Gap; // 180 + 230 = 410
    const StartY = (SvgHeight - TotalChartGroupHeight) / 2; // (850 - 410)/2 = 220

    // 机构简图位置：O 点位于页面下方 1/3 处 (从底部算起? 通常指整图高度的 2/3 处)
    // "O点位于页面下方1/3处" -> Y ≈ 2/3 * Height
    const MechCenterY = SvgHeight * (2/3); // 约 566
    const MechCenterX = 700; // 机构中心X

    const drawScale = 0.6; // 机构缩放
    const r_svg = r * drawScale;
    const l_svg = l * drawScale;
    const e_svg = e_mech * drawScale;

    // 3. 角度转换函数
    // 图1和图3: 360度 = ChartWidth
    const pxPerDeg360 = ChartWidth / 360;
    // 图2: 720度 = ChartWidth
    const pxPerDeg720 = ChartWidth / 720;

    // 4. 关键位置计算
    // 55度线位置 (贯穿线)
    // 物理X坐标: StartX + 55 * pxPerDeg720
    const LineX = StartX + 55 * pxPerDeg720;

    // 图1 (排气) 参数
    // 左右两侧为开启(Open)，中间为关闭(Closed)。
    // 开启总角 130度 (升+休+降)。 关闭总角 230度。
    // 左侧开启宽度: y0* (25.76)
    // 右侧开启宽度: x0* (104.24)
    // 中间关闭宽度: 360 - 130 = 230.
    const x_y0 = StartX + y0_star * pxPerDeg360; // 左侧白块结束
    const x_x0_start = StartX + (360 - x0_star) * pxPerDeg360; // 右侧白块开始

    // 图2 (主循环) 参数
    const ang_intake = 180 + theta;
    const ang_comp = 360;
    const ang_exp = 540 + theta;
    const ang_exhaust = 720;

    const x_intake_end = StartX + ang_intake * pxPerDeg720;
    const x_comp_end = StartX + ang_comp * pxPerDeg720;
    const x_exp_end = StartX + ang_exp * pxPerDeg720;
    const x_exhaust_end = StartX + ang_exhaust * pxPerDeg720;

    // 32度标注: 从 x0* 左边界 (Rect 1右白块开始处) 到 排气区间左边界 (Rect 2排气开始处)
    // 注意: Rect 1 x_x0_start 对应 256度 (360-104). Rect 2 x_exp_end 对应 540+theta.
    // 这里的32度是物理意义上的关联.
    // 标注线画在 x_exp_end (排气开始) 和 x_x0_start (排气门开启点? 不, x0*是安装角)
    // 实际上 x_x0_start 对应的是 排气门开启时刻.
    // 我们只需在 Gap 1 中连接这两个 x 坐标即可.

    // 图3 (进气) 参数
    // 左侧白块(125), 右侧白块(5). 中间关闭(Hatched).
    const x_in_left_end = StartX + 125 * pxPerDeg360; // 左侧白块结束
    const x_in_right_start = StartX + (360 - 5) * pxPerDeg360; // 右侧白块开始

    // 5. 机构运动简图计算 (55度位置 - 实线)
    const angle55 = 55 * Math.PI / 180;
    const Ax = MechCenterX + r_svg * Math.sin(angle55);
    const Ay = MechCenterY - r_svg * Math.cos(angle55);
    // 滑块B (偏心圆)
    const Bx = MechCenterX + e_svg;
    const distY = Math.sqrt(l_svg*l_svg - (Bx - Ax)**2);
    const By = Ay - distY;

    // 初始位置 (0度 - 虚线)
    const Ax0 = MechCenterX;
    const Ay0 = MechCenterY - r_svg;
    const Bx0 = MechCenterX + e_svg;
    const distY0 = Math.sqrt(l_svg*l_svg - (Bx0 - Ax0)**2);
    const By0 = Ay0 - distY0;

    return (
        <div className="border border-black p-2 bg-white mb-2 overflow-x-auto">
            <svg viewBox="0 0 900 850" className="w-[900px] h-auto mx-auto font-sans">
                <defs>
                    <pattern id="hatchLines" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                        <line x1="0" y1="0" x2="0" y2="8" style={{stroke:'black', strokeWidth:1}} />
                    </pattern>
                    <pattern id="hatchLinesRev" width="8" height="8" patternTransform="rotate(-45 0 0)" patternUnits="userSpaceOnUse">
                        <line x1="0" y1="0" x2="0" y2="8" style={{stroke:'black', strokeWidth:1}} />
                    </pattern>
                    <pattern id="hatchVertical" width="4" height="4" patternUnits="userSpaceOnUse">
                         <line x1="0" y1="0" x2="0" y2="4" style={{stroke:'black', strokeWidth:1}} />
                    </pattern>
                </defs>

                {/* M_L 比例尺 (最右上角) */}
                <text x="880" y="30" fontSize="14" textAnchor="end">M<tspan baselineShift="sub">L</tspan> = 5mm/mm</text>

                {/* ================= 左侧：三个长方形图表 ================= */}
                <g>
                    {/* --- 图1: 排气门 (凸轮II) --- */}
                    <g transform={`translate(0, ${StartY})`}>
                        {/* 边框 */}
                        <rect x={StartX} y="0" width={ChartWidth} height={ChartHeight} stroke="black" fill="none" />

                        {/* 左侧 (开启 y0*) - 白色 */}
                        <rect x={StartX} y="0" width={x_y0 - StartX} height={ChartHeight} fill="white" stroke="black" />
                        {/* 标注 y0* (无箭头, 居中) */}
                        <line x1={x_y0} y1={0} x2={x_y0} y2={-10} stroke="black" />
                        <line x1={StartX} y1={-10} x2={x_y0} y2={-10} stroke="black" />
                        <text x={(StartX + x_y0)/2} y={-15} fontSize="10" textAnchor="middle">{y0_star.toFixed(2)}°</text>

                        {/* 中间 (关闭) - 剖面线 */}
                        <rect x={x_y0} y="0" width={x_x0_start - x_y0} height={ChartHeight} fill="url(#hatchLines)" stroke="black" />
                        <text x={(x_y0 + x_x0_start)/2} y={35} textAnchor="middle" fontSize="16" letterSpacing="2">排气门关闭</text>

                         {/* 右侧 (开启 x0*) - 白色 */}
                        <rect x={x_x0_start} y="0" width={StartX + ChartWidth - x_x0_start} height={ChartHeight} fill="white" stroke="black" />
                        {/* 标注 x0* (无箭头, 居中) */}
                        <line x1={x_x0_start} y1={0} x2={x_x0_start} y2={-10} stroke="black" />
                        <line x1={x_x0_start} y1={-10} x2={StartX + ChartWidth} y2={-10} stroke="black" />
                        <text x={(x_x0_start + StartX + ChartWidth)/2} y={-15} fontSize="10" textAnchor="middle">{x0_star.toFixed(2)}°</text>

                        {/* 标题 */}
                        <text x={StartX + ChartWidth/2} y={ChartHeight + 20} textAnchor="middle" fontSize="14">排气门 (凸轮Ⅱ)</text>

                        {/* 0° / 360° */}
                        <text x={StartX - 5} y={10} textAnchor="end" fontSize="12">0°</text>
                        <text x={StartX + ChartWidth + 5} y={10} fontSize="12">360°</text>

                         {/* 27.5度标注 (在长方形下方, 贴下边界) */}
                         <text x={LineX + 5} y={ChartHeight + 15} fontSize="10">27.5°</text>
                    </g>

                    {/* --- 图2: 主要运动机构 --- */}
                    <g transform={`translate(0, ${StartY + ChartHeight + Gap})`}>
                         <rect x={StartX} y="0" width={ChartWidth} height={ChartHeight} stroke="black" fill="none" />

                         {/* 进气 (斜线) */}
                         <rect x={StartX} y="0" width={x_intake_end - StartX} height={ChartHeight} fill="url(#hatchLines)" opacity="0.1" />
                         <line x1={x_intake_end} y1={0} x2={x_intake_end} y2={ChartHeight} stroke="black" />
                         <text x={(StartX + x_intake_end)/2} y={35} textAnchor="middle" fontSize="14">进气</text>
                         <text x={x_intake_end} y={ChartHeight + 15} textAnchor="middle" fontSize="10">{ang_intake.toFixed(1)}°</text>

                         {/* 压缩 (斜线) */}
                         <rect x={x_intake_end} y="0" width={x_comp_end - x_intake_end} height={ChartHeight} fill="url(#hatchLines)" opacity="0.1" />
                         <line x1={x_comp_end} y1={0} x2={x_comp_end} y2={ChartHeight} stroke="black" />
                         <text x={(x_intake_end + x_comp_end)/2} y={35} textAnchor="middle" fontSize="14">压缩</text>
                         <text x={x_comp_end} y={ChartHeight + 15} textAnchor="middle" fontSize="10">360.0°</text>

                         {/* 膨胀 (垂直线) */}
                         <rect x={x_comp_end} y="0" width={x_exp_end - x_comp_end} height={ChartHeight} fill="url(#hatchVertical)" opacity="0.1" />
                         <line x1={x_exp_end} y1={0} x2={x_exp_end} y2={ChartHeight} stroke="black" />
                         <text x={(x_comp_end + x_exp_end)/2} y={35} textAnchor="middle" fontSize="14">膨胀</text>
                         <text x={x_exp_end} y={ChartHeight + 15} textAnchor="middle" fontSize="10">{ang_exp.toFixed(1)}°</text>

                         {/* 排气 (反向斜线) */}
                         <rect x={x_exp_end} y="0" width={x_exhaust_end - x_exp_end} height={ChartHeight} fill="url(#hatchLinesRev)" opacity="0.1" />
                         <text x={(x_exp_end + x_exhaust_end)/2} y={35} textAnchor="middle" fontSize="14">排气</text>

                         {/* 标题 */}
                         <text x={StartX + ChartWidth/2} y={ChartHeight + 35} textAnchor="middle" fontSize="14">主要运动机构 (以曲柄为定标构件)</text>

                         {/* 0° / 720° */}
                        <text x={StartX - 5} y={10} textAnchor="end" fontSize="12">0°</text>
                        <text x={StartX + ChartWidth + 5} y={10} fontSize="12">720°</text>

                        {/* 10度线标注 (从下边界引出, 向左延伸) */}
                        <line x1={StartX + ChartWidth} y1={ChartHeight} x2={StartX + ChartWidth} y2={ChartHeight + 15} stroke="black" />
                        {/* 10度宽度 = 10 * pxPerDeg720 */}
                        <line x1={StartX + ChartWidth - 10*pxPerDeg720} y1={ChartHeight} x2={StartX + ChartWidth - 10*pxPerDeg720} y2={ChartHeight + 15} stroke="black" />
                        <line x1={StartX + ChartWidth} y1={ChartHeight + 10} x2={StartX + ChartWidth - 10*pxPerDeg720} y2={ChartHeight + 10} stroke="black" />
                        <text x={StartX + ChartWidth + 5} y={ChartHeight + 15} fontSize="10">10°</text>

                        {/* 55度标注 (在长方形上方, 贴上边界) */}
                        <text x={LineX + 5} y="-5" fontSize="10">55°</text>
                    </g>

                    {/* --- Gap 1 (Rect 1 & 2 之间) 标注 --- */}
                    <g>
                        {/* 32度标注: 连接 x0* 左界 (Rect 1) 和 排气左界 (Rect 2) */}
                        {/* 线画在中间空白处 */}
                        <line x1={x_x0_start} y1={StartY + ChartHeight} x2={x_x0_start} y2={StartY + ChartHeight + Gap/2} stroke="black" strokeWidth="0.5" />
                        <line x1={x_exp_end} y1={StartY + ChartHeight + Gap} x2={x_exp_end} y2={StartY + ChartHeight + Gap/2} stroke="black" strokeWidth="0.5" />
                        <line x1={x_x0_start} y1={StartY + ChartHeight + Gap/2} x2={x_exp_end} y2={StartY + ChartHeight + Gap/2} stroke="black" />
                        <text x={(x_x0_start + x_exp_end)/2} y={StartY + ChartHeight + Gap/2 - 5} fontSize="10" textAnchor="middle">32°</text>
                    </g>

                    {/* --- 图3: 进气门 (凸轮I) --- */}
                    <g transform={`translate(0, ${StartY + (ChartHeight + Gap) * 2})`}>
                        {/* 边框 */}
                        <rect x={StartX} y="0" width={ChartWidth} height={ChartHeight} stroke="black" fill="none" />

                        {/* 左侧 (开启 125) - 白色 */}
                        <rect x={StartX} y="0" width={x_in_left_end - StartX} height={ChartHeight} fill="white" stroke="black" />
                        {/* 标注 125度 (左边, 无箭头) */}
                        <line x1={x_in_left_end} y1={ChartHeight} x2={x_in_left_end} y2={ChartHeight + 10} stroke="black" />
                        <line x1={StartX} y1={ChartHeight + 10} x2={x_in_left_end} y2={ChartHeight + 10} stroke="black" />
                        <text x={(StartX + x_in_left_end)/2} y={ChartHeight + 25} textAnchor="middle" fontSize="10">125°</text>

                        {/* 中间 (关闭) - 剖面线 */}
                        <rect x={x_in_left_end} y="0" width={x_in_right_start - x_in_left_end} height={ChartHeight} fill="url(#hatchLinesRev)" stroke="black" />
                        <text x={(x_in_left_end + x_in_right_start)/2} y={35} textAnchor="middle" fontSize="16" letterSpacing="2">进气门关闭</text>

                        {/* 右侧 (开启 5) - 白色 */}
                        <rect x={x_in_right_start} y="0" width={StartX + ChartWidth - x_in_right_start} height={ChartHeight} fill="white" stroke="black" />
                        {/* 标注 5度 (右边, 无箭头) */}
                        <line x1={x_in_right_start} y1={ChartHeight} x2={x_in_right_start} y2={ChartHeight + 10} stroke="black" />
                        <line x1={x_in_right_start} y1={ChartHeight + 10} x2={StartX + ChartWidth} y2={ChartHeight + 10} stroke="black" />
                        <text x={(x_in_right_start + StartX + ChartWidth)/2} y={ChartHeight + 25} textAnchor="middle" fontSize="10">5°</text>

                         {/* 标题 */}
                         <text x={StartX + ChartWidth/2} y={ChartHeight + 20} textAnchor="middle" fontSize="14">(进气门 凸轮Ⅰ)</text>

                        {/* 0° / 360° */}
                        <text x={StartX - 5} y={10} textAnchor="end" fontSize="12">0°</text>
                        <text x={StartX + ChartWidth + 5} y={10} fontSize="12">360°</text>

                        {/* 27.5度标注 (在长方形上方, 贴上边界) */}
                        <text x={LineX + 5} y="-5" fontSize="10">27.5°</text>
                    </g>

                    {/* --- 贯穿实线 (27.5° / 55°) --- */}
                    {/* 连接三个长方形右边界的竖线 */}
                    <line x1={StartX + ChartWidth} y1={StartY - 20} x2={StartX + ChartWidth} y2={StartY + (ChartHeight + Gap) * 2 + ChartHeight + 20} stroke="black" strokeWidth="1" />

                    {/* 贯穿实线 27.5/55 */}
                    <line x1={LineX} y1={StartY - 20} x2={LineX} y2={StartY + (ChartHeight + Gap) * 2 + ChartHeight + 20} stroke="black" strokeWidth="1.5" />
                </g>


                {/* ================= 右侧：机构运动简图 ================= */}
                <g>
                    {/* 虚线十字中心线 */}
                    <line x1={MechCenterX} y1={MechCenterY - 150} x2={MechCenterX} y2={MechCenterY + 120} stroke="black" strokeDasharray="10 5" strokeWidth="0.5" />
                    <line x1={MechCenterX - 100} y1={MechCenterY} x2={MechCenterX + 100} y2={MechCenterY} stroke="black" strokeDasharray="10 5" strokeWidth="0.5" />

                    {/* 曲柄轨迹圆 (虚线) */}
                    <circle cx={MechCenterX} cy={MechCenterY} r={r_svg} fill="none" stroke="black" strokeDasharray="5 5" />

                    {/* 初始位置 (0° 虚线) */}
                    <g opacity="0.6">
                         {/* 滑块 */}
                         <rect x={Bx0 - 10} y={By0 - 15} width={20} height={30} fill="none" stroke="black" strokeDasharray="3 2" />
                         <circle cx={Bx0} cy={By0} r={2} fill="white" stroke="black" />
                         {/* 连杆 */}
                         <line x1={Bx0} y1={By0} x2={Ax0} y2={Ay0} stroke="black" strokeDasharray="3 2" />
                         {/* 曲柄 */}
                         <line x1={MechCenterX} y1={MechCenterY} x2={Ax0} y2={Ay0} stroke="black" strokeDasharray="3 2" />
                         <text x={Ax0 + 5} y={Ay0} fontSize="12">A₀</text>
                    </g>

                    {/* 当前位置 (55° 实线) */}
                    <g>
                         {/* 滑块 */}
                         <rect x={Bx - 10} y={By - 15} width={20} height={30} fill="white" stroke="black" strokeWidth="1.5" />
                         <circle cx={Bx} cy={By} r={2} fill="white" stroke="black" />
                         {/* 连杆 */}
                         <line x1={Bx} y1={By} x2={Ax} y2={Ay} stroke="black" strokeWidth="1.5" />
                         {/* 曲柄 */}
                         <line x1={MechCenterX} y1={MechCenterY} x2={Ax} y2={Ay} stroke="black" strokeWidth="2" />
                         <circle cx={Ax} cy={Ay} r={3} fill="white" stroke="black" />

                         {/* 标注 A, O */}
                         <text x={Ax + 10} y={Ay} fontSize="14" fontWeight="bold">A</text>
                         <text x={MechCenterX - 15} y={MechCenterY + 15} fontSize="14">O</text>

                         {/* 标注 55度 (无箭头) */}
                         <path d={`M ${MechCenterX} ${MechCenterY - 30} A 30 30 0 0 1 ${MechCenterX + 30*Math.sin(angle55)} ${MechCenterY - 30*Math.cos(angle55)}`} fill="none" stroke="black" />
                         <text x={MechCenterX + 10} y={MechCenterY - 35} fontSize="12">55°</text>

                         {/* 旋转箭头 w */}
                         <path d={`M ${MechCenterX + r_svg + 20} ${MechCenterY} A ${r_svg+20} ${r_svg+20} 0 0 1 ${MechCenterX + (r_svg+20)*Math.cos(0.5)} ${MechCenterY + (r_svg+20)*Math.sin(0.5)}`} fill="none" stroke="black" />
                         <text x={MechCenterX + r_svg + 30} y={MechCenterY + 20} fontSize="14">ω</text>
                    </g>
                </g>
            </svg>
        </div>
    );
  };

  return (
    <div className="min-h-screen bg-white p-8 font-sans text-slate-800">
      <main className="flex-1 overflow-y-auto scroll-smooth">
        <div className="w-full max-w-[210mm] mx-auto bg-white border border-gray-200 shadow-lg px-16 py-16 box-border text-slate-900 leading-normal">

          {/* 方案选择 */}
          <div className="mb-8 flex items-center bg-slate-50 p-2 rounded border border-slate-200 print:hidden">
            <span className="font-bold mr-4 text-sm">Design Scheme:</span>
            <select
              value={currentScheme}
              onChange={(e) => setCurrentScheme(e.target.value)}
              className="bg-white border border-slate-300 text-sm rounded px-2 py-1"
            >
               {Object.keys(SCHEMES).map(key => <option key={key} value={key}>方案 {key}</option>)}
            </select>
          </div>

          {/* ==================== 七、凸轮的设计 ==================== */}
          <section className="mb-12">
            <h2 className="text-[24px] font-bold mb-6 text-[#1a1a1a] border-b-2 border-black pb-2">
              七、凸轮的设计
            </h2>

            <h3 className="text-[18px] font-bold mb-4">7.1 凸轮的设计要求</h3>
            <div className="text-[15px] font-serif leading-7 mb-6">
              <p>（1）升程角为 60 度，回程角为 60 度，远休止止角为 10 度。</p>
              <p>（2）选择升程和回程的运动规律。</p>
              <p>（3）用图解法设计凸轮的轮廓曲线并画出 <Italic>s</Italic> - <Italic>δ</Italic> 曲线以及凸轮的轮廓曲线。</p>
            </div>

            <h3 className="text-[18px] font-bold mb-4">7.2 推杆运动规律的选择</h3>
            <div className="text-[15px] font-serif leading-7 mb-6 text-justify">
              <p className="indent-8">
                凸轮推杆的运动规律不同，其对凸轮产生的冲击也不一样，为减少凸轮在运作过程中的损耗，选用正弦加速度运动规律，以消除刚性冲击和柔性冲击（正弦运动规律无刚性也无柔性冲击）。凸轮在运动一周的过程中，推杆的运动一般可分为：推程、远休止、回程和近休止四个阶段。
              </p>

              <div className="pl-4 mt-2">
                <p>推程时：</p>
                <div className="pl-8 my-2 font-serif text-sm bg-gray-50 p-2">
                    <Italic>s</Italic> = <Italic>h</Italic> [ (<Italic>δ</Italic> / <Italic>δ</Italic><Sub>0</Sub>) - (1 / 2π) sin(2π<Italic>δ</Italic> / <Italic>δ</Italic><Sub>0</Sub>) ]
                    <span className="float-right mr-10">0 ~ 60° (7-1)</span>
                </div>
                <p>回程时：</p>
                <div className="pl-8 my-2 font-serif text-sm bg-gray-50 p-2">
                    <Italic>s</Italic> = <Italic>h</Italic> [ 1 - (<Italic>δ'</Italic> / <Italic>δ'</Italic><Sub>0</Sub>) + (1 / 2π) sin(2π<Italic>δ'</Italic> / <Italic>δ'</Italic><Sub>0</Sub>) ]
                    <span className="float-right mr-10">70 ~ 130° (7-2)</span>
                </div>
              </div>

              <p className="mt-4 indent-8">
                s 为推杆位移，h 为推杆行程，δ 为凸轮的转角。
              </p>
              <p className="indent-8">
                从动件运行规律：正弦加速度运动规律，由于加速度线图无突变，故无冲击，适用于速度较高的场合。
              </p>
              <p className="indent-8">
                从动件运动形式为：升—停—降—停型
              </p>
              <p className="indent-8">
                凸轮运动规律如下:
              </p>
            </div>

            {/* 表 8 */}
            <p className="text-center font-bold text-[15px] font-serif mb-2">表 8 凸轮运动规律</p>
            <table className="w-full border-collapse border-t-2 border-b-2 border-black font-serif text-[15px] text-center mb-8">
                <thead>
                    <tr className="border-b border-black">
                        <th className="py-2 font-normal">推程（升）<Italic>δ</Italic><Sub>1</Sub></th>
                        <th className="py-2 font-normal">远休止 <Italic>δ</Italic><Sub>2</Sub></th>
                        <th className="py-2 font-normal">回程（降）<Italic>δ</Italic><Sub>3</Sub></th>
                        <th className="py-2 font-normal">近休止 <Italic>δ</Italic><Sub>4</Sub></th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td className="py-4 px-2 align-middle text-sm">
                            <Italic>s</Italic> = <Italic>h</Italic> [ (<Italic>δ</Italic>/<Italic>δ</Italic><Sub>0</Sub>) - <br/>
                            sin(2π<Italic>δ</Italic>/<Italic>δ</Italic><Sub>0</Sub>)/(2π) ]
                        </td>
                        <td className="py-4 align-middle"><Italic>s</Italic><Sub>2</Sub> = <Italic>h</Italic></td>
                        <td className="py-4 px-2 align-middle text-sm">
                            <Italic>s</Italic> = <Italic>h</Italic> [ 1 - (<Italic>δ'</Italic>/<Italic>δ'</Italic><Sub>0</Sub>) + <br/>
                            sin(2π<Italic>δ'</Italic>/<Italic>δ'</Italic><Sub>0</Sub>)/(2π) ]
                        </td>
                        <td className="py-4 align-middle"><Italic>s</Italic><Sub>4</Sub> = 0</td>
                    </tr>
                </tbody>
            </table>

            <p className="text-[15px] font-serif leading-7 mb-6 indent-8">
               其中，凸轮 I 使用 Matlab 代码完成设计。凸轮 II 采用图解法手工完成。代码见附录。
            </p>

            {/* 表 9 */}
            <p className="text-center font-bold text-[15px] font-serif mb-2">表 9 凸轮运动表</p>
            <table className="w-full border-collapse border-t-2 border-b-2 border-black font-serif text-[15px] text-center mb-8">
                <thead>
                    <tr className="border-b border-black">
                        <th className="py-1 font-normal"><Italic>φ</Italic>/°</th>
                        <th className="py-1 font-normal"><Italic>S</Italic><Sub>1</Sub></th>
                        <th className="py-1 font-normal"><Italic>S</Italic><Sub>2</Sub></th>
                    </tr>
                </thead>
                <tbody>
                    {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130].map(d => {
                        const row1 = cam1Data.find(p => p.deg === d) || {s:0};
                        const row2 = cam2Data.find(p => p.deg === d) || {s:0};
                        return (
                            <tr key={d}>
                                <td className="py-1">{d}</td>
                                <td className="py-1">{row1.s.toFixed(2).replace(/[.,]00$/, "")}</td>
                                <td className="py-1">{row2.s.toFixed(2).replace(/[.,]00$/, "")}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>

            <div className="text-[15px] font-serif leading-7 mb-6 indent-8">
              <p>
                在本次课程设计中，为培养计算机作图能力以及解析法的理解，凸轮Ⅰ轮廓曲线图我们采取计算机作图的方式（本次编程环境选择 Matlab，具体代码见于附件），凸轮Ⅱ轮廓曲线图我们采取图解法。
              </p>
            </div>

            {/* 图15, 16 (凸轮 II - Matlab 风格) */}
            <div className="flex flex-col items-center space-y-6 mt-4 page-break-inside-avoid">
                 <div className="w-[70%] aspect-square border border-gray-300 p-1">
                    {renderCam2MatlabStyle(cam2Data, camParams.cams[1])}
                 </div>
                 <p className="text-center font-bold text-[15px] font-serif">图 15 凸轮Ⅱ轮廓曲线图 </p>

                 <div className="w-[70%] h-64 border border-gray-300 p-1 bg-[#f0f0f0]">
                     <div className="h-full w-full relative">
                        <p className="text-center text-xs font-sans absolute top-1 w-full z-10">推杆位移曲线</p>
                        <ResponsiveContainer width="100%" height={250}>
                            <LineChart data={cam2Data.filter(d => d.deg <= 130)} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="white" />
                                <XAxis
                                    dataKey="deg"
                                    type="number"
                                    domain={[0, 130]}
                                    tickCount={7}
                                    label={{ value: '凸轮转角 (°)', position: 'insideBottom', offset: -10, fontSize: 12 }}
                                    tick={{fontSize:10}}
                                    height={50}
                                />
                                <YAxis
                                    domain={[0, 'auto']}
                                    label={{ value: '位移 (mm)', angle: -90, position: 'insideLeft', fontSize: 12 }}
                                    tick={{fontSize:10}}
                                />
                                <Line type="monotone" dataKey="s" stroke="#0072bd" strokeWidth={2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                     </div>
                 </div>
                 <p className="text-center font-bold text-[15px] font-serif">图 16 凸轮Ⅱ推杆位移曲线图 </p>
            </div>

             {/* 图 17 (凸轮 I - 修正后) */}
             <div className="flex flex-col items-center space-y-4 mt-12 page-break-inside-avoid">
                 <div className="w-[85%] border-2 border-black bg-white p-2 relative shadow-lg">
                    {renderCam1Corrected(cam1Data, camParams.cams[0])}
                 </div>
            </div>
          </section>

          {/* ==================== 八、绘制内燃机的工作循环图 ==================== */}
          <section className="mb-12">
            <h2 className="text-[24px] font-bold mb-6 text-[#1a1a1a] border-b-2 border-black pb-2">
              八、绘制内燃机的工作循环图
            </h2>

            <div className="text-[15px] font-serif leading-7 mb-6 indent-8 text-justify">
               <p>
                 将曲柄视为一个校准部件，每两轮旋转一次，形成一个工作循环。画出各部门在工作岗位上的协调示意图。
               </p>
               <p>
                 对于四冲程内燃机的工作循环，进气冲程为 0°~ 180+<Italic>θ</Italic>°，压缩冲程为 180+<Italic>θ</Italic>°~ 360°，膨胀冲程为 360°~ 540+<Italic>θ</Italic>°，排气冲程为 540+<Italic>θ</Italic>°~ 720°。已知作动行程的运动角为 60°，最远停留角为 10°，回程运动角为 60°。进气门提前开放角 -10°，排气提前开放角 -32°。
               </p>
               <p>
                 根据排气前进角、驱动行程和回程的运动角，计算出凸轮在排气口开闭时的角度。
               </p>
            </div>

            {/* 公式计算展示 */}
            <div className="text-[15px] font-serif pl-8 mb-8 space-y-4">
               <p><Italic>x</Italic><Sub>0</Sub><Sup>*</Sup>: 凸轮Ⅱ的安装角；</p>
               <p><Italic>y</Italic><Sub>0</Sub><Sup>*</Sup>: 凸轮Ⅰ的安装角；</p>

               <div className="flex items-center gap-1 my-6 text-lg">
                   <span><Italic>x</Italic><Sub>0</Sub><Sup>*</Sup> = </span>
                   <Fraction
                      num={<span>720 - (540 + <Italic>θ</Italic>) + 32</span>}
                      den="2"
                   />
               </div>
               <p>
                 <Italic>y</Italic><Sub>0</Sub><Sup>*</Sup> = 130 - <Italic>x</Italic><Sub>0</Sub><Sup>*</Sup>
               </p>

               <p className="mt-4 font-bold">
                 已求得 <Italic>θ</Italic> = {installAngles.theta.toFixed(2)}°
               </p>
               <p className="font-bold">
                 解得 <Italic>x</Italic><Sub>0</Sub><Sup>*</Sup> = {installAngles.x0_star.toFixed(2)}° <span className="mx-8"></span>
                 <Italic>y</Italic><Sub>0</Sub><Sup>*</Sup> = {installAngles.y0_star.toFixed(2)}°
               </p>
            </div>

            <p className="indent-8 text-[15px] font-serif mb-4">工作循环图如图所示：</p>

            {/* 图 18 工作循环图 */}
            {renderWorkingCycle()}
            <p className="text-center font-bold text-[15px] font-serif">图 18 工作循环图 </p>

          </section>

          {/* ==================== 九、心得体会 ==================== */}
          <section className="mb-12 page-break-before">
             <h2 className="text-[24px] font-bold mb-6 text-[#1a1a1a] border-b-2 border-black pb-2">
               九、心得体会
             </h2>
             <div className="h-48 border border-dashed border-gray-300 flex items-center justify-center text-gray-400">
             </div>
          </section>

          {/* ==================== 参考文献 ==================== */}
          <section className="mb-12">
             <h2 className="text-[24px] font-bold mb-6 text-[#1a1a1a] border-b-2 border-black pb-2">
               参考文献
             </h2>
             <ul className="list-none pl-0 space-y-2 text-[15px] font-serif">
                <li>[1] 孙恒，陈作模，葛文杰 . 机械原理[M].8版 . 北京：高等教育出版社, 2013..</li>
                <li>[2] 李琳,邹焱飚. 机械原理教程[M].北京：清华大学出版社, 2014</li>
                <li>[3] 机械原理计算机辅助设计[M]. 北京 华南理工大学出版社, 1986.03.</li>
                <li>[4] 哈尔滨工业大学理论力学教研室. 理论力学[M]．北京：高等教育出版社, 2016.6</li>
                <li>[5] 袁兆成. 内燃机设计[M]．北京：机械工业出版社, 2008. 8.</li>
                <li>[6] 裘建新. 机械原理指导书[M]. 北京:高等教育出版社, 2008</li>
                <li>[7] 周明傅. 机械原理课程设计[M]. 上海：上海科技出版社，1987</li>
                <li>[8] 杨忠秀. 机械原理课程设计指导书[M]. 上海.机械工业出版社, 2003.</li>
                <li>[9] 张晓晴. 材料力学[M]. 北京.机械工业出版社, 2021.6.</li>
                <li>[10] 姜琪.机构运动方案及机构设计—机械原理课程设计题例及指导［M］.北京:高等教育出版社,1991.04.</li>
             </ul>
          </section>

          {/* ==================== 附录 ==================== */}
          <section className="mb-12">
             <h2 className="text-[24px] font-bold mb-6 text-[#1a1a1a] border-b-2 border-black pb-2">
               附录
             </h2>
             <p className="font-bold mb-2 text-[15px] font-serif">凸轮 matlab 代码：</p>
             <div className="bg-gray-50 border border-gray-200 p-4 font-mono text-sm overflow-x-auto whitespace-pre leading-5">
{`rb = ${data.cam2.r}; % 基圆半径(mm)
e = ${data.cam2.e}; % 偏心距(mm)
h = ${data.cam2.h}; % 推程(mm)
rr = 10; % 滚子半径(mm)
angle_rest = 10; % 远休止角(°)
angle_rise = 60; % 推程角(°)
angle_fall = 60; % 回程角(°)
angle_total = angle_rest + angle_rise + angle_fall; % 总运动角(°)
angle_remain = 360 - angle_total; % 近休止角(°)

% 角度范围设置（完整 360°）
theta = linspace(0, 360, 1000);
theta_rad = deg2rad(theta); % 转换为弧度

% 初始化位移数组
s = zeros(size(theta));

% 计算位移曲线（正弦加速度规律）
for i = 1:length(theta)
    if theta(i) <= angle_rise
        % 推程阶段
        beta = theta(i) / angle_rise;
        s(i) = h * (beta - sin(2*pi*beta)/(2*pi));
    elseif theta(i) <= angle_rise + angle_rest
        % 远休止阶段
        s(i) = h;
    elseif theta(i) <= angle_rise + angle_rest + angle_fall
        % 回程阶段
        beta = (theta(i) - angle_rise - angle_rest) / angle_fall;
        s(i) = h * (1 - beta + sin(2*pi*beta)/(2*pi));
    else
        % 近休止阶段
        s(i) = 0;
    end
end

% 计算理论廓线坐标
x_theory = (s + rb) .* sin(theta_rad) + e * cos(theta_rad);
y_theory = (s + rb) .* cos(theta_rad) - e * sin(theta_rad);

% 计算实际廓线坐标（考虑滚子半径 - 内包络修正）
dx = gradient(x_theory, theta_rad);
dy = gradient(y_theory, theta_rad);
norm_factor = sqrt(dx.^2 + dy.^2);
nx = dy ./ norm_factor; % 法向量分量 (向外)
ny = -dx ./ norm_factor;
x_actual = x_theory + rr * nx; % 修正：加上向内偏移量(若nx指向内) 或 减去向外
% (此处代码逻辑已修正为 + rr*nx 对应内包络)
y_actual = y_theory + rr * ny;

% 绘制凸轮轮廓
figure;
plot(x_theory, y_theory, 'b', 'LineWidth', 1.5); hold on;
plot(x_actual, y_actual, 'r', 'LineWidth', 1.5);
plot(0, 0, 'k+', 'MarkerSize', 10); % 标出旋转中心
axis equal;
grid on;
title('凸轮完整轮廓曲线');
xlabel('x (mm)'); ylabel('y (mm)');
legend('理论廓线', '实际廓线', '旋转中心');
hold off;

% 绘制位移曲线
figure;
plot(theta(theta<=130), s(theta<=130), 'LineWidth', 1.5);
grid on;
title('推杆位移曲线 ');
xlabel('凸轮转角 (°)'); ylabel('位移 (mm)');
xlim([0 130]);`}
             </div>
          </section>

        </div>
      </main>
    </div>
  );
}