import { useId } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { Category, Expense } from '../types';
import { categoryTotals, dailyTotals } from '../lib/analytics';
import { formatCurrency, formatCompactCurrency } from '../lib/format';

interface SpendingChartProps {
  expenses: Expense[];
  month: Date;
}

export function SpendingChart({ expenses, month }: SpendingChartProps) {
  const raw = dailyTotals(expenses, month, new Date().getMonth() === month.getMonth() && new Date().getFullYear() === month.getFullYear() ? new Date().getDate() : undefined);
  const values = raw.map((item) => item.amount);
  const max = Math.max(...values, 1);
  const width = 360;
  const height = 120;
  const left = 4;
  const right = width - 4;
  const top = 12;
  const bottom = height - 12;
  const points = values.map((value, index) => ({
    x: values.length <= 1 ? width / 2 : left + ((right - left) * index) / (values.length - 1),
    y: bottom - (value / max) * (bottom - top),
  }));
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ') || `M ${left} ${bottom} L ${right} ${bottom}`;
  const areaPath = `${linePath} L ${right} ${bottom} L ${left} ${bottom} Z`;
  const gradientId = useId().replace(/:/g, '');
  const labels = [1, Math.ceil((values.length || 1) / 3), Math.ceil((values.length || 1) * 2 / 3), values.length].filter((value, index, array) => array.indexOf(value) === index);

  return (
    <div className="chart-wrap">
      <svg className="spending-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily spending trend for the selected month">
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#54e7dc" stopOpacity=".25" /><stop offset="100%" stopColor="#54e7dc" stopOpacity="0" /></linearGradient></defs>
        {[0, 0.5, 1].map((fraction) => <line key={fraction} x1="0" x2={width} y1={top + fraction * (bottom - top)} y2={top + fraction * (bottom - top)} stroke="#252b2d" strokeDasharray="3 7" />)}
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={linePath} fill="none" stroke="#56e6da" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.length > 0 && <circle cx={points[points.length - 1]!.x} cy={points[points.length - 1]!.y} r="4" fill="#d9f978" stroke="#111517" strokeWidth="3" />}
      </svg>
      <div className="chart-x-axis">{labels.map((day) => <span key={day}>{day === 1 ? '1' : `${day}`}</span>)}</div>
    </div>
  );
}

export function CategoryBreakdown({ expenses, categories, compact = false }: { expenses: Expense[]; categories: Category[]; compact?: boolean }) {
  const items = categoryTotals(expenses, categories);
  const max = Math.max(...items.map((item) => item.amount), 1);
  if (items.length === 0 || items.every((item) => item.amount === 0)) {
    return <div className={`empty-inline ${compact ? 'empty-inline-compact' : ''}`}><div className="empty-glyph">·</div><p>Your category breakdown will appear once you log an expense.</p></div>;
  }
  return (
    <div className={`category-breakdown ${compact ? 'category-breakdown-compact' : ''}`}>
      {items.slice(0, compact ? 4 : 8).map(({ category, categoryId, amount }) => {
        const label = category?.name ?? 'Uncategorized';
        const color = category?.color ?? '#a7b0b1';
        return <div className="category-bar-row" key={categoryId}>
          <div className="category-bar-heading"><span><i className="category-bullet" style={{ backgroundColor: color }} />{label}</span><strong>{formatCurrency(amount)}</strong></div>
          <div className="category-track"><span style={{ width: `${Math.max((amount / max) * 100, 3)}%`, backgroundColor: color }} /></div>
        </div>;
      })}
    </div>
  );
}

export function CategoryDonut({ expenses, categories }: { expenses: Expense[]; categories: Category[] }) {
  const items = categoryTotals(expenses, categories).filter((item) => item.amount > 0);
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  if (total === 0) return <div className="donut-empty"><div className="donut-circle"><span>₹0</span><small>spent</small></div></div>;
  let current = 0;
  const stops = items.map((item) => {
    const start = current;
    current += (item.amount / total) * 100;
    return `${item.category?.color ?? '#8b9597'} ${start}% ${current}%`;
  });
  return <div className="donut-empty"><div className="donut-circle" style={{ background: `conic-gradient(${stops.join(', ')})` }}><div className="donut-hole"><span>{formatCompactCurrency(total)}</span><small>spent</small></div></div></div>;
}

export function ComparisonPill({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return <span className="comparison-pill neutral"><Minus size={13} />{current === 0 ? 'No change' : 'No previous month'}</span>;
  const delta = ((current - previous) / previous) * 100;
  const down = delta < 0;
  return <span className={`comparison-pill ${down ? 'positive' : delta > 0 ? 'caution' : 'neutral'}`}>
    {down ? <ArrowDownRight size={13} /> : delta > 0 ? <ArrowUpRight size={13} /> : <Minus size={13} />}{Math.abs(delta).toFixed(0)}% {down ? 'less' : delta > 0 ? 'more' : 'same'}
  </span>;
}
