import React from 'react';
import Svg, { Path, Circle, Text as SvgText } from 'react-native-svg';
import { colors } from '../theme';

export type DonutSegment = { label: string; count: number; color: string };

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arc(cx: number, cy: number, r: number, start: number, end: number) {
  const s = polar(cx, cy, r, start);
  const e = polar(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${s.x.toFixed(3)} ${s.y.toFixed(3)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(3)} ${e.y.toFixed(3)}`;
}

type Props = {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
  centerText?: string;
  centerSub?: string;
};

export default function DonutChart({ segments, size = 110, strokeWidth = 20, centerText, centerSub }: Props) {
  const valid = segments.filter(s => s.count > 0);
  const total = valid.reduce((s, g) => s + g.count, 0);
  if (!total) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r  = (size - strokeWidth) / 2;
  const GAP = valid.length > 1 ? 2 : 0;
  let angle = 0;

  return (
    <Svg width={size} height={size}>
      {valid.map((seg, i) => {
        const span  = (seg.count / total) * (360 - GAP * valid.length);
        const start = angle + (i === 0 ? 0 : GAP);
        const end   = start + span;
        angle = end;

        if (span + 0.01 >= 360) {
          return (
            <Circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth={strokeWidth} />
          );
        }
        return (
          <Path key={i} d={arc(cx, cy, r, start, end)} fill="none"
            stroke={seg.color} strokeWidth={strokeWidth} strokeLinecap="butt" />
        );
      })}

      {centerText ? (
        <SvgText x={cx} y={centerSub ? cy - 7 : cy}
          textAnchor="middle" dy="0.35em"
          fontSize={centerSub ? 15 : 18} fontWeight="800"
          fill={colors.textPrimary}>
          {centerText}
        </SvgText>
      ) : null}
      {centerSub ? (
        <SvgText x={cx} y={cy + 10}
          textAnchor="middle" dy="0.35em"
          fontSize={9} fontWeight="600"
          fill={colors.textSecondary}>
          {centerSub.toUpperCase()}
        </SvgText>
      ) : null}
    </Svg>
  );
}
