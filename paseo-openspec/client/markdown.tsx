import type { PluginHostProps } from "@getpaseo/plugin/client";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { TextStyle, ViewStyle } from "react-native";
import type { ListItem, MarkdownBlock } from "./markdown-parse";
import { parseInline, parseMarkdown } from "./markdown-parse";

type PanelTheme = PluginHostProps["theme"];

/** Every style the renderer reads, named so a rename shows up as a type error. */
interface MarkdownStyles {
  body: ViewStyle;
  h1: TextStyle;
  h2: TextStyle;
  h3: TextStyle;
  paragraph: TextStyle;
  quote: ViewStyle;
  quoteText: TextStyle;
  code: TextStyle;
  codeBlock: ViewStyle;
  language: TextStyle;
  rule: ViewStyle;
  list: ViewStyle;
  listItem: ViewStyle;
  listMarker: TextStyle;
  listText: TextStyle;
  listTextDone: TextStyle;
  table: ViewStyle;
  tableRow: ViewStyle;
  tableCell: ViewStyle;
  tableHeaderCell: ViewStyle;
  tableHeaderText: TextStyle;
  tableCellText: TextStyle;
  inlineCode: TextStyle;
  bold: TextStyle;
  italic: TextStyle;
  link: TextStyle;
}

function createStyles(theme: PanelTheme, compact: boolean): MarkdownStyles {
  const body: TextStyle = {
    color: theme.colors.foreground,
    fontSize: 14,
    lineHeight: compact ? 21 : 22,
  };
  return {
    body: { gap: compact ? 8 : 10 },
    h1: { color: theme.colors.foreground, fontSize: compact ? 19 : 21, fontWeight: "600" },
    h2: { color: theme.colors.foreground, fontSize: compact ? 17 : 18, fontWeight: "600" },
    h3: { color: theme.colors.foreground, fontSize: compact ? 15 : 16, fontWeight: "600" },
    paragraph: body,
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: theme.colors.border,
      paddingLeft: 10,
      gap: 4,
    },
    quoteText: { ...body, color: theme.colors.foregroundMuted },
    code: { color: theme.colors.foreground, fontFamily: "Menlo", fontSize: 12.5, lineHeight: 18 },
    codeBlock: {
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 10,
      gap: 2,
    },
    language: { color: theme.colors.foregroundMuted, fontSize: 11 },
    rule: { height: 1, backgroundColor: theme.colors.border, marginVertical: 4 },
    list: { gap: 4 },
    listItem: { flexDirection: "row", gap: 8 },
    listMarker: {
      color: theme.colors.foregroundMuted,
      fontSize: 13,
      lineHeight: 22,
      minWidth: 18,
      textAlign: "right",
    },
    listText: { ...body, flex: 1 },
    listTextDone: { color: theme.colors.foregroundMuted, textDecorationLine: "line-through" },
    table: {
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      overflow: "hidden",
    },
    tableRow: { flexDirection: "row", alignItems: "stretch" },
    tableCell: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, minWidth: 0 },
    tableHeaderCell: { backgroundColor: theme.colors.surface2 },
    tableHeaderText: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" },
    tableCellText: { color: theme.colors.foreground, fontSize: 13, lineHeight: 19 },
    inlineCode: { color: theme.colors.accent, fontFamily: "Menlo", fontSize: 13 },
    bold: { fontWeight: "600" },
    italic: { fontStyle: "italic" },
    link: { color: theme.colors.accent },
  };
}

/** Renders the styled runs of one line of prose. */
function renderInline(text: string, styles: MarkdownStyles, keyPrefix: string): ReactNode[] {
  return parseInline(text).map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.kind) {
      case "text":
        return token.text;
      case "code":
        return (
          <Text key={key} style={styles.inlineCode}>
            {token.text}
          </Text>
        );
      case "bold":
        return (
          <Text key={key} style={styles.bold}>
            {token.text}
          </Text>
        );
      case "italic":
        return (
          <Text key={key} style={styles.italic}>
            {token.text}
          </Text>
        );
      case "link":
        return (
          <Text key={key} style={styles.link}>
            {token.text}
          </Text>
        );
    }
  });
}

/** Leading marker of one list entry: a checkbox for tasks, otherwise a bullet or number. */
function listMarker(item: ListItem, ordered: boolean, index: number): string {
  if (item.checked !== null) return item.checked ? "☑" : "☐";
  return ordered ? `${index + 1}.` : "•";
}

function renderBlock(block: MarkdownBlock, index: number, styles: MarkdownStyles): ReactNode {
  const key = `block-${index}`;
  switch (block.kind) {
    case "heading": {
      const style = block.level <= 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3;
      return (
        <Text key={key} style={style}>
          {renderInline(block.text, styles, key)}
        </Text>
      );
    }
    case "paragraph":
      return (
        <Text key={key} style={styles.paragraph}>
          {renderInline(block.text, styles, key)}
        </Text>
      );
    case "quote":
      return (
        <View key={key} style={styles.quote}>
          <Text style={styles.quoteText}>{renderInline(block.text, styles, key)}</Text>
        </View>
      );
    case "code":
      return (
        <View key={key} style={styles.codeBlock}>
          {block.language ? <Text style={styles.language}>{block.language}</Text> : null}
          <Text style={styles.code}>{block.text}</Text>
        </View>
      );
    case "rule":
      return <View key={key} style={styles.rule} />;
    case "list":
      return (
        <View key={key} style={styles.list}>
          {block.items.map((item, itemIndex) => (
            <View key={`${key}-${itemIndex}`} style={styles.listItem}>
              <Text style={styles.listMarker}>{listMarker(item, block.ordered, itemIndex)}</Text>
              <Text style={[styles.listText, item.checked === true ? styles.listTextDone : null]}>
                {renderInline(item.text, styles, `${key}-${itemIndex}`)}
              </Text>
            </View>
          ))}
        </View>
      );
    case "table":
      return (
        <View key={key} style={styles.table}>
          <View style={[styles.tableRow, styles.tableHeaderCell]}>
            {block.header.map((cell, column) => (
              <View key={`${key}-h${column}`} style={styles.tableCell}>
                <Text style={styles.tableHeaderText}>
                  {renderInline(cell, styles, `${key}-h${column}`)}
                </Text>
              </View>
            ))}
          </View>
          {block.rows.map((row, rowIndex) => (
            <View key={`${key}-r${rowIndex}`} style={styles.tableRow}>
              {block.header.map((_, column) => (
                <View key={`${key}-r${rowIndex}c${column}`} style={styles.tableCell}>
                  <Text style={styles.tableCellText}>
                    {renderInline(row[column] ?? "", styles, `${key}-r${rowIndex}c${column}`)}
                  </Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      );
  }
}

export interface MarkdownProps {
  content: string;
  theme: PanelTheme;
  compact: boolean;
}

/** Read-only Markdown body of one OpenSpec document. */
export function Markdown({ content, theme, compact }: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(content), [content]);
  const styles = useMemo(() => createStyles(theme, compact), [theme, compact]);
  return (
    <View style={styles.body}>
      {blocks.map((block, index) => renderBlock(block, index, styles))}
    </View>
  );
}
