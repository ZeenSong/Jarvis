import { listDataSchema } from "../../../packages/ui-protocol-v2/src/list";
export function ListView({ title, data, fallback }: { title: string; data: unknown; fallback: string }) {
  const parsed = listDataSchema.safeParse(data);
  return <section className="block semantic-list" aria-label={title}><h3>{title}</h3>
    {!parsed.success ? <p role="status">{fallback}</p> : !parsed.data.items.length ? <p role="status">暂无条目</p> :
      <ul>{parsed.data.items.map((item, index) => <li key={index}><div><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}</div>{item.status && <small>{item.status}</small>}</li>)}</ul>}
  </section>;
}
