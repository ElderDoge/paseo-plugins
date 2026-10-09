import type { PluginButtonContentProps, PluginButtonIconProps } from "@getpaseo/plugin/client";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { commandDescriptions } from "../shared/descriptions";

/** One entry the agent's live session reported. */
interface SessionCommand {
  name: string;
  description: string;
  argumentHint: string;
  kind?: "command" | "skill";
}

type PaletteStep =
  | { kind: "args"; command: SessionCommand }
  | { kind: "description"; command: SessionCommand };

/** Filter by name or by whichever description the user is currently seeing. */
function matchingCommands(
  commands: readonly SessionCommand[],
  filter: string,
  custom: Record<string, string>,
): SessionCommand[] {
  const query = filter.trim().toLowerCase();
  if (query.length === 0) return [...commands];
  return commands.filter(
    (command) =>
      command.name.toLowerCase().includes(query) ||
      (custom[command.name] ?? command.description).toLowerCase().includes(query),
  );
}

export function PaletteIcon({ size, color }: PluginButtonIconProps) {
  return <Icon name="Command" size={size} color={color} />;
}

/**
 * Lists the slash commands and skills the agent's live session reports.
 *
 * A command that cannot run bare asks for arguments first; the rest send on the
 * first press. Either way the text goes out as a prompt, exactly like the composer
 * sending `/name args`, so the provider interprets it as its own command. Each row
 * carries a description editor — which is how the palette gets localised — and a pin
 * that lifts the command above the rest without changing its order.
 */
export function SlashPalette(props: PluginButtonContentProps) {
  const { theme, layout, close } = props;
  const agentId = props.context === "agent" ? props.agentId : null;
  const paseo = usePaseo();
  const settings = useSettings(commandDescriptions);
  const [filter, setFilter] = useState("");
  const [step, setStep] = useState<PaletteStep | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const commands = useQuery({
    queryKey: ["slash-palette", "commands", agentId],
    queryFn: () => paseo.agents.ref(agentId ?? "").commands(),
    enabled: agentId !== null,
    staleTime: 30_000,
    retry: false,
  });

  const styles = useMemo(
    () => ({
      // No scroll view of our own and no height of our own: the host's surface already owns
      // scrolling (a BottomSheetScrollView inside the native sheet, a capped FloatingScrollView
      // in the desktop popover), and both size the content themselves. A second, unbounded
      // scroll view here only swallows the sheet's own scroll gesture and rubber-bands.
      body: { gap: 6, padding: layout.compact ? 4 : 8, minWidth: 340, maxWidth: 560 },
      listBody: { gap: 4 },
      name: { color: theme.colors.foreground, fontSize: 13 },
      hint: { color: theme.colors.foregroundMuted, fontSize: 11, flexShrink: 1 },
      description: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 15 },
      descriptionCustom: { color: theme.colors.foreground, fontSize: 12, lineHeight: 15 },
      tag: { color: theme.colors.accent, fontSize: 10 },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingVertical: 4,
        paddingHorizontal: 6,
        borderRadius: 6,
      },
      rowPinned: { backgroundColor: theme.colors.surface2 },
      rowMain: { flex: 1, gap: 1 },
      rowHead: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      divider: {
        height: 1,
        backgroundColor: theme.colors.border,
        marginVertical: 2,
      },
      action: { color: theme.colors.accent, fontSize: 11 },
      input: {
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface2,
        borderColor: theme.colors.border,
        borderWidth: 1,
        borderRadius: 6,
        paddingVertical: 5,
        paddingHorizontal: 8,
        fontSize: 12,
      },
      back: { color: theme.colors.foregroundMuted, fontSize: 11 },
      actionRow: { flexDirection: "row" as const, gap: 6 },
      primary: { flex: 1, backgroundColor: theme.colors.accent, paddingVertical: 8, borderRadius: 6 },
      primaryText: {
        color: theme.colors.accentForeground,
        fontSize: 12,
        textAlign: "center" as const,
      },
      secondary: {
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      secondaryText: { color: theme.colors.foreground, fontSize: 12 },
      error: { color: theme.colors.statusDanger, fontSize: 11 },
      warning: { color: theme.colors.statusWarning, fontSize: 11 },
      disabled: { opacity: 0.5 },
    }),
    [theme, layout.compact],
  );

  const custom = settings.status === "ready" ? settings.values.descriptions : {};
  const pinned = settings.status === "ready" ? settings.values.pinned : [];
  /** One settings write or send at a time: a second one would carry a stale revision. */
  const busy = sending || settings.saving;

  const send = async (command: SessionCommand, argText: string): Promise<void> => {
    if (agentId === null) return;
    const remainder = argText.trim();
    setSending(true);
    setActionError(null);
    try {
      await paseo.agents.ref(agentId).send(`/${command.name}${remainder ? ` ${remainder}` : ""}`);
      close();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };

  const saveDescriptions = async (descriptions: Record<string, string>): Promise<boolean> => {
    if (settings.status !== "ready") {
      setActionError("设置尚未就绪，请稍后再试。");
      return false;
    }
    setActionError(null);
    return settings.save({ ...settings.values, descriptions }, settings.revision);
  };

  const saveDescription = async (name: string, text: string): Promise<void> => {
    const descriptions = { ...custom };
    const trimmed = text.trim();
    if (trimmed.length === 0) delete descriptions[name];
    else descriptions[name] = trimmed;
    if (await saveDescriptions(descriptions)) setStep(null);
  };

  const togglePin = async (name: string): Promise<void> => {
    if (settings.status !== "ready") {
      setActionError("设置尚未就绪，请稍后再试。");
      return;
    }
    const next = pinned.includes(name)
      ? pinned.filter((pinnedName) => pinnedName !== name)
      : [...pinned, name];
    setActionError(null);
    if (!(await settings.save({ ...settings.values, pinned: next }, settings.revision))) {
      setActionError("固定状态保存失败，请重试。");
    }
  };

  const openArgs = (command: SessionCommand): void => {
    setActionError(null);
    setDraft("");
    setStep({ kind: "args", command });
  };

  const openDescription = (command: SessionCommand): void => {
    setActionError(null);
    setDraft(custom[command.name] ?? "");
    setStep({ kind: "description", command });
  };

  // Providers mark a required argument with `<>` and an optional one with `[]`, so a
  // command that can run bare still sends on the first press; anything else opens the
  // argument step instead of guessing a value.
  const choose = (command: SessionCommand): void => {
    if (command.argumentHint.includes("<")) {
      openArgs(command);
      return;
    }
    void send(command, "");
  };

  const back = (
    <Pressable accessibilityRole="button" onPress={() => setStep(null)}>
      <Text style={styles.back}>← 返回命令列表</Text>
    </Pressable>
  );

  /** Body of both input steps, shared by the inline sheet page and the host's form modal. */
  const renderForm = (active: PaletteStep) => {
    if (active.kind === "args") {
      return (
        <>
          <Text style={styles.description} numberOfLines={3}>
            {custom[active.command.name] ?? active.command.description}
          </Text>
          <TextInput
            autoFocus
            editable={!busy}
            onChangeText={setDraft}
            onSubmitEditing={() => void send(active.command, draft)}
            placeholder={active.command.argumentHint}
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.input}
            value={draft}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`发送 /${active.command.name}`}
            disabled={busy}
            onPress={() => void send(active.command, draft)}
            style={[styles.primary, busy && styles.disabled]}
          >
            <Text style={styles.primaryText}>{sending ? "发送中…" : "发送"}</Text>
          </Pressable>
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
        </>
      );
    }
    const hasCustom = (custom[active.command.name] ?? "").length > 0;
    return (
      <>
        <Text style={styles.description} numberOfLines={3}>
          {active.command.description}
        </Text>
        <TextInput
          autoFocus
          editable={!settings.saving}
          onChangeText={setDraft}
          onSubmitEditing={() => void saveDescription(active.command.name, draft)}
          placeholder="自定义描述，留空表示用原文"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          value={draft}
        />
        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="保存描述"
            disabled={settings.saving}
            onPress={() => void saveDescription(active.command.name, draft)}
            style={[styles.primary, settings.saving && styles.disabled]}
          >
            <Text style={styles.primaryText}>{settings.saving ? "保存中…" : "保存"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="恢复原始描述"
            disabled={settings.saving || !hasCustom}
            onPress={() => void saveDescription(active.command.name, "")}
            style={[styles.secondary, (settings.saving || !hasCustom) && styles.disabled]}
          >
            <Text style={styles.secondaryText}>恢复原文</Text>
          </Pressable>
        </View>
        {settings.status !== "ready" ? (
          <Text style={styles.warning}>设置读取中，暂时无法保存。</Text>
        ) : null}
        {settings.saveError ?? actionError ? (
          <Text style={styles.error}>{settings.saveError ?? actionError}</Text>
        ) : null}
      </>
    );
  };

  // A menu surface handles the keyboard only where it is a sheet, and that is the narrow layout.
  // Everywhere else — an iPad or a desktop window, where the pill opens an anchored popover that
  // never moves — the form goes into the host's `Modal`, the container the app's own forms use:
  // a sheet sized to the area above the keyboard on a phone, a centred card on a tablet.
  const formInModal = layout.platform !== "web" && !layout.compact;
  const formModal =
    step !== null && formInModal ? (
      <Modal
        open
        title={`/${step.command.name}`}
        icon={<Icon name="Command" size={16} color={theme.colors.foregroundMuted} />}
        onOpenChange={(open) => {
          if (!open) setStep(null);
        }}
      >
        <Modal.Content>{renderForm(step)}</Modal.Content>
      </Modal>
    ) : null;

  if (step !== null && !formInModal) {
    return (
      <View style={styles.body}>
        {back}
        <Text style={styles.name}>{`/${step.command.name}`}</Text>
        {renderForm(step)}
      </View>
    );
  }

  if (agentId === null) {
    return (
      <View style={styles.body}>
        <Text style={styles.description}>该位置没有可用的 agent。</Text>
      </View>
    );
  }

  if (commands.isPending) {
    return (
      <View style={styles.body}>
        <Text style={styles.description}>正在读取当前会话的命令…</Text>
      </View>
    );
  }

  if (commands.isError) {
    return (
      <View style={styles.body}>
        <Text style={styles.error}>
          {commands.error instanceof Error ? commands.error.message : String(commands.error)}
        </Text>
      </View>
    );
  }

  const visible = matchingCommands(commands.data.commands, filter, custom);
  const pinnedSet = new Set(pinned);
  const pinnedCommands = visible.filter((command) => pinnedSet.has(command.name));
  const restCommands = visible.filter((command) => !pinnedSet.has(command.name));

  const renderRow = (command: SessionCommand) => {
    const customText = custom[command.name];
    const isPinned = pinnedSet.has(command.name);
    return (
      <View key={command.name} style={[styles.row, isPinned && styles.rowPinned]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`/${command.name}`}
          disabled={busy}
          onPress={() => choose(command)}
          style={[styles.rowMain, busy && styles.disabled]}
        >
          <View style={styles.rowHead}>
            <Text style={styles.name}>{`/${command.name}`}</Text>
            {command.argumentHint ? (
              <Text style={styles.hint} numberOfLines={1}>
                {command.argumentHint}
              </Text>
            ) : null}
            {command.kind === "skill" ? <Text style={styles.tag}>skill</Text> : null}
          </View>
          {customText || command.description ? (
            <Text
              numberOfLines={2}
              style={customText ? styles.descriptionCustom : styles.description}
            >
              {customText ?? command.description}
            </Text>
          ) : null}
        </Pressable>
        {command.argumentHint ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`为 /${command.name} 填写参数`}
            disabled={busy}
            onPress={() => openArgs(command)}
          >
            <Text style={styles.action}>参数</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPinned ? `取消固定 /${command.name}` : `固定 /${command.name}`}
          disabled={busy}
          onPress={() => void togglePin(command.name)}
        >
          <Icon
            name="Pin"
            size={12}
            color={isPinned ? theme.colors.accent : theme.colors.foregroundMuted}
          />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`修改 /${command.name} 的描述`}
          disabled={busy}
          onPress={() => openDescription(command)}
        >
          <Icon name="Pencil" size={12} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>
    );
  };

  return (
    <>
      <View style={styles.body}>
        <TextInput
          editable={!busy}
          onChangeText={setFilter}
          placeholder="过滤命令…"
          placeholderTextColor={theme.colors.foregroundMuted}
          style={styles.input}
          value={filter}
        />
        {commands.data.error ? <Text style={styles.warning}>{commands.data.error}</Text> : null}
        {visible.length === 0 ? (
          <Text style={styles.description}>
            {commands.data.commands.length === 0
              ? "当前会话没有提供斜杠命令。"
              : "没有匹配的命令。"}
          </Text>
        ) : (
          <View style={styles.listBody}>
            {pinnedCommands.map(renderRow)}
            {pinnedCommands.length > 0 && restCommands.length > 0 ? (
              <View style={styles.divider} />
            ) : null}
            {restCommands.map(renderRow)}
          </View>
        )}
        {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      </View>
      {formModal}
    </>
  );
}
