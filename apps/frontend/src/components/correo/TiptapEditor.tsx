"use client";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, List, ListOrdered, Quote, Code, Link2, Undo2, Redo2, Heading2 } from "@/lib/bootstrap-icons";
import { cn } from "@/lib/utils";

interface Props {
  html: string;
  onChange: (html: string, text: string) => void;
  placeholder?: string;
  minHeight?: number;
}

function ToolbarBtn({
  onClick, active, children, title,
}: { onClick: () => void; active?: boolean; children: React.ReactNode; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "h-8 w-8 rounded-lg flex items-center justify-center transition",
        active
          ? "bg-brand-orange/15 text-brand-orange"
          : "text-neutral-500 hover:text-brand-orange hover:bg-black/5 dark:hover:bg-white/5"
      )}
    >
      {children}
    </button>
  );
}

export function TiptapEditor({ html, onChange, placeholder = "Escribe tu mensaje...", minHeight = 220 }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({}),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { class: "text-brand-orange underline" } }),
      Placeholder.configure({ placeholder }),
    ],
    content: html,
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none dark:prose-invert focus:outline-none",
          "prose-headings:font-display prose-a:text-brand-orange",
          "p-4 min-h-[" + minHeight + "px]"
        ),
        style: `min-height:${minHeight}px`,
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML(), editor.getText());
    },
  });

  if (!editor) return null;

  const setLink = () => {
    const prev = editor.getAttributes("link").href;
    const url = window.prompt("URL", prev || "https://");
    if (url === null) return;
    if (url === "") editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  };

  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-black/5 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.03] flex-wrap">
        <ToolbarBtn title="Negrita" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}>
          <Bold className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Cursiva" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}>
          <Italic className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Encabezado" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })}>
          <Heading2 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <div className="h-5 w-px bg-black/10 dark:bg-white/10 mx-1" />
        <ToolbarBtn title="Lista" onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")}>
          <List className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Lista numerada" onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")}>
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Cita" onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")}>
          <Quote className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Código" onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive("code")}>
          <Code className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Enlace" onClick={setLink} active={editor.isActive("link")}>
          <Link2 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <div className="flex-1" />
        <ToolbarBtn title="Deshacer" onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn title="Rehacer" onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className="h-3.5 w-3.5" />
        </ToolbarBtn>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
