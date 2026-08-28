"use client";
import { Sankey, Tooltip, ResponsiveContainer } from "recharts";
import type { NodeProps } from "recharts/types/chart/Sankey";
import { fmtMoney } from "@/lib/format";
import type { SankeyNode, ValueMode } from "@/lib/queries";
import { useChartTheme, tooltipProps } from "./chart";
import { useT } from "./I18nProvider";
import type { Translator } from "@/lib/i18n";
import type { ChartTheme } from "@/lib/colors";

// Card brands and merchant names are printed exactly as the statement spelled them; only the
// two node kinds whose label IS a category name get translated.
function nodeLabel(node: SankeyNode, tr: Translator): string {
  if (node.kind === "category" && node.category) return tr(`category.${node.category}`);
  if (node.kind === "tail" && node.category) {
    return tr("sankey.tail", { category: tr(`category.${node.category}`) });
  }
  return node.name;
}

// Recharts' default node is an unlabelled rectangle, which makes the whole diagram
// undecipherable without hovering. Draw the name beside each node instead. The card nodes in
// the first column have nothing feeding into them, so they label leftwards into the left
// margin; every other node labels rightwards. (Recharts fills `sourceLinks` with a node's
// INBOUND links, so an empty one marks the first column, not the last.)
function labelledNode(t: ChartTheme, tr: Translator) {
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
          {nodeLabel(payload as unknown as SankeyNode, tr)}
        </text>
      </g>
    );
  };
}

export function SankeyFlow({ data, value }: {
  data: { nodes: SankeyNode[]; links: { source: number; target: number; value: number }[] };
  value: ValueMode;
}) {
  const t = useChartTheme();
  const tr = useT();
  if (data.nodes.length === 0) {
    return <p className="text-sm text-ink-muted">{tr("sankey.empty")}</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(420, data.nodes.length * 24)}>
      <Sankey
        data={data}
        nodePadding={18}
        nodeWidth={12}
        margin={{ top: 8, right: 170, bottom: 8, left: 72 }}
        node={labelledNode(t, tr)}
        link={{ stroke: t.series.primary, strokeOpacity: t.scheme === "dark" ? 0.22 : 0.28 }}
      >
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} {...tooltipProps(t)} />
      </Sankey>
    </ResponsiveContainer>
  );
}
