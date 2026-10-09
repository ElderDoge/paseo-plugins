import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AccountsScreen } from "./client/accounts-screen";

/** Paseo 会把这里注册的界面渲染在插件设置里，与其它插件的设置页并列。 */
export default function contribute(client: PluginClientContext) {
  return client.addSettingsScreen({
    id: "accounts",
    title: "服务商密钥",
    icon: "KeyRound",
    Component: AccountsScreen,
  });
}
