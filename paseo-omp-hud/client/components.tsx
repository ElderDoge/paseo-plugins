import type { PluginButtonContentProps, PluginButtonIconProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { ActivitySnapshot } from "../shared/activity";
import {
  activityPhase,
  describeTool,
  useAgentActivity,
  type ActivityPhase,
} from "./activity-model";

const ICON_BY_PHASE: Record<ActivityPhase, string> = {
  tool: "Zap",
  thinking: "Loader",
  idle: "ListChecks",
};

const MARK_BY_STATUS: Record<string, string> = {
  completed: "✓",
  in_progress: "▶",
  blocked: "!",
  abandoned: "✕",
  pending: "·",
};

const STATUS_TEXT: Record<ActivityPhase, string> = {
  tool: "执行中",
  thinking: "模型响应中",
  idle: "空闲",
};

/** How many finished actions are listed below the current one. */
const HISTORY_LIMIT = 5;

/**
 * `首字 4.6s · 88 tok/s · 缓存命中率 99.81%` — the newest measurable response.
 *
 * The cache share keeps two decimals because the number lives in the last
 * percent: a prompt that is 99.8% cached and one that is 99.99% cached behave
 * very differently.
 */
function describePerformance(performance: NonNullable<ActivitySnapshot["performance"]>): string {
  const seconds = (performance.ttftMs / 1000).toFixed(1);
  const speed = Math.round(performance.tokensPerSecond);
  const cached = (performance.cacheHitRate * 100).toFixed(2);
  return `首字 ${seconds}s · ${speed} tok/s · 缓存命中率 ${cached}%`;
}

export function ActivityIcon(props: PluginButtonIconProps) {
  if (props.context !== "agent") return <Icon name={ICON_BY_PHASE.idle} size={props.size} color={props.color} />;
  const { agentId, size, color, theme } = props;
  const activity = useAgentActivity(agentId);
  if (!activity) return <Icon name={ICON_BY_PHASE.idle} size={size} color={color} />;
  const phase = activityPhase(activity);
  const tint =
    phase === "tool"
      ? theme.colors.accent
      : phase === "thinking"
        ? theme.colors.foreground
        : theme.colors.foregroundMuted;
  return <Icon name={ICON_BY_PHASE[phase]} size={size} color={tint} />;
}

function TodoList({ todo, theme }: { todo: ActivitySnapshot["todo"]; theme: PluginButtonIconProps["theme"] }) {
  if (!todo) return null;
  return (
    <>
      {todo.phases.map((phase) => (
        <View key={phase.name} style={{ gap: 2 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{phase.name}</Text>
          {phase.tasks.map((task) => (
            <Text
              key={task.content}
              style={{
                color: task.status === "in_progress" ? theme.colors.accent : theme.colors.foreground,
                fontSize: 13,
              }}
            >
              {`${MARK_BY_STATUS[task.status] ?? "·"} ${task.content}`}
            </Text>
          ))}
        </View>
      ))}
    </>
  );
}

/**
 * Panel behind the pill: state, current action, the actions before it, then the plan.
 *
 * Deliberately no ScrollView of its own. Paseo renders this inside a surface that
 * already scrolls — a height-capped scrolling panel on desktop, a bottom sheet
 * sized from its content on mobile. A nested scroller hides the content from that
 * measurement, which collapses the mobile sheet to a single line.
 */
export function ActivityPopover(props: PluginButtonContentProps) {
  const { theme, layout } = props;
  const agentId = props.context === "agent" ? props.agentId : "";
  const activity = useAgentActivity(agentId);
  const styles = useMemo(
    () => ({
      body: { gap: layout.compact ? 8 : 12, padding: layout.compact ? 4 : 8, minWidth: 300, maxWidth: 560 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      action: { color: theme.colors.foreground, fontSize: 15 },
      history: { color: theme.colors.foreground, fontSize: 13 },
    }),
    [theme, layout.compact],
  );

  if (!activity) {
    return (
      <View style={styles.body}>
        <Text style={styles.muted}>尚未读到 omp 会话记录。</Text>
      </View>
    );
  }

  const phase = activityPhase(activity);
  const action = describeTool(phase === "tool" ? activity.snapshot.tool : activity.snapshot.recent[0]);
  // The action line above already covers the newest call.
  const historyStart = action ? 1 : 0;
  const history = activity.snapshot.recent.slice(historyStart, historyStart + HISTORY_LIMIT);
  const performance = activity.snapshot.performance;

  return (
    <View style={styles.body}>
      <Text style={styles.muted}>{STATUS_TEXT[phase]}</Text>
      {action ? <Text style={styles.action}>{action}</Text> : null}
      {history.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.muted}>最近动作</Text>
          {history.map((item, index) => (
            <Text key={`${item.startedAt}:${index}`} style={styles.history}>
              {describeTool(item) ?? item.name}
            </Text>
          ))}
        </View>
      ) : null}
      {performance ? <Text style={styles.history}>{describePerformance(performance)}</Text> : null}
      <TodoList todo={activity.snapshot.todo} theme={theme} />
    </View>
  );
}
