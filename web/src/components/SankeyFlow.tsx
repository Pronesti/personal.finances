"use client";
import { Sankey, Tooltip, ResponsiveContainer } from "recharts";
import type { NodeProps } from "recharts/types/chart/Sankey";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";

// Recharts' default node is an unlabelled rectangle, which makes the whole diagram
// undecipherable without hovering. Draw the name beside each node instead. The card nodes in
// the first column have nothing feeding into them, so they label leftwards into the left
// margin; every other node labels rightwards. (Recharts fills `sourceLinks` with a node's
// INBOUND links, so an empty one marks the first column, not the last.)
function LabelledNode({ x, y, width, height, payload }: NodeProps) {
  const isFirstColumn = payload.sourceLinks.length === 0;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill="#0ea5e9" rx={2} />
      <text
        x={isFirstColumn ? x - 6 : x + width + 6}
        y={y + height / 2}
        textAnchor={isFirstColumn ? "end" : "start"}
        dominantBaseline="middle"
        fontSize={11}
        fill="currentColor"
      >
        {payload.name}
      </text>
    </g>
  );
}

export function SankeyFlow({ data, value }: {
  data: { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] };
  value: ValueMode;
}) {
  if (data.nodes.length === 0) {
    return <p className="text-sm text-zinc-500">No spending in this month.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(420, data.nodes.length * 24)}>
      <Sankey
        data={data}
        nodePadding={18}
        nodeWidth={12}
        margin={{ top: 8, right: 170, bottom: 8, left: 72 }}
        node={LabelledNode}
        link={{ stroke: "#94a3b8", strokeOpacity: 0.3 }}
      >
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} />
      </Sankey>
    </ResponsiveContainer>
  );
}
