import { Component, type ReactNode } from "react";
type Props = { resetKey: string; title: string; fallback: string; children: ReactNode };
/** Isolate renderer failures without exposing raw exceptions or resource payloads. */
export class SectionBoundary extends Component<Props, { failed: boolean; resetKey: string }> {
  state = { failed: false, resetKey: this.props.resetKey };
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props: Props, state: { resetKey: string }) {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null;
  }
  render() {
    return this.state.failed ? <section className="block" role="status"><h3>{this.props.title}</h3><p>{this.props.fallback}</p><small>此面板暂时无法显示，其他面板仍可使用。新数据到来后将重试。</small></section> : this.props.children;
  }
}
