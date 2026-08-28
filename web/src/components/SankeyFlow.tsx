"use client";
import { Sankey, Tooltip, ResponsiveContainer } from "recharts";
import type { NodeProps } from "recharts/types/chart/Sankey";
import { fmtMoney } from "@/lib/format";
import type { ValueMode } from "@/lib/queries";
import { useChartTheme, tooltipProps } from "./chart";
import type { ChartTheme } from "@/lib/colors";

// Recharts' default node is an unlabelled rectangle, which makes the whole diagram
// undecipherable without hovering. Draw the name beside each node instead. The card nodes in
// the first column have nothing feeding into them, so they label leftwards into the left
// margin; every other node labels rightwards. (Recharts fills `sourceLinks` with a node's
// INBOUND links, so an empty one marks the first column, not the last.)
function labelledNode(t: ChartTheme) {
  return function LabelledNode({ x, y, width, height, payload }: NodeProps) {
    const isFirstColumn = payload.sourceLinks.length === 0;
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill={t.series.primary} rx={2} />
        <text
          x={isFirstColumn ? x - 6 : x + width + 6}
          y={y + height / 2}
          textAnchor={isFirstColumn ? "end" : "start"}
          dominantBaseline="middle"
          fontSize={11}
          fill={t.inkMuted}
        >
          {payload.name}
        </text>
      </g>
    );
  };
}

export function SankeyFlow({ data, value }: {
  data: { nodes: { name: string }[]; links: { source: number; target: number; value: number }[] };
  value: ValueMode;
}) {
  const t = useChartTheme();
  if (data.nodes.length === 0) {
    return <p className="text-sm text-ink-muted">No spending in this month.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(420, data.nodes.length * 24)}>
      <Sankey
        data={data}
        nodePadding={18}
        nodeWidth={12}
        margin={{ top: 8, right: 170, bottom: 8, left: 72 }}
        node={labelledNode(t)}
        link={{ stroke: t.series.primary, strokeOpacity: t.scheme === "dark" ? 0.22 : 0.28 }}
      >
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} {...tooltipProps(t)} />
      </Sankey>
    </ResponsiveContainer>
  );
}
