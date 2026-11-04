import {markPaths,markViewBox} from './assets/dsh-mark';
export default function DshBrand(){return <div className="dsh-chat-empty" role="status" aria-label="空白 DSH 对话"><svg className="dsh-brand-mark" role="img" aria-label="DeepSeek Harness 图标" viewBox={markViewBox}>{markPaths.map((d,i)=><path key={i} d={d} fill="currentColor"/>)}</svg><strong>DeepSeek Harness</strong></div>;}
