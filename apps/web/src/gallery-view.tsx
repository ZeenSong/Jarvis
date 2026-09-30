import { useState, useRef, useEffect } from "react";
import { galleryDataSchema } from "../../../packages/ui-protocol-v2/src/gallery";

type GalleryItem = { id: string; title: string; resource_id?: string; thumbnail?: string; description?: string; captured_at?: string; immich_asset_id?: string };

function Thumbnail({ src, title }: { src: string; title: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return failed
    ? <span className="gallery-image-error" role="status">图片暂不可用</span>
    : <img src={src} alt={title} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

export function GalleryView({ title, data, fallback, action, followup }: {
  title: string; data: unknown; fallback: string; action?: (value: any) => void; followup?: (text: string) => void;
}) {
  const parsed = galleryDataSchema.safeParse(data);
  const [selected, setSelected] = useState<string>();
  const dialog = useRef<HTMLDialogElement>(null);
  const items = parsed.success ? parsed.data.items : [];
  const item = items.find((value) => value.id === selected);
  const imageUrl = (value: GalleryItem) => value.resource_id
    ? `/api/media/${value.resource_id}/thumbnail`
    : value.thumbnail!;
  const favorite = (photos: GalleryItem[]) => {
    const ids = photos.flatMap((photo) => photo.immich_asset_id ? [photo.immich_asset_id] : []);
    if (!ids.length) return;
    followup?.(`请在 Immich 中收藏以下照片：${ids.join("、")}。如果需要选择或新建相册，请先询问我；执行写操作前说明影响范围并等待确认。`);
  };
  const openInImmich = (photo: GalleryItem) => {
    if (!photo.immich_asset_id) return;
    dialog.current?.close();
    action?.({ type: "app.open", target: "immich", kind: "photo", resource_id: photo.immich_asset_id, platform: "web" });
  };
  useEffect(() => { if (item) dialog.current?.showModal(); else dialog.current?.close(); }, [item?.id]);
  return <section className="block semantic-gallery" aria-label={title}>
    <h3>{title}</h3>
    {!parsed.success ? <p role="status">{fallback}</p> : !items.length ? <p role="status">暂无照片</p> : <>
      <div className="gallery-grid">{items.map((value) => <button key={value.id} onClick={() => setSelected(value.id)} aria-label={`查看照片：${value.title}`}>
        <Thumbnail src={imageUrl(value)} title={value.title} /><span>{value.title}</span>
      </button>)}</div>
      <div className="gallery-actions">
        <button type="button" onClick={() => followup?.("请从 Immich 为我查看更多符合刚才条件的猫咪照片，并简要说明每张照片的亮点。")}>查看更多</button>
        {items.length === 3 && items.every((photo) => photo.immich_asset_id) && <button type="button" onClick={() => favorite(items)}>收藏这三张</button>}
      </div>
    </>}
    <dialog ref={dialog} className="application-detail gallery-detail" aria-label="照片详情" onClose={() => setSelected(undefined)}>
      {item && <>
        <header><h2>{item.title}</h2><button type="button" aria-label="关闭照片详情" onClick={() => dialog.current?.close()}>×</button></header>
        <Thumbnail src={imageUrl(item)} title={item.title} />
        {item.description && <p>{item.description}</p>}
        {item.captured_at && <p>拍摄时间：{Number.isFinite(Date.parse(item.captured_at)) ? new Date(item.captured_at).toLocaleString("zh-CN") : "未知"}</p>}
        {item.immich_asset_id ? <div className="gallery-detail-actions">
          <button type="button" onClick={() => favorite([item])}>收藏这张</button>
          <button type="button" onClick={() => openInImmich(item)}>在 Immich 打开</button>
        </div> : <p className="muted">当前显示缩略图</p>}
      </>}
    </dialog>
  </section>;
}
