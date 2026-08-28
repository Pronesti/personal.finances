"use client";
import { Sankey, Tooltip, ResponsiveContainer } from "recharts";
import type { NodeProps, LinkProps } from "recharts/types/chart/Sankey";
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

// The same category ramp the stacked area, pareto and weekday charts use, so a hue means the
// same thing on every page. Card nodes are the exception: a card feeds every category at once,
// so it draws in the mixed grey rather than claiming one of them — darker than the greyish
// categories next to it (transfers, taxes_fees, other), which otherwise read as the same thing.
function nodeColor(node: SankeyNode, t: ChartTheme): string {
  return node.category ? t.category[node.category] : t.series.mixed;
}

// Recharts' default node is an unlabelled rectangle, which makes the whole diagram
// undecipherable without hovering. Draw the name beside each node instead. The card nodes in
// the first column have nothing feeding into them, so they label leftwards into the left
// margin; every other node labels rightwards. (Recharts fills `sourceLinks` with a node's
// INBOUND links, so an empty one marks the first column, not the last.)
function labelledNode(t: ChartTheme, tr: Translator) {
  return function LabelledNode({ x, y, width, height, payload }: NodeProps) {
    const node = payload as unknown as SankeyNode;
    const isFirstColumn = payload.sourceLinks.length === 0;
    // Recharts' sankey layout can hand a node a negative height when a column's padding
    // outruns the container (yRatio goes negative in updateYOfTree), and SVG rejects
    // negative rect heights with a console error per node.
    const h = Math.max(0, height);
    return (
      <g>
        <rect x={x} y={y} width={width} height={h} fill={nodeColor(node, t)} rx={2} />
        <text
          x={isFirstColumn ? x - 6 : x + width + 6}
          y={y + h / 2}
          textAnchor={isFirstColumn ? "end" : "start"}
          dominantBaseline="middle"
          fontSize={11}
          fill={t.inkMuted}
        >
          {nodeLabel(node, tr)}
        </text>
      </g>
    );
  };
}

// Same cubic recharts draws by default, only tinted: a link takes the hue of whichever of its
// two ends carries the category, which is the target on the card -> category leg and the source
// on the category -> merchant one. Opacity stays low on purpose — colour tells you which
// category a band belongs to, translucency is what keeps twenty crossing bands readable.
function colouredLink(t: ChartTheme) {
  return function ColouredLink(props: LinkProps) {
    const { sourceX, sourceY, sourceControlX, targetX, targetY, targetControlX, linkWidth } = props;
    const source = props.payload.source as unknown as SankeyNode;
    const target = props.payload.target as unknown as SankeyNode;
    const category = source.category ?? target.category;
    return (
      <path
        className="recharts-sankey-link"
        d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
        fill="none"
        stroke={category ? t.category[category] : t.series.mixed}
        strokeWidth={linkWidth}
        strokeOpacity={t.scheme === "dark" ? 0.3 : 0.36}
      />
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
        link={colouredLink(t)}
      >
        <Tooltip formatter={(v) => fmtMoney(Number(v), value)} {...tooltipProps(t)} />
      </Sankey>
    </ResponsiveContainer>
  );
}
