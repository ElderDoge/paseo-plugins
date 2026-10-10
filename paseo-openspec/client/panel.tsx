import type { PluginHostProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, copyText, useToast } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { LayoutChangeEvent, TextStyle, ViewStyle } from "react-native";
import type { ChangeDocument, ChangeSummary, DocumentKind } from "../shared/openspec";
import { MAX_DOCUMENT_BYTES, documentRpc, listRpc } from "../shared/openspec";
import { STATUS_LABEL, formatRelativeTime } from "./format";
import { Markdown } from "./markdown";

type PanelTheme = PluginHostProps["theme"];

const TAB_ICON: Record<DocumentKind, string> = {
  proposal: "ScrollText",
  design: "FileDiff",
  tasks: "SquareCheck",
  spec: "FileText",
};

/** Names of the three artifacts as the tabs show them. */
const ARTIFACT_LABEL: Record<"proposal" | "design" | "tasks", string> = {
  proposal: "提案",
  design: "设计",
  tasks: "任务",
};

/** Tab text of one document; an artifact that has not been written says so. */
function documentLabel(document: ChangeDocument): string {
  if (document.kind === "spec") return `规格：${document.label}`;
  const name = ARTIFACT_LABEL[document.kind];
  return document.exists ? name : `${name}（尚未创建）`;
}

/** Tab the detail pane reads: the selected document, else the first one present. */
function activePathOf(documents: ChangeDocument[], selectedPath: string | null): string | null {
  const selected = documents.find((document) => document.path === selectedPath && document.exists);
  if (selected !== undefined) return selected.path;
  return documents.find((document) => document.exists)?.path ?? null;
}

/**
 * Panel width below which one column is shown at a time.
 *
 * The host's `layout.compact` only tracks the form factor, so the Explorer
 * sidebar — a narrow pane in a wide window — has to be measured here.
 */
const NARROW_PANEL_WIDTH = 720;

/** Where the CLI was looked for, short enough for one hint line. */
function shortenDirs(dirs: string[]): string {
  const shown = dirs.slice(0, 4).join("、");
  return dirs.length > 4 ? `${shown} 等 ${dirs.length} 个目录` : shown;
}

/** Completed share of a change's task list, 0 to 100. */
function taskPercent(completed: number, total: number): number {
  return total > 0 ? Math.round((completed / total) * 100) : 0;
}

/**
 * One row of the copy menu. `command` is the slash command the row copies, or
 * `null` for the bare change id; the row's text is what it copies, so the menu
 * never promises something other than what lands on the clipboard.
 */
interface CopyTarget {
  icon: string;
  command: string | null;
}

/** Rows of the copy menu: the bare id, then the commands that take one. */
const COPY_TARGETS: readonly CopyTarget[] = [
  { icon: "ClipboardCopy", command: null },
  { icon: "Play", command: "/opsx-apply" },
  { icon: "Archive", command: "/opsx-archive" },
  { icon: "ShieldCheck", command: "/opsx-verify" },
];

interface PanelStyles {
  screen: ViewStyle;
  header: ViewStyle;
  headerText: ViewStyle;
  headerTitle: TextStyle;
  headerSubtitle: TextStyle;
  refresh: ViewStyle;
  refreshText: TextStyle;
  columns: ViewStyle;
  listPane: ViewStyle;
  listScroll: ViewStyle;
  listContent: ViewStyle;
  changeRow: ViewStyle;
  changeRowActive: ViewStyle;
  changeRowHead: ViewStyle;
  changeId: TextStyle;
  changeIdActive: TextStyle;
  changeStatus: TextStyle;
  changeSummary: TextStyle;
  changeMeta: ViewStyle;
  progressTrack: ViewStyle;
  progressFill: ViewStyle;
  changeProgress: TextStyle;
  detail: ViewStyle;
  detailHeader: ViewStyle;
  detailHeadRow: ViewStyle;
  changeIdGroup: ViewStyle;
  copyButton: ViewStyle;
  copyMenu: ViewStyle;
  copyMenuItem: ViewStyle;
  copyMenuItemPressed: ViewStyle;
  copyMenuText: TextStyle;
  detailSummary: TextStyle;
  documentScroll: ViewStyle;
  documentContent: ViewStyle;
  documentBody: ViewStyle;
  tabScroll: ViewStyle;
  tabs: ViewStyle;
  tab: ViewStyle;
  tabActive: ViewStyle;
  tabMissing: ViewStyle;
  tabText: TextStyle;
  tabTextActive: TextStyle;
  muted: TextStyle;
  warning: TextStyle;
  error: TextStyle;
  notice: ViewStyle;
  noticeTitle: TextStyle;
  noticeDetail: TextStyle;
  noticeHint: TextStyle;
  button: ViewStyle;
  buttonText: TextStyle;
  disabled: ViewStyle;
}

function createStyles(theme: PanelTheme, narrow: boolean, width: number): PanelStyles {
  const muted: TextStyle = { color: theme.colors.foregroundMuted, fontSize: 12 };
  /**
   * Definite width for the copy menu: it hangs over the document, so it has to
   * fit the pane it is anchored in. `width` is 0 until the panel is measured.
   */
  const menuWidth = Math.max(150, Math.min(240, (width || 280) - (narrow ? 12 : 16) * 2 - 8));
  return {
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      paddingHorizontal: narrow ? 12 : 16,
      paddingVertical: narrow ? 10 : 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    headerText: { flex: 1, minWidth: 0, gap: 2 },
    headerTitle: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" },
    headerSubtitle: { ...muted, fontSize: 11 },
    refresh: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, minHeight: 36, paddingHorizontal: 6, flexShrink: 0 },
    refreshText: { color: theme.colors.foregroundMuted, fontSize: 12 },
    columns: { flex: 1, minHeight: 0, minWidth: 0, flexDirection: "row" },
    listPane: {
      width: Math.min(260, Math.max(200, width * 0.26)),
      flexGrow: 0,
      flexShrink: 0,
      borderRightWidth: 1,
      borderRightColor: theme.colors.border,
    },
    listScroll: { flex: 1 },
    listContent: { padding: narrow ? 8 : 10, gap: 6 },
    changeRow: {
      gap: 4,
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface1,
    },
    changeRowActive: {
      borderColor: theme.colors.accent,
      backgroundColor: theme.colors.surface2,
    },
    changeRowHead: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    changeId: { color: theme.colors.foreground, fontSize: 13, flexShrink: 1 },
    changeIdActive: { color: theme.colors.accent, fontWeight: "600" },
    changeStatus: { color: theme.colors.foregroundMuted, fontSize: 11 },
    changeSummary: { ...muted, lineHeight: 16 },
    changeMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
    progressTrack: {
      flex: 1,
      flexDirection: "row",
      height: 4,
      borderRadius: 2,
      backgroundColor: theme.colors.surface2,
      overflow: "hidden",
    },
    progressFill: { backgroundColor: theme.colors.accent, borderRadius: 2 },
    changeProgress: { ...muted, fontSize: 11 },
    detail: { flex: 1, minWidth: 0, minHeight: 0 },
    detailHeader: {
      gap: 6,
      paddingHorizontal: narrow ? 12 : 16,
      paddingVertical: narrow ? 10 : 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      // The copy menu hangs below this header, over the tabs and the document.
      zIndex: 1,
    },
    detailHeadRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
    changeIdGroup: { flexDirection: "row", alignItems: "center", flexShrink: 1, minWidth: 0, gap: 2 },
    // A definite size keeps the tap target square next to a long change id.
    copyButton: {
      flexShrink: 0,
      width: 20,
      height: 20,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 4,
    },
    copyMenu: {
      position: "absolute",
      top: "100%",
      right: narrow ? 12 : 16,
      marginTop: 4,
      zIndex: 2,
      width: menuWidth,
      padding: 4,
      gap: 2,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface2,
      shadowColor: "#000000",
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },
    copyMenuItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderRadius: 6,
      minWidth: 0,
    },
    copyMenuItemPressed: { backgroundColor: theme.colors.surface1 },
    copyMenuText: { color: theme.colors.foreground, fontSize: 12, flexShrink: 1 },
    detailSummary: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
    documentScroll: { flex: 1 },
    documentContent: { padding: narrow ? 12 : 16 },
    documentBody: { gap: 8 },
    tabScroll: {
      flexGrow: 0,
      flexShrink: 0,
      height: narrow ? 44 : 40,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
    },
    tabs: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: narrow ? 12 : 16,
      paddingVertical: 4,
    },
    tab: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      height: narrow ? 36 : 32,
      flexGrow: 0,
      flexShrink: 0,
      alignSelf: "center",
      paddingHorizontal: 8,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface1,
    },
    tabActive: { borderColor: theme.colors.accent, backgroundColor: theme.colors.surface2 },
    tabMissing: { opacity: 0.45, borderStyle: "dashed" },
    tabText: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 16 },
    tabTextActive: { color: theme.colors.accent },
    muted,
    warning: { color: theme.colors.statusWarning, fontSize: 12, lineHeight: 17 },
    error: { color: theme.colors.statusDanger, fontSize: 12, lineHeight: 17 },
    notice: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      padding: 24,
      backgroundColor: theme.colors.surface0,
    },
    noticeTitle: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" },
    noticeDetail: { ...muted, textAlign: "center", lineHeight: 17 },
    noticeHint: { ...muted, textAlign: "center", lineHeight: 17, opacity: 0.9 },
    button: {
      marginTop: 4,
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: 8,
      backgroundColor: theme.colors.accent,
    },
    buttonText: { color: theme.colors.accentForeground, fontSize: 13 },
    disabled: { opacity: 0.5 },
  };
}

interface NoticeProps {
  theme: PanelTheme;
  styles: PanelStyles;
  icon: string;
  title: string;
  detail?: string;
  hint?: string;
  onRefresh?: () => void;
  busy?: boolean;
  onMeasure?: (width: number) => void;
}

/** Full-panel state for anything that is not a change list. */
function Notice({
  theme,
  styles,
  icon,
  title,
  detail,
  hint,
  onRefresh,
  busy,
  onMeasure,
}: NoticeProps) {
  return (
    <View
      style={styles.notice}
      onLayout={
        onMeasure === undefined
          ? undefined
          : (event: LayoutChangeEvent) => onMeasure(event.nativeEvent.layout.width)
      }
    >
      <Icon name={icon} size={22} color={theme.colors.foregroundMuted} />
      <Text style={styles.noticeTitle}>{title}</Text>
      {detail ? <Text style={styles.noticeDetail}>{detail}</Text> : null}
      {hint ? <Text style={styles.noticeHint}>{hint}</Text> : null}
      {onRefresh ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="刷新"
          disabled={busy === true}
          onPress={onRefresh}
          style={[styles.button, busy === true ? styles.disabled : null]}
        >
          <Text style={styles.buttonText}>{busy === true ? "刷新中…" : "刷新"}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface ChangeHeaderProps {
  change: ChangeSummary;
  styles: PanelStyles;
  theme: PanelTheme;
}

/** Selected change: identity, task progress, and when it last changed. */
function ChangeHeader({ change, styles, theme }: ChangeHeaderProps) {
  const percent = taskPercent(change.completedTasks, change.totalTasks);
  const [menuOpen, setMenuOpen] = useState(false);
  const toast = useToast();
  const copy = async (text: string): Promise<void> => {
    try {
      await copyText(text);
      toast.show(`已复制 ${text}`, { variant: "success" });
    } catch (error) {
      toast.error(`复制失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return (
    <View style={styles.detailHeader}>
      <View style={styles.detailHeadRow}>
        <View style={styles.changeIdGroup}>
          <Text numberOfLines={1} style={[styles.changeId, styles.changeIdActive]}>
            {change.id}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="复制变更名"
            accessibilityState={{ expanded: menuOpen }}
            onPress={() => setMenuOpen((open) => !open)}
            style={styles.copyButton}
          >
            <Icon
              name="Copy"
              size={13}
              color={menuOpen ? theme.colors.accent : theme.colors.foregroundMuted}
            />
          </Pressable>
        </View>
        <Text style={styles.changeStatus}>{STATUS_LABEL[change.status]}</Text>
      </View>
      {change.summary ? <Text numberOfLines={2} style={styles.detailSummary}>{change.summary}</Text> : null}
      <View style={styles.changeMeta}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { flex: percent }]} />
          <View style={{ flex: 100 - percent }} />
        </View>
        <Text style={styles.changeProgress}>
          {change.totalTasks > 0
            ? `${change.completedTasks}/${change.totalTasks} 项任务`
            : "没有任务清单"}
        </Text>
        <Text style={styles.changeProgress}>{formatRelativeTime(change.lastModified)}</Text>
      </View>
      {menuOpen ? (
        <View style={styles.copyMenu}>
          {COPY_TARGETS.map((target) => {
            const text = target.command === null ? change.id : `${target.command} ${change.id}`;
            return (
              <Pressable
                key={text}
                accessibilityRole="button"
                accessibilityLabel={`复制 ${text}`}
                onPress={() => {
                  setMenuOpen(false);
                  void copy(text);
                }}
                style={({ pressed }) => [
                  styles.copyMenuItem,
                  pressed ? styles.copyMenuItemPressed : null,
                ]}
              >
                <Icon name={target.icon} size={12} color={theme.colors.foregroundMuted} />
                <Text numberOfLines={1} style={styles.copyMenuText}>
                  {text}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

interface DocumentTabsProps {
  documents: ChangeDocument[];
  activePath: string | null;
  styles: PanelStyles;
  theme: PanelTheme;
  onSelect(path: string): void;
}

/** Tabs for the documents this change holds: the three Markdown artifacts, then its specs. */
function DocumentTabs({ documents, activePath, styles, theme, onSelect }: DocumentTabsProps) {
  if (documents.every((document) => !document.exists)) {
    return <Text style={styles.muted}>这个变更目录下还没有可读文档。</Text>;
  }
  return (
    <ScrollView horizontal style={styles.tabScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
      {documents.map((tab) => {
        const active = tab.path === activePath;
        const missing = !tab.exists;
        return (
          <Pressable
            key={tab.path}
            accessibilityRole="button"
            accessibilityLabel={documentLabel(tab)}
            accessibilityState={{ disabled: missing, selected: active }}
            disabled={missing}
            onPress={() => onSelect(tab.path)}
            style={[styles.tab, active ? styles.tabActive : null, missing ? styles.tabMissing : null]}
          >
            <Icon
              name={TAB_ICON[tab.kind]}
              size={12}
              color={active ? theme.colors.accent : theme.colors.foregroundMuted}
            />
            <Text numberOfLines={1} style={[styles.tabText, active ? styles.tabTextActive : null]}>
              {documentLabel(tab)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * OpenSpec panel: the workspace's active changes with their task progress, and
 * a Markdown reader for the proposal, design, tasks, and spec documents.
 *
 * Both panel locations register this component: beside the agents and terminals
 * on wide layouts, and in the narrow Explorer, where one change fills the panel
 * and the list can be toggled without losing the selected document.
 */
export function OpenspecPanel(props: PluginWorkspacePanelProps) {
  const { theme, layout, workspaceId } = props;
  const [width, setWidth] = useState(0);
  const narrow = layout.compact || (width > 0 && width < NARROW_PANEL_WIDTH);
  const styles = useMemo(() => createStyles(theme, narrow, width), [theme, narrow, width]);
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const list = useRpc(listRpc);
  const readDocument = useRpc(documentRpc);
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [listVisible, setListVisible] = useState(true);
  const directoryValue = directory ?? "";

  const query = useQuery({
    queryKey: ["openspec", "list", directoryValue],
    queryFn: () => list({ directory: directoryValue }),
    enabled: directoryValue.length > 0,
    staleTime: 15_000,
    retry: false,
  });

  const activeChanges = query.data?.status === "ok" ? query.data.changes : [];
  const change =
    activeChanges.find((entry) => entry.id === selectedChangeId) ??
    activeChanges[0] ?? null;
  const documents = change?.documents ?? [];
  const activePath = activePathOf(documents, selectedPath);

  const documentQuery = useQuery({
    queryKey: ["openspec", "document", directoryValue, activePath],
    queryFn: () => readDocument({ directory: directoryValue, path: activePath ?? "" }),
    enabled: directoryValue.length > 0 && activePath !== null,
    staleTime: 30_000,
    retry: false,
  });

  const busy = query.isFetching || documentQuery.isFetching;
  /**
   * Refresh runs the list first, so a root that moved or lost documents is
   * resolved before the current document is read again: the document request is
   * either keyed on the freshly derived path, or re-run for the path it already had.
   */
  const refresh = async (): Promise<void> => {
    const refreshed = await query.refetch();
    const data = refreshed.data;
    const freshChanges = data?.status === "ok" ? data.changes : [];
    const freshChange =
      freshChanges.find((entry) => entry.id === change?.id) ?? freshChanges[0] ?? null;
    const freshPath = activePathOf(freshChange?.documents ?? [], selectedPath);
    if (freshPath === activePath) {
      if (freshPath !== null) await documentQuery.refetch();
      return;
    }
    // A different document is current now; the query keyed on it fetches on render.
    setSelectedPath(freshPath);
  };
  const openChange = (id: string) => {
    setSelectedChangeId(id);
    setSelectedPath(null);
    if (narrow) setListVisible(false);
  };

  if (directoryValue.length === 0) {
    return (
      <Notice
        theme={theme}
        styles={styles}
        icon="FolderTree"
        title="正在读取工作区目录…"
        onMeasure={setWidth}
      />
    );
  }
  if (query.isError) {
    return (
      <Notice
        theme={theme}
        styles={styles}
        icon="AlertTriangle"
        title="读取 OpenSpec 变更失败"
        detail={query.error instanceof Error ? query.error.message : String(query.error)}
        onRefresh={refresh}
        busy={busy}
        onMeasure={setWidth}
      />
    );
  }
  if (query.data === undefined) {
    return (
      <Notice
        theme={theme}
        styles={styles}
        icon="Loader"
        title="正在读取 OpenSpec 变更…"
        onMeasure={setWidth}
      />
    );
  }
  if (query.data.status === "cli-missing") {
    return (
      <Notice
        theme={theme}
        styles={styles}
        icon="AlertTriangle"
        title="未找到 openspec-cn 命令"
        detail={query.data.message}
        hint={`已查找：${shortenDirs(query.data.searched)}`}
        onRefresh={refresh}
        busy={busy}
        onMeasure={setWidth}
      />
    );
  }
  if (query.data.status === "missing") {
    return (
      <Notice
        theme={theme}
        styles={styles}
        icon="FolderTree"
        title="当前工作区没有 OpenSpec 目录"
        detail={query.data.message}
        hint="在项目根目录运行 openspec-cn init 后刷新。"
        onRefresh={refresh}
        busy={busy}
        onMeasure={setWidth}
      />
    );
  }
  if (query.data.status === "error") {
    return (
      <Notice
        theme={theme}
        styles={styles}
        icon="AlertTriangle"
        title="读取 OpenSpec 变更失败"
        detail={query.data.message}
        onRefresh={refresh}
        busy={busy}
        onMeasure={setWidth}
      />
    );
  }
  const { changes, root } = query.data;

  const renderDocumentBody = (): ReactNode => {
    if (activePath === null) {
      return <Text style={styles.muted}>这个变更没有可打开的文档。</Text>;
    }
    if (documentQuery.isError) {
      return (
        <Text style={styles.error}>
          {documentQuery.error instanceof Error
            ? documentQuery.error.message
            : String(documentQuery.error)}
        </Text>
      );
    }
    const result = documentQuery.data;
    if (result === undefined) return <Text style={styles.muted}>正在读取文档…</Text>;
    switch (result.status) {
      case "ok":
        return (
          <View style={styles.documentBody}>
            <Markdown content={result.content} theme={theme} compact={narrow} />
            {result.truncated ? (
              <Text style={styles.warning}>
                {`文档太大，只显示前 ${Math.round(MAX_DOCUMENT_BYTES / 1024)}KB（共 ${Math.round(result.bytes / 1024)}KB）。`}
              </Text>
            ) : null}
          </View>
        );
      case "missing":
        return <Text style={styles.muted}>文档不存在，可能已被删除或移动，刷新后再试。</Text>;
      case "denied":
        return <Text style={styles.error}>{result.message}</Text>;
      case "error":
        return <Text style={styles.error}>{result.message}</Text>;
    }
  };

  const renderChangeRow = (entry: ChangeSummary) => {
    const active = entry.id === change?.id;
    const percent = taskPercent(entry.completedTasks, entry.totalTasks);
    return (
      <Pressable
        key={entry.id}
        accessibilityRole="button"
        accessibilityLabel={`打开变更 ${entry.id}`}
        onPress={() => openChange(entry.id)}
        style={[styles.changeRow, active ? styles.changeRowActive : null]}
      >
        <View style={styles.changeRowHead}>
          <Text
            numberOfLines={1}
            style={[styles.changeId, active ? styles.changeIdActive : null]}
          >
            {entry.id}
          </Text>
          <Text style={styles.changeStatus}>{STATUS_LABEL[entry.status]}</Text>
        </View>
        {entry.summary ? (
          <Text numberOfLines={2} style={styles.changeSummary}>
            {entry.summary}
          </Text>
        ) : null}
        <View style={styles.changeMeta}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { flex: percent }]} />
            <View style={{ flex: 100 - percent }} />
          </View>
          <Text style={styles.changeProgress}>
            {entry.totalTasks > 0 ? `${entry.completedTasks}/${entry.totalTasks}` : "无任务"}
          </Text>
          <Text style={styles.changeProgress}>{formatRelativeTime(entry.lastModified)}</Text>
        </View>
      </Pressable>
    );
  };

  const listRows = changes.map(renderChangeRow);
  const detail =
    change === null ? null : (
      <View style={styles.detail}>
        <ChangeHeader key={change.id} change={change} styles={styles} theme={theme} />
        <DocumentTabs
          documents={documents}
          activePath={activePath}
          styles={styles}
          theme={theme}
          onSelect={setSelectedPath}
        />
        <ScrollView style={styles.documentScroll} contentContainerStyle={styles.documentContent}>
          {renderDocumentBody()}
        </ScrollView>
      </View>
    );

  return (
    <View
      style={styles.screen}
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
    >
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>OpenSpec 变更</Text>
          <Text numberOfLines={1} style={styles.headerSubtitle}>
            {`${root} · ${changes.length} 个活跃变更`}
          </Text>
        </View>
        {changes.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={listVisible ? (narrow ? "查看文档" : "隐藏变更列表") : "显示变更列表"}
            accessibilityState={{ expanded: listVisible }}
            onPress={() => setListVisible((visible) => !visible)}
            style={styles.refresh}
          >
            <Icon name={listVisible ? "BookOpen" : "ListTree"} size={14} color={theme.colors.foregroundMuted} />
            <Text style={styles.refreshText}>
              {listVisible ? (narrow ? "文档" : "隐藏列表") : (narrow ? "变更" : "显示列表")}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="刷新 OpenSpec 变更"
          disabled={busy}
          onPress={() => void refresh()}
          style={[styles.refresh, busy ? styles.disabled : null]}
        >
          <Icon name="RefreshCw" size={14} color={theme.colors.foregroundMuted} />
          <Text style={styles.refreshText}>{busy ? "刷新中…" : "刷新"}</Text>
        </Pressable>
      </View>
      {changes.length === 0 ? (
        <Notice
          theme={theme}
          styles={styles}
          icon="BookOpen"
          title="没有活跃的变更"
          detail="openspec/changes 下没有未归档的变更。"
          hint="创建新变更后刷新即可看到。"
          onRefresh={refresh}
          busy={busy}
          onMeasure={setWidth}
        />
      ) : narrow ? (
        listVisible || detail === null ? (
          <ScrollView style={styles.listScroll} contentContainerStyle={styles.listContent}>
            {listRows}
          </ScrollView>
        ) : (
          detail
        )
      ) : (
        <View style={styles.columns}>
          {listVisible ? (
            <ScrollView style={styles.listPane} contentContainerStyle={styles.listContent}>
              {listRows}
            </ScrollView>
          ) : null}
          {detail ?? <Text style={styles.muted}>选择左侧的变更查看文档。</Text>}
        </View>
      )}
    </View>
  );
}
