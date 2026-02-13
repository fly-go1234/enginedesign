import React, { useState, useEffect, useRef } from 'react';
import Stage1View, { SCHEMES } from './Stage1View';
import Stage2View from './Stage2View';
import Stage3View from './Stage3View';
import Stage456View from './Stage456View';
import Stage789View from './Stage789View';

// =========================================================
// CSS 注入：视觉净化与布局修复
// =========================================================
const GLOBAL_STYLES = `
  /* -------------------------------------------------------
   * 1. 布局核心 (防止内容塌陷)
   * ------------------------------------------------------- */
  .stage-blackbox-content div,
  .stage-blackbox-content section,
  .stage-blackbox-content main {
    /* 强制解除子组件的高度锁定，让内容自然流式排列 */
    height: auto !important;
    min-height: 0 !important;
    max-height: none !important;
    overflow: visible !important;
    position: static !important;
  }

  /* 核心：去除所有竖线 (border-x) */
  .stage-blackbox-content * {
    border-left-color: transparent !important;
    border-right-color: transparent !important;
    border-image: none !important;
    box-shadow: none !important; /* 去除阴影形成的线 */
  }

  
  /* 保护图表/表格内部的线条不被误删 */
  .stage-blackbox-content svg *,
  .stage-blackbox-content table,
  .stage-blackbox-content table td,
  .stage-blackbox-content table th {
     border-color: initial !important; 
     border-left-color: initial !important; /* 恢复表格竖线 */
     border-right-color: initial !important;
  }

  /* -------------------------------------------------------
   * 3. 隐藏多余元素 (文字/按钮/选择器)
   * ------------------------------------------------------- */
  /* 隐藏所有 Select */
  .stage-blackbox-content select { display: none !important; }
  
  /* 隐藏所有 Button (除图表交互外) */
  .stage-blackbox-content button { display: none !important; }

  /* 针对特定顶部栏的隐藏 */
  .stage-blackbox-content .flex.justify-between.items-center.mb-4,
  .stage-blackbox-content .border-b.border-blue-600 {
     display: none !important;
  }

/* -------------------------------------------------------
   * 4. 极度紧凑化布局
   * ------------------------------------------------------- */
  .stage-section-wrapper {
    margin-bottom: 0px !important;
    padding-bottom: 0px !important; /* 修改为 0 */
    padding-top: 0px !important;    /* 修改为 0 */
    border-bottom: none !important; /* 甚至可以去除分隔线让衔接更无缝 */
  }
  
  /* 移除子组件首尾的多余空白 */
  。stage-blackbox-content > div {
     padding-top: 0 !important;
     padding-bottom: 0 !important;
     margin-top: 0 !important;
     margin-bottom: 0 !important;
  }
`;

// 目录关键字配置
const TOC_KEYWORDS = [
  "摘要", "目录",
  "一、", "二、", "三、", "四、", "五、", "六、", "七、", "八、", "九、",
  "1.", "2.", "3.", "4.", "5.", "6.", "7.", "8.", "9.",
  "1.1", "2.1", "3.1", "7.1",
  "参考文献", "附录"
];

export default function StageView() {
  const [currentScheme, setCurrentScheme] = useState("VII");
  const [customParams, setCustomParams] = useState(null);
  const [toc, setToc] = useState([]);
  // 记录折叠状态：key为headerId, value为true表示折叠
  const [collapsedSections, setCollapsedSections] = useState({});
  const contentRef = useRef(null);

  // -------------------------------------------------------
  // 逻辑 A: 强力同步 (方案联动 + 文本清除)
  // -------------------------------------------------------
  useEffect(() => {
    // 延时确保 DOM 渲染完成
    const timer = setTimeout(() => {
      if (!contentRef.current) return;

      console.log(`[System] Executing Sync for Scheme: ${currentScheme}`);

      // --- 1. 触发子组件内部隐藏的 Select (关键修复：Stage 1 参数联动) ---
      const selects = contentRef.current.querySelectorAll('select');
      selects.forEach(select => {
        // React 16+ 劫持了 value 属性，必须通过原型链调用原生 setter
        const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
        if (nativeSelectValueSetter) {
            nativeSelectValueSetter.call(select, currentScheme);
            // 必须触发 bubbles: true 的 change 事件，React 才能监听到
            const event = new Event('change', { bubbles: true });
            select.dispatchEvent(event);
        }
      });

      // --- 2. 触发子组件内部隐藏的 Button (Stage 7/8/9 联动) ---
      const buttons = contentRef.current.querySelectorAll('button');
      buttons.forEach(btn => {
        const text = btn.innerText.trim();
        // 模糊匹配：只要包含当前方案名 (如 "VII") 就点击
        if (text === currentScheme || text === `方案${currentScheme}` || text.includes(` ${currentScheme} `)) {
           btn.click();
        }
      });

      // --- 3. 暴力文本清除 (去除 "Design Scheme" 等文字) ---
      // 使用 TreeWalker 遍历所有文本节点，性能最高
      const walker = document.createTreeWalker(contentRef.current, NodeFilter.SHOW_TEXT, null, false);
      let node;
      const nodesToRemove = [];

      while((node = walker.nextNode())) {
        const text = node.nodeValue.trim();
        // 匹配目标文字
        if (text.includes("Design Scheme") ||
            text.includes("选择方案预览") ||
            (text.includes("方案") && text.length < 10 && !text.includes(currentScheme))) { // 移除未选中的方案按钮文字

            // 找到其所在的元素节点
            let targetEl = node.parentElement;

            // 向上查找最近的容器进行隐藏 (通常是 flex 行或 div)
            // 避免隐藏太大的容器，只隐藏包含该文字的控制条
            let container = targetEl;
            let depth = 0;
            while(container && container !== contentRef.current && depth < 3) {
                // 如果遇到 flex 容器或带有 border 的容器，通常就是控制条
                const style = window.getComputedStyle(container);
                if (style.display === 'flex' || container.className.includes('border')) {
                    targetEl = container;
                    break;
                }
                container = container.parentElement;
                depth++;
            }
            nodesToRemove.push(targetEl);
        }
      }
      // 统一隐藏
      nodesToRemove.forEach(el => {
          if(el) el.style.display = 'none';
      });

    }, 400); // 留出足够时间给子组件渲染

    return () => clearTimeout(timer);
  }, [currentScheme]);

  // -------------------------------------------------------
  // 逻辑 B: 目录扫描 (保持不变，增加容错)
  // -------------------------------------------------------
  useEffect(() => {
    const timer = setTimeout(() => {
        if (!contentRef.current) return;
        const foundHeaders = [];
        // 扫描所有可能的标题标签
        const candidates = contentRef.current.querySelectorAll('h1, h2, h3, h4, h5, div, p, span, b, strong');

        candidates.forEach((el, index) => {
            // 1. 跳过隐藏元素
            if (el.style.display === 'none') return;

            const text = el.innerText ? el.innerText.trim() : "";
            if (text.length < 2 || text.length > 50) return;

            // =========================================================
            // 【核心修复】: 仅过滤三级格式 (X.X.X)，绝不通过标签名过滤
            // =========================================================
            if (text.match(/^\d+\.\d+\.\d+/)) {
                return; // 遇到 1.1.1 这种格式直接跳过，不录入目录
            }

            // 2. 匹配逻辑
            const isKeywordMatch = TOC_KEYWORDS.some(kw => text.startsWith(kw));
            // 保留 H3，防止误删二级标题
            const isTagMatch = ['H1','H2','H3'].includes(el.tagName);

            if (isKeywordMatch || isTagMatch) {
                if (!el.id) el.id = `toc-node-${index}`;

                let level = 2; // 默认为二级

                // --- 一级目录判定 ---
                if (el.tagName === 'H1' ||
                    text.match(/^[一二三四五六七八九]、/) ||
                    ['摘要', '参考文献', '附录'].includes(text)) {
                    level = 1;
                }
                // --- 二级目录判定 ---
                // 只要是 X.X 开头 (例如 1.1)，且上面已经排除了 X.X.X，这里就是安全的二级
                else if (text.match(/^\d+\.\d+/)) {
                    level = 2;
                }

                foundHeaders.push({ id: el.id, text, level });
            }
        });

        // 简单去重
        const uniqueHeaders = [];
        const seen = new Set();
        foundHeaders.forEach(h => {
            if (!seen.has(h.text)) {
                seen.add(h.text);
                uniqueHeaders.push(h);
            }
        });

        setToc(uniqueHeaders);
    }, 800);

    return () => clearTimeout(timer);
  }, [currentScheme]);

  // 交互逻辑
  const scrollTo = (id) => {
    const el = document.getElementById(id);
    if (el) {
        const top = el.getBoundingClientRect().top + window.scrollY - 100;
        window.scrollTo({ top, behavior: 'smooth' });
    }
  };

  const toggleCollapse = (id, e) => {
      e.stopPropagation();
      setCollapsedSections(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // 渲染目录
  const renderToc = () => {
    if (toc.length === 0) return <div className="p-4 text-xs text-gray-400">正在解析文档结构...</div>;

    const items = [];
    let currentLevel1Id = null; // 当前所属的一级目录 ID

    toc.forEach((item, i) => {
        if (item.level === 1) {
            currentLevel1Id = item.id;
            const isCollapsed = collapsedSections[item.id];

            items.push(
                <li key={i} className="mt-2 first:mt-0">
                    <div className="flex items-center hover:bg-gray-100 rounded px-2 py-1.5 cursor-pointer group transition-colors">
                        {/* 折叠按钮 */}
                        <button
                            onClick={(e) => toggleCollapse(item.id, e)}
                            className="mr-2 p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                            <svg
                                className={`w-3 h-3 transform transition-transform duration-200 ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
                                viewBox="0 0 20 20" fill="currentColor"
                            >
                                <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                            </svg>
                        </button>
                        {/* 标题 */}
                        <span
                            onClick={() => scrollTo(item.id)}
                            className="text-sm font-bold text-gray-800 flex-1 truncate"
                            title={item.text}
                        >
                            {item.text}
                        </span>
                    </div>
                </li>
            );
        } else {
            // 二级目录：仅当父级存在且未折叠时显示
            if (currentLevel1Id && !collapsedSections[currentLevel1Id]) {
                items.push(
                    <li key={i} className="ml-8 border-l border-gray-200 hover:border-blue-400 transition-colors">
                        <div
                            onClick={() => scrollTo(item.id)}
                            className="pl-3 py-1 text-xs text-gray-500 hover:text-blue-600 cursor-pointer truncate hover:bg-blue-50/50 rounded-r"
                            title={item.text}
                        >
                            {item.text}
                        </div>
                    </li>
                );
            }
        }
    });

    return <ul className="pb-4">{items}</ul>;
  };

  return (
    <div className="min-h-screen bg-white font-sans text-slate-800">
      <style>{GLOBAL_STYLES}</style>

      {/* --- 顶部悬浮导航 --- */}
      <header className="fixed top-0 left-0 right-0 h-16 bg-white/95 backdrop-blur-md shadow-[0_1px_3px_rgba(0,0,0,0.05)] z-[9999] flex items-center justify-between px-8 border-b border-gray-100 min-w-[1440px]">
        <div className="flex items-center gap-4">
           {/* Logo / 图标 */}
           <div className="w-8 h-8 bg-blue-600 rounded-md flex items-center justify-center text-white font-bold shadow-sm">
             LC
           </div>
           <h1 className="text-lg font-bold text-gray-800 tracking-tight">四冲程内燃机设计</h1>
        </div>

        {/* 方案选择器 (唯一控制源) */}
        <div className="flex items-center bg-gray-50 px-3 py-1 rounded-lg border border-gray-200 hover:border-blue-300 transition-colors">
            <span className="text-xs font-bold text-gray-500 mr-2 uppercase tracking-wide">方案切换:</span>
            <div className="relative">
                <select
                  value={currentScheme}
                  onChange={(e) => setCurrentScheme(e.target.value)}
                  className="bg-transparent text-blue-700 font-bold text-base outline-none cursor-pointer appearance-none pr-6 z-10 relative py-1"
                >
                {Object.keys(SCHEMES).map(key => (
                    <option key={key} value={key}>方案 {key}</option>
                ))}
                    <option value="Custom">自定义 (Custom)</option>
                </select>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none">
                    <svg className="w-3 h-3 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </div>
            </div>
        </div>
      </header>

      {/* --- 主体布局 --- */}
      <div className="pt-20 max-w-[1600px] mx-auto flex items-start gap-6 px-6 pb-20 min-w-[1440px]">

        {/* 左侧：文档内容流 (无缝拼接) */}
        <main ref={contentRef} className="flex-1 min-w-0 bg-white stage-blackbox-content">
            <div className="px-4 md:px-10 py-8 bg-white shadow-[0_0_20px_rgba(0,0,0,0.02)] rounded-xl border border-gray-50">

                <div id="section-1" className="stage-section-wrapper mb-8">
                    <Stage1View
                        onDataChange={setCustomParams}
                        onSchemeChange={setCurrentScheme}
                    />
                </div>

                {/* Stage 2 */}
                <div id="section-2" className="stage-section-wrapper mb-8">
                    <Stage2View
                        schemeProp={currentScheme}
                        customParams={customParams}
                    />
                </div>

                <div id="section-3" className="stage-section-wrapper mb-8">
                    <Stage3View
                        schemeProp={currentScheme}
                        customParams={customParams}
                    />
                </div>

                {/* Stage 4-6 */}
                <div id="section-456" className="stage-section-wrapper mb-8">
                    <Stage456View
                        schemeProp={currentScheme}
                        customParams={customParams}
                    />
                </div>

                <div id="section-789" className="stage-section-wrapper mb-8">
                    <Stage789View
                        schemeProp={currentScheme}
                        customParams={customParams}
                    />
                </div>

                <div className="mt-16 pt-8 border-t border-gray-100 text-center">
                </div>
            </div>
        </main>

        {/* 右侧：智能目录 (Sticky) */}
        <aside className="w-72 flex-shrink-0 block sticky top-24 h-[calc(100vh-120px)] overflow-y-auto custom-scrollbar">
            <div className="bg-white rounded-lg border border-gray-100 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-gray-50">
                    <h3 className="font-bold text-gray-800 text-sm">目录</h3>
                </div>
                {renderToc()}
            </div>
        </aside>

      </div>
    </div>
  );
}
