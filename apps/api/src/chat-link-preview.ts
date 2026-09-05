// Previsualizacion de enlaces estilo Bitrix24 (best-effort, no bloquea el envio).
type Deps = {
  query: <T = any>(sql: string, params?: any[]) => Promise<T[]>;
  emitToGrupo: (grupoId: string, event: string, data: any) => void;
};

const URL_RE = /(https?:\/\/[^\s<>"']+)/i;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_m, n) => { try { return String.fromCharCode(parseInt(n, 10)); } catch { return _m; } });
}

function metaContent(html: string, keys: string[]): string | null {
  const metas = html.match(/<meta\b[^>]*>/gi) || [];
  for (const key of keys) {
    for (const tag of metas) {
      const pn = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i);
      if (pn && pn[1].toLowerCase() === key) {
        const c = tag.match(/content\s*=\s*["']([^"']*)["']/i);
        if (c && c[1]) return decodeEntities(c[1].trim());
      }
    }
  }
  return null;
}

function knownOembed(url: string): string | null {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h === "fathom.video") return "https://fathom.video/oembed?format=json&url=" + encodeURIComponent(url);
    return null;
  } catch (e) { return null; }
}

function findOembedHref(html: string): string | null {
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of links) {
    if (/application\/json\+oembed/i.test(tag)) {
      const h = tag.match(/href\s*=\s*["']([^"']+)["']/i);
      if (h && h[1]) return decodeEntities(h[1]);
    }
  }
  return null;
}

export async function fetchLinkPreview(deps: Deps, grupoId: string, msgId: string, contenido: string | null): Promise<void> {
  try {
    if (!contenido) return;
    const mm = contenido.match(URL_RE);
    if (!mm) return;
    let url = mm[1].replace(/[)\]\.,;!?]+$/, "");

    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 6000);
    let resp: Response;
    try {
      resp = await fetch(url, {
        signal: ctrl.signal,
        redirect: "follow",
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "es,en;q=0.8"
        }
      });
    } finally {
      clearTimeout(to);
    }

    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (!resp.ok || !ct.includes("text/html")) return;

    let html = "";
    const reader = (resp.body as any)?.getReader ? (resp.body as any).getReader() : null;
    if (reader) {
      const dec = new TextDecoder();
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        html += dec.decode(value, { stream: true });
        if (total > 512 * 1024 || /<\/head>/i.test(html)) {
          try { await reader.cancel(); } catch (e) {}
          break;
        }
      }
    } else {
      html = await resp.text();
    }

    let title = metaContent(html, ["og:title", "twitter:title"]);
    if (!title) {
      const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (t) title = decodeEntities(t[1].trim());
    }
    const description = metaContent(html, ["og:description", "twitter:description", "description"]);
    let image = metaContent(html, ["og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"]);
    const site = metaContent(html, ["og:site_name", "application-name"]);

    // Fallback: oEmbed discovery (Fathom, YouTube, Vimeo, etc.) para thumbnail/titulo
    if (!image) {
      const oe = findOembedHref(html) || knownOembed(url);
      if (oe) {
        try {
          const c2 = new AbortController();
          const t2 = setTimeout(() => c2.abort(), 5000);
          let r2: Response;
          try {
            r2 = await fetch(oe, { signal: c2.signal, redirect: "follow", headers: { "User-Agent": UA, "Accept": "application/json" } });
          } finally {
            clearTimeout(t2);
          }
          if (r2.ok) {
            let j: any = null;
            try { j = JSON.parse(await r2.text()); } catch (e) {}
            if (j && j.thumbnail_url) image = String(j.thumbnail_url);
            if (!title && j && j.title) title = decodeEntities(String(j.title));
          }
        } catch (e) {}
      }
    }

    if (image) {
      if (image.startsWith("//")) image = "https:" + image;
      else if (image.startsWith("/")) { try { const u2 = new URL(url); image = u2.origin + image; } catch (e) {} }
    }

    if (!title && !description && !image) return;

    const preview = {
      url,
      title: title || url,
      description: description || null,
      image: image || null,
      site: site || null
    };

    const upd = await deps.query<any>(
      "UPDATE gozz.chat_mensajes SET link_preview = $1::jsonb WHERE id = $2 RETURNING link_preview",
      [JSON.stringify(preview), msgId]
    );
    if (upd[0]) deps.emitToGrupo(String(grupoId), "chat:message:updated", { id: msgId, link_preview: upd[0].link_preview });
  } catch (e) {
    // best-effort: si falla, el mensaje queda sin preview
  }
}
