import { EditorView, basicSetup } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { autocompletion } from "@codemirror/autocomplete";
const names = [
  "Client",
  "ButtonBuilder",
  "ActionRowBuilder",
  "ModalBuilder",
  "TextInputBuilder",
  "SlashCommandBuilder",
  "ButtonStyle",
  "TextInputStyle",
  "InteractionCreate",
  "showModal",
  "isButton",
  "isModalSubmit",
  "isChatInputCommand",
  "setCustomId",
  "setLabel",
  "addComponents",
  "getTextInputValue",
  "Events",
  "EmbedBuilder",
  "Colors",
  "matchesWords",
  "MessageCreate",
  "ClientReady",
  "content",
  "author",
  "channel",
  "reply",
  "send",
  "edit",
  "delete",
  "moderation",
  "warn",
  "timeout",
  "ban",
  "unban",
  "untimeout",
  "setTitle",
  "setDescription",
  "setColor",
  "addFields",
  "setFooter",
  "setImage",
  "setThumbnail",
  "setTimestamp",
  "login",
];
export function createEditor(parent, value, onChange) {
  const view = new EditorView({
    doc: value,
    parent,
    extensions: [
      basicSetup,
      javascript(),
      oneDark,
      autocompletion({
        override: [
          (context) => {
            const word = context.matchBefore(/[\w$]*/);
            if (!word || (word.from === word.to && !context.explicit))
              return null;
            return {
              from: word.from,
              options: names.map((label) => ({
                label,
                type: ["Client", "EmbedBuilder"].includes(label)
                  ? "class"
                  : "property",
              })),
            };
          },
        ],
      }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
      EditorView.theme({
        "&": { height: "420px", fontSize: "14px" },
        ".cm-scroller": { overflow: "auto" },
        "&.cm-focused": { outline: "2px solid #8b7aff" },
      }),
    ],
  });
  return {
    getValue: () => view.state.doc.toString(),
    setValue: (text) =>
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
      }),
    destroy: () => view.destroy(),
  };
}
