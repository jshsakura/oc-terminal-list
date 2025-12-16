import{c as l,r as d,j as e}from"./index-DqcDFUo8.js";import{X as x}from"./x-wwDVslGY.js";/**
 * @license lucide-react v0.560.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]],u=l("check",p),m=({isOpen:n,message:a,onClose:s,theme:c,duration:i=3e3})=>{if(d.useEffect(()=>{if(n&&i>0){const r=setTimeout(()=>{s()},i);return()=>clearTimeout(r)}},[n,i,s]),!n)return null;const t=c||{ui:{bgTertiary:"#313244",border:"#2a2b3d",text:"#cdd6f4",textSecondary:"#6c7086"},green:"#a6e3a1"};return e.jsxs(e.Fragment,{children:[e.jsx("style",{children:`
        @keyframes slideInUp {
          from {
            transform: translate(-50%, 100px);
            opacity: 0;
          }
          to {
            transform: translate(-50%, 0);
            opacity: 1;
          }
        }
      `}),e.jsxs("div",{style:{...o.toast,backgroundColor:t.ui.bgTertiary,borderColor:t.ui.border,animation:"slideInUp 0.3s ease"},children:[e.jsxs("div",{style:o.content,children:[e.jsx("div",{style:{...o.iconCircle,backgroundColor:t.green+"25"},children:e.jsx(u,{size:18,color:t.green,strokeWidth:2.5})}),e.jsx("span",{style:{...o.message,color:t.ui.text},children:a})]}),e.jsx("button",{onClick:s,style:{...o.closeBtn,color:t.ui.textSecondary},onMouseEnter:r=>{r.currentTarget.style.color=t.ui.text},onMouseLeave:r=>{r.currentTarget.style.color=t.ui.textSecondary},children:e.jsx(x,{size:16})})]})]})},o={toast:{position:"fixed",bottom:"24px",left:"50%",transform:"translateX(-50%)",zIndex:10001,backgroundColor:"#313244",borderRadius:"8px",padding:"14px 16px",border:"1px solid",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"12px",minWidth:"320px",maxWidth:"400px"},content:{display:"flex",alignItems:"center",gap:"12px",flex:1},iconCircle:{width:"32px",height:"32px",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0},message:{fontSize:"14px",fontWeight:"500",lineHeight:"1.4"},closeBtn:{background:"none",border:"none",cursor:"pointer",padding:"4px",display:"flex",alignItems:"center",justifyContent:"center",borderRadius:"4px",transition:"color 0.15s ease",flexShrink:0}};export{m as default};
