// Type declarations to fix recharts compatibility with React 19
// The recharts library types don't fully support React 19's type system
// Using permissive types to avoid prop-by-prop type errors
declare module 'recharts' {
  import { ComponentType, ReactNode } from 'react'

  // Base props interface with index signature for unknown props
  interface BaseChartProps {
    data?: any[]
    margin?: { top?: number; right?: number; bottom?: number; left?: number }
    children?: ReactNode
    width?: number | string
    height?: number | string
    [key: string]: any
  }

  interface BaseAxisProps {
    dataKey?: string
    stroke?: string
    fontSize?: number
    tickLine?: boolean
    axisLine?: boolean | object
    tickFormatter?: (value: any, index?: number) => string
    interval?: string | number
    minTickGap?: number
    type?: string
    domain?: any[]
    allowDataOverflow?: boolean
    hide?: boolean
    tick?: boolean | object | ((props: any) => ReactNode)
    angle?: number
    textAnchor?: string
    height?: number
    width?: number
    orientation?: 'left' | 'right' | 'top' | 'bottom'
    yAxisId?: string | number
    xAxisId?: string | number
    scale?: string | Function
    padding?: { left?: number; right?: number; top?: number; bottom?: number }
    reversed?: boolean
    ticks?: any[]
    tickCount?: number
    [key: string]: any
  }

  interface BaseSeriesProps {
    type?: string
    dataKey?: string
    stroke?: string
    strokeWidth?: number
    fill?: string
    dot?: boolean | object | ((props: any) => ReactNode)
    activeDot?: boolean | object | ((props: any) => ReactNode)
    name?: string
    yAxisId?: string | number
    xAxisId?: string | number
    connectNulls?: boolean
    strokeDasharray?: string
    stackId?: string
    barSize?: number
    maxBarSize?: number
    isAnimationActive?: boolean
    animationDuration?: number
    animationBegin?: number
    [key: string]: any
  }

  interface ResponsiveContainerProps {
    width?: string | number
    height?: string | number
    aspect?: number
    minWidth?: number
    minHeight?: number
    debounce?: number
    children?: ReactNode
    [key: string]: any
  }

  interface CartesianGridProps {
    strokeDasharray?: string
    stroke?: string
    vertical?: boolean
    horizontal?: boolean
    [key: string]: any
  }

  interface TooltipProps {
    contentStyle?: object
    labelStyle?: object
    itemStyle?: object
    labelFormatter?: (value: any, payload?: any[]) => ReactNode
    formatter?: (value: any, name?: string, props?: any, index?: number, payload?: any) => any
    cursor?: boolean | object
    active?: boolean
    payload?: any[]
    label?: string
    separator?: string
    wrapperStyle?: object
    content?: ReactNode | ((props: any) => ReactNode)
    [key: string]: any
  }

  interface LegendProps {
    align?: 'left' | 'center' | 'right'
    verticalAlign?: 'top' | 'middle' | 'bottom'
    layout?: 'horizontal' | 'vertical'
    iconType?: string
    wrapperStyle?: object
    formatter?: (value: string, entry: any, index: number) => ReactNode
    payload?: any[]
    content?: ReactNode | ((props: any) => ReactNode)
    [key: string]: any
  }

  interface ReferenceLineProps {
    x?: string | number
    y?: string | number
    stroke?: string
    strokeDasharray?: string
    label?: string | object | ReactNode
    yAxisId?: string | number
    xAxisId?: string | number
    [key: string]: any
  }

  export const ResponsiveContainer: ComponentType<ResponsiveContainerProps>
  export const AreaChart: ComponentType<BaseChartProps>
  export const LineChart: ComponentType<BaseChartProps>
  export const BarChart: ComponentType<BaseChartProps>
  export const ComposedChart: ComponentType<BaseChartProps>
  export const PieChart: ComponentType<BaseChartProps>
  export const RadarChart: ComponentType<BaseChartProps>
  export const ScatterChart: ComponentType<BaseChartProps>
  export const Area: ComponentType<BaseSeriesProps>
  export const Line: ComponentType<BaseSeriesProps>
  export const Bar: ComponentType<BaseSeriesProps>
  export const Scatter: ComponentType<BaseSeriesProps>
  export const Pie: ComponentType<BaseSeriesProps>
  export const Radar: ComponentType<BaseSeriesProps>
  export const XAxis: ComponentType<BaseAxisProps>
  export const YAxis: ComponentType<BaseAxisProps>
  export const ZAxis: ComponentType<BaseAxisProps>
  export const CartesianGrid: ComponentType<CartesianGridProps>
  export const Tooltip: ComponentType<TooltipProps>
  export const Legend: ComponentType<LegendProps>
  export const ReferenceLine: ComponentType<ReferenceLineProps>
  export const ReferenceArea: ComponentType<ReferenceLineProps>
  export const ReferenceDot: ComponentType<ReferenceLineProps>
  export const Brush: ComponentType<any>
  export const Cell: ComponentType<any>
  export const LabelList: ComponentType<any>
  export const Label: ComponentType<any>
  export const Customized: ComponentType<any>
}
