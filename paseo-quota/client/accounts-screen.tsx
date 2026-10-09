import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text, View } from "react-native";
import type { Account } from "../shared/settings";
import { PROVIDER_KEY_HELP, PROVIDER_KEY_PLACEHOLDER, settingsDefinition } from "../shared/settings";
import { countByProvider, emptyAccount, PROVIDER_OPTIONS, savedAccounts } from "./accounts-model";

/**
 * 一把密钥一张卡片：选服务商、粘贴密钥，同一服务商有多把密钥时再起个名字。
 * 各用量源每次都会重读这些值，所以保存后用量面板即可刷新。
 */
export function AccountsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(settingsDefinition);
  const [draft, setDraft] = useState<Account[] | null>(null);
  // 输入框只在挂载时读取一次初值，因此凡是列表结构变化——保存、放弃、增删行——都递增
  // 这个版本号，让输入框重新挂载并显示草稿里的值。
  const [edition, setEdition] = useState(0);
  const stored = settings.status === "ready" ? settings.values.accounts : [];
  const accounts = draft ?? stored;
  const revision = settings.status === "ready" ? settings.revision : null;
  const dirty = draft !== null;
  const counts = countByProvider(accounts);

  // 别的客户端保存过密钥：没有本地修改就跟着显示已保存的值。
  const [seenRevision, setSeenRevision] = useState(revision);
  if (revision !== seenRevision) {
    setSeenRevision(revision);
    if (!dirty) setEdition((value) => value + 1);
  }

  const patch = (index: number, changes: Partial<Account>) =>
    setDraft(accounts.map((account, at) => (at === index ? { ...account, ...changes } : account)));
  const remove = (index: number) => {
    setDraft(accounts.filter((_, at) => at !== index));
    setEdition((value) => value + 1);
  };
  const add = () => {
    setDraft([...accounts, emptyAccount()]);
    setEdition((value) => value + 1);
  };

  const save = async () => {
    if (!revision) return;
    if (await settings.save({ accounts: savedAccounts(accounts) }, revision)) {
      setDraft(null);
      setEdition((value) => value + 1);
    }
  };

  const discard = () => {
    setDraft(null);
    setEdition((value) => value + 1);
    void settings.reload();
  };

  if (settings.status === "loading") {
    return <Text style={{ color: theme.colors.foregroundMuted }}>正在读取已保存的密钥…</Text>;
  }

  if (settings.status !== "ready") {
    return (
      <SettingsSection title="服务商密钥">
        <SettingsCard>
          <SettingsAction
            label="无法读取已保存的密钥"
            error={settings.error}
            actionLabel="重试"
            disabled={settings.saving}
            onPress={() => void settings.reload()}
          />
          {settings.status === "invalid" ? (
            <SettingsAction
              label="清空密钥列表"
              hint="已保存的内容与本插件的版本不匹配。"
              actionLabel="重置"
              disabled={settings.saving}
              onPress={() => void settings.reset()}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
    );
  }

  return (
    <View style={{ gap: 24 }}>
      <SettingsSection
        title="服务商密钥"
        info="额度由本机用这些密钥直接向各服务商查询。密钥只留在本机，Paseo 只显示用量数字。"
      >
        {accounts.length === 0 ? (
          <SettingsCard>
            <SettingsRow label="还没有密钥" hint="每个想查看额度的账号，加一把密钥即可。" />
          </SettingsCard>
        ) : null}
        {accounts.map((account, index) => (
          <SettingsCard key={`${edition}-${index}`}>
            <SettingsSelect
              label={`账号 ${index + 1}`}
              value={account.provider}
              options={PROVIDER_OPTIONS}
              disabled={settings.saving}
              onValueChange={(provider) => patch(index, { provider })}
            />
            <SettingsInput
              label="密钥"
              hint={PROVIDER_KEY_HELP[account.provider]}
              placeholder={PROVIDER_KEY_PLACEHOLDER[account.provider]}
              initialValue={account.apiKey}
              secureTextEntry
              disabled={settings.saving}
              onChangeText={(apiKey) => patch(index, { apiKey })}
            />
            <SettingsInput
              label="名称"
              hint={
                counts[account.provider] > 1
                  ? "显示在用量卡片上，用来区分同一服务商的多把密钥。"
                  : "可选，会显示在用量卡片上。"
              }
              initialValue={account.label ?? ""}
              disabled={settings.saving}
              onChangeText={(label) => patch(index, { label })}
            />
            <SettingsAction
              label="删除"
              actionLabel="删除这把密钥"
              disabled={settings.saving}
              onPress={() => remove(index)}
            />
          </SettingsCard>
        ))}
        <SettingsCard>
          <SettingsAction label="添加密钥" actionLabel="添加" disabled={settings.saving} onPress={add} />
          <SettingsAction
            label={dirty ? "有未保存的修改" : "已全部保存"}
            actionLabel={settings.saving ? "保存中…" : "保存"}
            disabled={!dirty || settings.saving}
            onPress={() => void save()}
          />
          {dirty ? (
            <SettingsAction
              label="放弃这些修改"
              actionLabel="放弃"
              disabled={settings.saving}
              onPress={discard}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
      {settings.saveError ? (
        <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
          {settings.saveError}
        </Text>
      ) : null}
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        密钥保存在本机，只用于读取各服务商自己的用量接口。用量显示在左侧栏的用量面板中，
        每个服务商一组；配置在这里对所有工作区生效。
      </Text>
    </View>
  );
}
