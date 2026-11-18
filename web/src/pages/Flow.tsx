import type { ReactNode } from "react";
import FlowDiagram from "./FlowDiagram";
/** How a request travels through the gateway (moved here from the sign-in page). */
export default function Flow({ headerTools }: { headerTools: ReactNode }) {
  return (
    <section className="page flow-page">
      <div className="top">
        <div>
          <h1>Sơ đồ</h1>
          <p className="lead">Agent gửi tới gateway, gateway cắt bớt token rồi chuyển tới nhà cung cấp theo tiền tố model</p>
        </div>
        <div className="tools">{headerTools}</div>
      </div>
      <FlowDiagram />
    </section>
  );
}
