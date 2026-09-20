import { Component, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

export class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <section className="card" role="alert">
      <h1>This page couldn’t open</h1>
      <p>Reload to try again. Saved dashboard data will still be here.</p>
      <div className="ux-actions"><button className="btn" onClick={() => window.location.reload()}>Reload page</button><Link className="btn btn-ghost" to="/">Back to Today</Link></div>
    </section>
    return this.props.children
  }
}
