import type { ReactNode } from "react";
export default function Row({
  label,
  note,
  stack = false,
  children,
}: {
  label: string;
  note?: string;
  stack?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={"rowi" + (stack ? " stack" : "")}>
      <span className="t">
        <b>{label}</b>
        {note && <small>{note}</small>}
      </span>
      {children}
    </div>
  );
}
