import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { commandDescriptions } from "../shared/descriptions";

/** `name=描述` per line; blank lines and `#` comments are ignored, an empty value clears. */
function parseDescriptions(text: string): Record<string, string> {
  const descriptions: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim().replace(/^\//, "");
    const value = trimmed.slice(separator + 1).trim();
    if (name.length > 0 && value.length > 0) descriptions[name] = value;
  }
  return descriptions;
}

function formatDescriptions(descriptions: Record<string, string>): string {
  return Object.keys(descriptions)
    .sort()
    .map((name) => `${name}=${descriptions[name]}`)
    .join("\n");
}

export function DescriptionSettings({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(commandDescriptions);
  /** `null` mirrors the stored document; a string is the user's unsaved edit. */
  const [draft, setDraft] = useState<string | null>(null);

  const stored = settings.status === "ready" ? settings.values.descriptions : {};
  const text = draft ?? formatDescriptions(stored);
  const count = Object.keys(parseDescriptions(text)).length;

  const styles = useMemo(
    () => ({
      screen: { gap: layout.compact ? 8 : 12, paddingBottom: 24 },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 16 : 18 },
      hint: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      editor: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface2,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
        fontSize: 12,
        lineHeight: 18,
        minHeight: layout.compact ? 220 : 320,
        textAlignVertical: "top" as const,
      },
      actionRow: { flexDirection: "row" as const, gap: 8, flexWrap: "wrap" as const },
      primary: {
        backgroundColor: theme.colors.accent,
        paddingVertical: 9,
        paddingHorizontal: 16,
        borderRadius: 6,
      },
      primaryText: { color: theme.colors.accentForeground, fontSize: 13 },
      secondary: {
        paddingVertical: 9,
        paddingHorizontal: 16,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      secondaryText: { color: theme.colors.foreground, fontSize: 13 },
      status: { color: theme.colors.foregroundMuted, fontSize: 12 },
      error: { color: theme.colors.statusDanger, fontSize: 12 },
      warning: { color: theme.colors.statusWarning, fontSize: 12 },
      disabled: { opacity: 0.5 },
    }),
    [theme, layout.compact],
  );

  const save = async (): Promise<void> => {
    if (settings.status !== "ready") return;
    if (await settings.save({ ...settings.values, descriptions: parseDescriptions(text) }, settings.revision)) {
      setDraft(null);
    }
  };

  const clearDescriptions = async (): Promise<void> => {
    if (settings.status !== "ready") return;
    if (await settings.save({ ...settings.values, descriptions: {} }, settings.revision)) {
      setDraft(null);
    }
  };

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>命令描述</Text>
      <Text style={styles.hint}>
        每行一条 `命令名=描述`，命令名可以带或不带开头的斜杠。描述留空表示恢复
        provider 原文；以 # 开头的行会被忽略。在斜杠命令面板里点某个命令右侧的铅笔图标，也能单独改它的描述；
        固定/取消固定在命令面板里直接操作，本页不会动到固定项。
      </Text>
      <TextInput
        multiline
        onChangeText={setDraft}
        placeholder={"compact=压缩对话\ncontext=查看上下文占用"}
        placeholderTextColor={theme.colors.foregroundMuted}
        style={styles.editor}
        value={text}
      />
      <Text style={styles.status}>{`已填 ${count} 条`}</Text>
      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="保存命令描述"
          disabled={settings.saving}
          onPress={() => void save()}
          style={[styles.primary, settings.saving && styles.disabled]}
        >
          <Text style={styles.primaryText}>{settings.saving ? "保存中…" : "保存"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="放弃未保存的修改"
          disabled={draft === null}
          onPress={() => setDraft(null)}
          style={[styles.secondary, draft === null && styles.disabled]}
        >
          <Text style={styles.secondaryText}>放弃修改</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="清空全部命令描述"
          disabled={settings.saving || Object.keys(stored).length === 0}
          onPress={() => void clearDescriptions()}
          style={[
            styles.secondary,
            (settings.saving || Object.keys(stored).length === 0) && styles.disabled,
          ]}
        >
          <Text style={styles.secondaryText}>全部清除</Text>
        </Pressable>
      </View>
      {settings.status === "invalid" ? (
        <View style={styles.actionRow}>
          <Text style={styles.warning}>
            {`存储的内容无法解析：${settings.error}。可以整体重置为默认值。`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重置插件设置"
            onPress={() => void settings.reset()}
            style={styles.secondary}
          >
            <Text style={styles.secondaryText}>重置存储</Text>
          </Pressable>
        </View>
      ) : null}
      {settings.status === "error" ? <Text style={styles.error}>{settings.error}</Text> : null}
      {settings.status === "loading" ? <Text style={styles.status}>正在读取…</Text> : null}
      {settings.saveError ? <Text style={styles.error}>{settings.saveError}</Text> : null}
    </View>
  );
}
