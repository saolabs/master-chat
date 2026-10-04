import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { Fragment, Slice } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";

export const MAX_MESSAGE_LENGTH = 5000;
export type MessageEditorHandle = { focus(): void };

export function messageDocument(text: string): JSONContent {
  const content: JSONContent[] = [];
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .forEach((line, index) => {
      if (index) content.push({ type: "hardBreak" });
      if (line) content.push({ type: "text", text: line });
    });
  return {
    type: "doc",
    content: [{ type: "paragraph", content }],
  };
}

export const MessageEditor = forwardRef<
  MessageEditorHandle,
  {
    value: string;
    label: string;
    placeholder: string;
    disabled: boolean;
    onChange(text: string): void;
    onSend(): void;
  }
>(function MessageEditor(props, ref) {
  const latest = useRef(props);
  latest.current = props;
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      Document,
      Paragraph,
      Text,
      HardBreak,
      UndoRedo,
      Placeholder.configure({ placeholder: props.placeholder }),
    ],
    content: messageDocument(props.value),
    editable: !props.disabled,
    enableInputRules: false,
    enablePasteRules: false,
    editorProps: {
      attributes: {
        class: "message-editor",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": props.label,
      },
      handleDOMEvents: {
        // Leave IME commit to the browser, without running Enter keymaps.
        keydown: (_view, event) => event.isComposing || event.keyCode === 229,
      },
      handleKeyDown: (view, event) => {
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.isComposing ||
          view.composing ||
          event.keyCode === 229
        )
          return false;
        event.preventDefault();
        if (!latest.current.disabled) latest.current.onSend();
        return true;
      },
      handlePaste: (view, event) => {
        if (!event.clipboardData || latest.current.disabled) return false;
        const text = event.clipboardData.getData("text/plain");
        if (!text) return true;
        // Preserve literal text and line breaks, without importing clipboard HTML.
        const document = view.state.schema.nodeFromJSON(messageDocument(text));
        view.dispatch(
          view.state.tr
            .replaceSelection(new Slice(Fragment.from(document.content), 1, 1))
            .scrollIntoView(),
        );
        return true;
      },
    },
    onUpdate: ({ editor }) =>
      latest.current.onChange(editor.getText({ blockSeparator: "\n" })),
  });
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editor?.commands.focus("end");
      },
    }),
    [editor],
  );
  useEffect(() => {
    if (!editor || editor.getText({ blockSeparator: "\n" }) === props.value)
      return;
    editor.commands.setContent(messageDocument(props.value), {
      emitUpdate: false,
    });
    // A newly loaded draft or completed send starts a fresh undo history.
    const state = editor.state;
    editor.view.updateState(
      EditorState.create({
        schema: state.schema,
        doc: state.doc,
        selection: state.selection,
        plugins: state.plugins,
      }),
    );
  }, [editor, props.value]);
  useEffect(() => {
    editor?.setEditable(!props.disabled, false);
    editor?.view.dom.setAttribute("aria-disabled", String(props.disabled));
  }, [editor, props.disabled]);
  return <EditorContent editor={editor} className="message-editor-container" />;
});
