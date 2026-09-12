import { useState, useRef, useEffect } from "react";
import { galleryDataSchema } from "../../../packages/ui-protocol-v2/src/gallery";
function Thumbnail({ src, title }: { src:string; title:string }) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[src]);
  return failed ? <span className="gallery-image-error" role="status">图片暂不可用</span> : <img src={src} alt={title} loading="lazy" onError={()=>setFailed(true)} />;
}
export function GalleryView({title,data,fallback}:{title:string;data:unknown;fallback:string}) {
  const parsed=galleryDataSchema.safeParse(data);
  const [selected,setSelected]=useState<string>();
  const dialog=useRef<HTMLDialogElement>(null);
  const items=parsed.success?parsed.data.items:[];
  const item=items.find((value)=>value.id===selected);
  useEffect(()=>{ if(item) dialog.current?.showModal(); else dialog.current?.close(); },[item?.id]);
  return <section className="block semantic-gallery" aria-label={title}><h3>{title}</h3>
    {!parsed.success ? <p role="status">{fallback}</p> : !items.length ? <p role="status">暂无照片</p> : <div className="gallery-grid">{items.map((value)=><button key={value.id} onClick={()=>setSelected(value.id)} aria-label={`查看照片：${value.title}`}><Thumbnail src={value.thumbnail} title={value.title}/><span>{value.title}</span></button>)}</div>}
    <dialog ref={dialog} className="application-detail gallery-detail" aria-label="照片详情" onClose={()=>setSelected(undefined)}>
      {item && <><header><h2>{item.title}</h2><button aria-label="关闭照片详情" onClick={()=>dialog.current?.close()}>×</button></header><Thumbnail src={item.thumbnail} title={item.title}/>{item.description && <p>{item.description}</p>}{item.captured_at && <p>拍摄时间：{Number.isFinite(Date.parse(item.captured_at))?new Date(item.captured_at).toLocaleString("zh-CN"):"未知"}</p>}<p className="muted">当前显示缩略图</p></>}
    </dialog>
  </section>;
}
