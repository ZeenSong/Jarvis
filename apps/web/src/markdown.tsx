import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
/** Use CommonMark/GFM upstream; never execute model-provided HTML or load remote images. */
export function MarkdownContent({ value }: { value: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml
    urlTransform={(url) => /^https?:\/\//i.test(url) ? url : ''}
    components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
      img: ({ alt }) => <span>{alt}</span> }}>{value}</Markdown>;
}
