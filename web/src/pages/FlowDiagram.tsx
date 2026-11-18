import Brand from "../components/Brand";
import Logo from "../components/Logo";
import ActionIcon, { type IconName } from "../components/ActionIcon";
const nodes = [
  { x: 72, y: 70, l: "Claude Code", s: "CLI", b: "claude-code" },
  { x: 72, y: 165, l: "Cursor", s: "IDE", b: "cursor" },
  { x: 72, y: 260, l: "Cline", s: "VS Code", b: "cline" },
  { x: 72, y: 355, l: "Roo Code", s: "VS Code", b: "roo-code" },
  { x: 72, y: 450, l: "Kilo Code", s: "VS Code", b: "kilo-code" },
  { x: 245, y: 260, l: "TG Gateway", s: "xác thực · giới hạn", b: "logo" },
  { x: 385, y: 260, l: "Tiết kiệm", s: "clear · compact · cache", b: "scissors" },
  { x: 520, y: 260, l: "Định tuyến", s: "theo tiền tố model", b: "split" },
  { x: 385, y: 420, l: "Thống kê", s: "ngày · tuần · tháng", b: "database" },
  { x: 688, y: 150, l: "Kiro", s: "Amazon Q", b: "kiro" },
  { x: 688, y: 260, l: "Claude API", s: "Anthropic", b: "anthropic" },
  { x: 688, y: 370, l: "OpenRouter", s: "Đa model", b: "openrouter" },
];
const edges = [
  [0, 5],
  [1, 5],
  [2, 5],
  [3, 5],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 9],
  [7, 10],
  [7, 11],
  [5, 8],
];
export default function FlowDiagram() {
  return (
    <div className="lflow card">
      <svg
        className="flow"
        viewBox="0 0 760 520"
        role="img"
        aria-label="Sơ đồ luồng agent qua TG Gateway tới nhà cung cấp"
      >
        <text className="col" x="72" y="26" textAnchor="middle">
          Agent
        </text>
        <text className="col" x="385" y="26" textAnchor="middle">
          TG Gateway
        </text>
        <text className="col" x="688" y="26" textAnchor="middle">
          Nhà cung cấp
        </text>
        {edges.map(([a, b], i) => {
          const A = nodes[a],
            B = nodes[b],
            x1 = A.x + (a === 5 ? 38 : 27),
            x2 = B.x - 27,
            mx = (x1 + x2) / 2;
          const d =
            b === 8
              ? `M245,298 C245,420 245,420 358,420`
              : `M${x1},${A.y} C${mx},${A.y} ${mx},${B.y} ${x2},${B.y}`;
          return (
            <g key={i}>
              <path
                id={"edge" + i}
                className={"edge" + (b === 8 ? " dash" : "")}
                d={d}
              />
              {a === 7 &&
                (() => {
                  const label =
                    b === 9
                      ? "claude-*"
                      : b === 10
                        ? "anthropic/*"
                        : "openrouter/*";
                  const width = label.length * 5.6 + 16;
                  const y = b === 10 ? 246 : B.y - 16;
                  return (
                    <g>
                      <rect
                        className="chipb"
                        x={622 - width / 2}
                        y={y - 9}
                        width={width}
                        height={18}
                        rx={9}
                      />
                      <text
                        className="chipt"
                        x={622}
                        y={y + 3}
                        textAnchor="middle"
                      >
                        {label}
                      </text>
                    </g>
                  );
                })()}
              {[0, 1, 2].map((k) => (
                <circle
                  key={k}
                  className={"pkt " + (k === 2 ? "r" : "q")}
                  r="3"
                >
                  <animateMotion
                    dur="3s"
                    begin={`-${i * 0.37 + k}s`}
                    repeatCount="indefinite"
                    keyPoints={k === 2 ? "1;0" : "0;1"}
                    keyTimes="0;1"
                    calcMode="linear"
                  >
                    <mpath href={"#edge" + i} />
                  </animateMotion>
                </circle>
              ))}
            </g>
          );
        })}
        {nodes.map((n, i) => {
          // Node box and icon sizes (viewBox units): the gateway a little larger.
          const h = i === 5 ? 60 : 44, icon = i === 5 ? 36 : i >= 6 && i <= 8 ? 18 : 22;
          return (
            <g className="node" key={n.l}>
              <rect
                className="box"
                x={n.x - h / 2}
                y={n.y - h / 2}
                width={h}
                height={h}
                rx={i === 5 ? 15 : 11}
              />
              <foreignObject
                x={n.x - icon / 2}
                y={n.y - icon / 2}
                width={icon}
                height={icon}
              >
                {i === 5 ? (
                  <Logo />
                ) : i >= 6 && i <= 8 ? (
                  <span className="lg">
                    <ActionIcon name={n.b as IconName} size={icon} />
                  </span>
                ) : (
                  <Brand id={n.b} size={icon} />
                )}
              </foreignObject>
              {i > 4 && (
                <circle className="port" cx={n.x - h / 2} cy={n.y} r="3" />
              )}
              {i < 8 && (
                <circle className="port" cx={n.x + h / 2} cy={n.y} r="3" />
              )}
              <text x={n.x} y={n.y + h / 2 + 16} textAnchor="middle">
                {n.l}
              </text>
              <text
                className="s"
                x={n.x}
                y={n.y + h / 2 + 30}
                textAnchor="middle"
              >
                {n.s}
              </text>
            </g>
          );
        })}
      </svg>
      <div>
        <div className="legend2">
          <span>
            <i style={{ background: "var(--accent)" }} />
            Request đi
          </span>
          <span>
            <i style={{ background: "var(--good)" }} />
            Response về
          </span>
        </div>
      </div>
    </div>
  );
}
