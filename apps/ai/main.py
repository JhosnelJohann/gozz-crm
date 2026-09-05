"""
GOZZ CRM — AI microservice (FastAPI)

Endpoints:
  GET  /health
  POST /analyze-document    (PDF upload -> Claude JSON)
  POST /transcribe          (audio -> whisper.cpp local small -> text)
  POST /extract-task        (text -> Claude -> task JSON)
  POST /summarize-videocall (transcript text -> Claude -> summary JSON)
"""
import os
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv("/root/gozz-crm/apps/ai/.env")
load_dotenv("/root/gozz-crm/.env.local", override=False)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
WHISPER_BIN = "/root/gozz-crm/vendor/whisper.cpp/main"
WHISPER_BIN_ALT = "/root/gozz-crm/vendor/whisper.cpp/build/bin/whisper-cli"
WHISPER_MODEL = "/root/gozz-crm/vendor/whisper.cpp/models/ggml-small.bin"

app = FastAPI(title="GOZZ CRM AI", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lazy import of anthropic (allows /health even without key)
_anthropic_client = None
def get_anthropic():
    global _anthropic_client
    if _anthropic_client is None:
        if not ANTHROPIC_API_KEY:
            raise HTTPException(503, "ANTHROPIC_API_KEY not configured")
        from anthropic import Anthropic
        _anthropic_client = Anthropic(api_key=ANTHROPIC_API_KEY)
    return _anthropic_client


def whisper_available() -> Optional[str]:
    """Return path to whisper binary if available, else None."""
    for b in [WHISPER_BIN, WHISPER_BIN_ALT]:
        if os.path.isfile(b) and os.access(b, os.X_OK):
            return b
    return None


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "gozz-ai",
        "anthropic_configured": bool(ANTHROPIC_API_KEY),
        "whisper_binary": whisper_available(),
        "whisper_model_exists": os.path.isfile(WHISPER_MODEL),
    }


# ==============================================================
# ANALYZE DOCUMENT — multi-format (PDF/Word/Excel/PowerPoint/CSV/imágenes/etc)
# ==============================================================
import io as _io
import base64 as _base64

MAX_DOC_BYTES = 100 * 1024 * 1024  # 100 MB
MAX_TEXT_CHARS = 120_000

_TEXT_EXTS = {".txt", ".md", ".csv", ".log"}
_IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


def _ext_of(filename):
    return os.path.splitext((filename or "").lower())[1]


def _extract_pdf(raw):
    import pdfplumber
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        with pdfplumber.open(tmp_path) as pdf:
            return "\n".join((p.extract_text() or "") for p in pdf.pages)
    finally:
        try: os.unlink(tmp_path)
        except Exception: pass


def _extract_docx(raw):
    from docx import Document
    doc = Document(_io.BytesIO(raw))
    parts = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
    for tbl in doc.tables:
        for row in tbl.rows:
            cells = [c.text.strip() for c in row.cells if c.text and c.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def _extract_xlsx(raw):
    from openpyxl import load_workbook
    wb = load_workbook(_io.BytesIO(raw), data_only=True, read_only=True)
    parts = []
    for sh in wb.worksheets:
        parts.append(f"=== Hoja: {sh.title} ===")
        for row in sh.iter_rows(values_only=True):
            cells = [str(c).strip() for c in row if c is not None and str(c).strip()]
            if cells:
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def _extract_pptx(raw):
    from pptx import Presentation
    prs = Presentation(_io.BytesIO(raw))
    parts = []
    for i, slide in enumerate(prs.slides, 1):
        parts.append(f"=== Slide {i} ===")
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    txt = "".join(r.text for r in para.runs).strip()
                    if txt:
                        parts.append(txt)
    return "\n".join(parts)


def _extract_rtf(raw):
    from striprtf.striprtf import rtf_to_text
    try:
        return rtf_to_text(raw.decode("utf-8", errors="replace"))
    except Exception:
        return raw.decode("utf-8", errors="replace")


def _extract_html(raw):
    import re as _re
    s = raw.decode("utf-8", errors="replace")
    s = _re.sub(r"<script[^>]*>.*?</script>", "", s, flags=_re.DOTALL | _re.IGNORECASE)
    s = _re.sub(r"<style[^>]*>.*?</style>", "", s, flags=_re.DOTALL | _re.IGNORECASE)
    s = _re.sub(r"<[^>]+>", " ", s)
    s = _re.sub(r"\s+", " ", s).strip()
    return s


def _extract_by_format(raw, filename, mime):
    """Return tuple (text, kind). kind='image' significa que se debe usar vision multimodal."""
    ext = _ext_of(filename)
    mime_lc = (mime or "").lower()

    if ext == ".pdf" or mime_lc == "application/pdf":
        return _extract_pdf(raw), "pdf"
    if ext == ".docx" or mime_lc == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _extract_docx(raw), "docx"
    if ext in (".xlsx", ".xlsm") or mime_lc.startswith("application/vnd.openxmlformats-officedocument.spreadsheetml"):
        return _extract_xlsx(raw), "xlsx"
    if ext == ".pptx" or mime_lc == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        return _extract_pptx(raw), "pptx"
    if ext == ".rtf" or mime_lc in ("application/rtf", "text/rtf"):
        return _extract_rtf(raw), "rtf"
    if ext in (".html", ".htm") or mime_lc in ("text/html", "application/xhtml+xml"):
        return _extract_html(raw), "html"
    if ext in (".json",) or mime_lc == "application/json":
        return raw.decode("utf-8", errors="replace"), "json"
    if ext in (".xml",) or mime_lc in ("application/xml", "text/xml"):
        return raw.decode("utf-8", errors="replace"), "xml"
    if ext in _TEXT_EXTS or mime_lc.startswith("text/"):
        return raw.decode("utf-8", errors="replace"), (ext.lstrip(".") or "txt")
    if ext in _IMAGE_EXTS or mime_lc in _IMAGE_MIMES or mime_lc.startswith("image/"):
        return "", "image"
    if ext == ".doc":
        raise HTTPException(415, "Word legacy (.doc) no soportado. Convertí a .docx primero.")
    raise HTTPException(415, f"Formato no soportado: {ext or mime_lc or 'desconocido'}")


# --- claves de IA para "Análisis de documentos" (fallback: Anthropic -> Gemini) ---
_GEMINI_KEY = (os.environ.get("GOOGLE_AI_API_KEY", "").strip() or os.environ.get("GEMINI_API_KEY", "").strip())


def _doc_prompt_instructions(tipo_tramite, kind):
    hint = f"\n\nTrámite asociado al caso: {tipo_tramite}. Señalá si el documento sirve para ese trámite y si falta algo." if tipo_tramite else ""
    return f"""Eres un experto en documentos de inmigración de EE.UU. Analiza el documento ({kind.upper()}) de forma EXHAUSTIVA (al 100%, sin saltarte nada) y devuelve ÚNICAMENTE un JSON válido (sin texto antes ni después, sin markdown) con EXACTAMENTE estas claves:

- "resumen": string de 2 a 4 oraciones — qué es el documento, de quién, para qué sirve y lo más importante que contiene. SIEMPRE debe venir lleno.
- "categoria": tipo de documento en snake_case (ej: pasaporte, acta_nacimiento, licencia_conducir, recibo_pago, factura_servicios, carta_empleador, tax_return, w2, contrato, formulario_uscis, receipt_notice, rfe, sentencia_corte, traduccion, otra).
- "nombre_titular": nombre completo de la persona principal del documento (o null).
- "fecha_documento": fecha principal en formato YYYY-MM-DD (o null).
- "fecha_expiracion": fecha de vencimiento si aplica, YYYY-MM-DD (o null).
- "campos_detectados": objeto con TODOS los datos relevantes como pares clave-valor en español snake_case (ej: "a_number", "uscis_receipt_number", "ssn_parcial", "itin", "numero_pasaporte", "pais", "direccion", "empleador", "monto", "moneda", "fecha_nacimiento", "estado_civil", ...). Incluí todo lo que veas; objeto vacío {{}} si no hay nada.
- "analisis_detallado": string con 1 a 3 párrafos — análisis completo y minucioso: qué dice cada parte relevante, su validez, para qué trámite sirve, qué información clave aporta y observaciones de un experto en inmigración.
- "alertas": array de strings con CUALQUIER problema detectado (vencido, ilegible/borroso, datos inconsistentes, falta firma/sello, falta información, idioma sin traducción certificada, ...). Array vacío [] si no hay problemas.
- "recomendaciones": array de strings con próximos pasos para el equipo (ej: "Solicitar traducción certificada", "Verificar que el A-number coincida con el del I-797", "Documento listo para anexar"). [] si nada.
- "confianza": número entero 0-100 según legibilidad y completitud del análisis.{hint}"""


def _strip_to_json(raw_text):
    s = (raw_text or "").strip()
    if s.startswith("```"):
        rest = s[3:]
        s = rest.split("```", 1)[0] if "```" in rest else rest
        if s.lstrip().startswith("json"):
            s = s.lstrip()[4:]
        s = s.strip()
    i, j = s.find("{"), s.rfind("}")
    if i != -1 and j != -1 and j > i:
        s = s[i:j + 1]
    return json.loads(s)


def _normalize_analysis(data, kind):
    if not isinstance(data, dict):
        data = {"resumen": str(data)}
    if not data.get("resumen"):
        data["resumen"] = f"Documento ({kind}) analizado: {data.get('categoria') or 'sin categoría detectada'}."
    if not isinstance(data.get("alertas"), list):
        data["alertas"] = []
    if not isinstance(data.get("recomendaciones"), list):
        data["recomendaciones"] = []
    if not isinstance(data.get("campos_detectados"), dict):
        data["campos_detectados"] = {}
    if "confianza" not in data:
        data["confianza"] = 70
    return data


def _call_anthropic_doc(messages, max_tokens=4096):
    """Claude con reintentos para errores transitorios. Devuelve el texto."""
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY no configurada")
    import time as _t
    client = get_anthropic()
    last = None
    for attempt in range(3):
        try:
            msg = client.messages.create(model="claude-sonnet-4-6", max_tokens=max_tokens, messages=messages)
            return msg.content[0].text
        except Exception as e:
            last = e
            es = str(e).lower()
            transient = any(x in es for x in ("overloaded", "rate limit", " 429", "timeout", " 500", " 502", " 503", " 529"))
            if not transient or attempt == 2:
                raise
            _t.sleep(2 * (attempt + 1))
    raise last


_GEMINI_MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-2.0-flash-lite", "gemini-2.5-flash-lite"]
# Para el CoPilot: tras los Gemini, último recurso = Gemma 4 (sin tools ni systemInstruction → modo texto).
_COPILOT_GEMINI_MODELS = _GEMINI_MODELS + ["gemma-4-31b-it", "gemma-4-26b-a4b-it"]


def _call_gemini_doc(prompt_text, image_b64=None, image_mime=None, max_tokens=8192):
    """Fallback Google Gemini (REST). Prueba varios modelos. Devuelve el texto (JSON)."""
    if not _GEMINI_KEY:
        raise RuntimeError("GOOGLE_AI_API_KEY no configurada")
    import httpx, time as _t
    parts = [{"text": prompt_text}]
    if image_b64:
        parts.append({"inline_data": {"mime_type": image_mime or "image/jpeg", "data": image_b64}})
    body = {"contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": max_tokens, "responseMimeType": "application/json"}}
    last = None
    for model in _GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={_GEMINI_KEY}"
        for attempt in range(3):
            try:
                r = httpx.post(url, json=body, timeout=120.0)
                if r.status_code in (404,):
                    last = RuntimeError(f"Gemini {model} HTTP 404 (modelo no disponible)"); break  # probar siguiente modelo
                if r.status_code == 429 and ("limit: 0" in r.text or "free_tier" in r.text):
                    last = RuntimeError(f"Gemini {model} sin cuota free-tier"); break  # probar siguiente modelo
                if r.status_code in (429, 500, 502, 503, 529):
                    last = RuntimeError(f"Gemini {model} HTTP {r.status_code}: {r.text[:200]}")
                    _t.sleep(2 * (attempt + 1)); continue
                r.raise_for_status()
                cand = (r.json().get("candidates") or [{}])[0]
                txt = "".join(p.get("text", "") for p in (cand.get("content", {}).get("parts") or []) if not p.get("thought"))
                if not txt.strip():
                    raise RuntimeError(f"Gemini {model} respuesta vacía (finishReason={cand.get('finishReason')})")
                return txt
            except httpx.HTTPError as e:
                last = e
                if attempt == 2:
                    break
                _t.sleep(2 * (attempt + 1))
    raise last or RuntimeError("Gemini: ningún modelo disponible")


@app.post("/analyze-document")
async def analyze_document(file: UploadFile = File(...), tipo_tramite: Optional[str] = Form(None)):
    if not (ANTHROPIC_API_KEY or _GEMINI_KEY):
        raise HTTPException(503, "Análisis de IA no disponible: no hay clave de API configurada. El administrador debe cargar ANTHROPIC_API_KEY (con créditos) o GOOGLE_AI_API_KEY en /root/gozz-crm/apps/ai/.env y reiniciar crm-ai.")

    raw = await file.read()
    if len(raw) > MAX_DOC_BYTES:
        raise HTTPException(400, f"Archivo muy grande (max {MAX_DOC_BYTES // (1024*1024)} MB)")
    if len(raw) == 0:
        raise HTTPException(400, "Archivo vacío")

    text, kind = _extract_by_format(raw, file.filename, file.content_type)
    instructions = _doc_prompt_instructions(tipo_tramite, kind)

    image_b64 = image_mime = None
    if kind == "image":
        image_mime = file.content_type if (file.content_type in _IMAGE_MIMES) else "image/jpeg"
        image_b64 = _base64.b64encode(raw).decode("ascii")
        prompt_text = instructions + "\n\n(El documento a analizar es la imagen adjunta.)"
        anthropic_messages = [{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": image_mime, "data": image_b64}},
            {"type": "text", "text": prompt_text},
        ]}]
    else:
        if not text or not text.strip():
            raise HTTPException(400, f"No se pudo extraer texto del documento ({kind})")
        truncated = text[:MAX_TEXT_CHARS]
        note = "" if len(text) <= MAX_TEXT_CHARS else f"\n\n[NOTA: documento muy largo, truncado de {len(text):,} a {MAX_TEXT_CHARS:,} caracteres]"
        prompt_text = f"{instructions}{note}\n\n=== DOCUMENTO ({kind.upper()}) ===\n{truncated}\n=== FIN DEL DOCUMENTO ==="
        anthropic_messages = [{"role": "user", "content": prompt_text}]

    errors = []
    if ANTHROPIC_API_KEY:
        try:
            data = _normalize_analysis(_strip_to_json(_call_anthropic_doc(anthropic_messages, max_tokens=4096)), kind)
            return {"ok": True, "engine": "anthropic", "analysis": data, "kind": kind,
                    "text_length": len(text) if kind != "image" else 0, "size_bytes": len(raw)}
        except Exception as e:
            errors.append(f"Claude: {str(e)[:300]}")
    if _GEMINI_KEY:
        try:
            data = _normalize_analysis(_strip_to_json(_call_gemini_doc(prompt_text, image_b64, image_mime, max_tokens=8192)), kind)
            return {"ok": True, "engine": "gemini", "analysis": data, "kind": kind,
                    "text_length": len(text) if kind != "image" else 0, "size_bytes": len(raw)}
        except Exception as e:
            errors.append(f"Gemini: {str(e)[:300]}")

    detail = " | ".join(errors) or "sin detalle"
    if "credit balance" in detail.lower():
        raise HTTPException(503, f"Análisis de IA no disponible: la API de Claude no tiene créditos. El administrador debe recargar en console.anthropic.com o configurar GOOGLE_AI_API_KEY en /root/gozz-crm/apps/ai/.env y reiniciar crm-ai. ({detail})")
    raise HTTPException(503, f"El análisis de IA falló: {detail}")



# ==============================================================
# TRANSCRIBE — reemplazado por faster-whisper (ver bloque más abajo).
# ==============================================================


# ==============================================================
# EXTRACT TASK FROM TEXT
# ==============================================================
class ExtractTaskIn(BaseModel):
    transcripcion: str

@app.post("/extract-task")
async def extract_task(body: ExtractTaskIn):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(503, "AI desactivado")

    prompt = f"""Analiza la siguiente nota de voz transcrita y determina si contiene una instrucción de tarea. Devuelve SOLO JSON con esta estructura:

{{
  "esTarea": boolean,
  "titulo": "string corto máximo 80 caracteres (ej: Llamar a María García)",
  "descripcion": "string con más detalle si hay contexto, o null",
  "prioridad_sugerida": "baja|normal|alta|urgente",
  "fecha_limite_sugerida": "YYYY-MM-DDTHH:mm:ssZ o null",
  "razonamiento": "1 oración corta explicando por qué es/no es tarea"
}}

Si NO es una tarea clara (es solo un comentario, saludo, divagación), pon esTarea=false y explica en razonamiento.

=== TRANSCRIPCIÓN ===
{body.transcripcion}
=== FIN ==="""

    client = get_anthropic()
    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=800,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = msg.content[0].text.strip()
        if raw_text.startswith("```"):
            raw_text = raw_text.split("```", 2)[1]
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]
            raw_text = raw_text.rsplit("```", 1)[0].strip()
        data = json.loads(raw_text)
        return {"ok": True, "tarea": data}
    except json.JSONDecodeError as e:
        raise HTTPException(502, f"Claude JSON inválido: {e}")
    except Exception as e:
        raise HTTPException(500, f"Claude error: {e}")


# ==============================================================
# SUMMARIZE VIDEOCALL
# ==============================================================
class SummarizeIn(BaseModel):
    transcripcion: str
    titulo_reunion: Optional[str] = None

@app.post("/summarize-videocall")
async def summarize_videocall(body: SummarizeIn):
    if not (ANTHROPIC_API_KEY or _GEMINI_KEY):
        raise HTTPException(503, "AI desactivado: configura ANTHROPIC_API_KEY o GOOGLE_AI_API_KEY")

    titulo = body.titulo_reunion or "reunión"
    prompt = f"""Eres un asistente ejecutivo. Analiza la siguiente transcripción de videollamada ({titulo}) y genera un resumen estructurado en JSON:

{{
  "titulo": "string — título descriptivo de la reunión",
  "resumen_ejecutivo": "string — 3-4 oraciones con lo esencial",
  "puntos_clave": ["array de 3-6 bullets con los temas principales"],
  "decisiones": ["array de decisiones tomadas (puede estar vacío)"],
  "tareas_detectadas": [{{"titulo": "str", "responsable": "str|null", "fecha_limite_sugerida": "YYYY-MM-DD|null"}}],
  "proximos_pasos": ["array de próximos pasos"],
  "tono_reunion": "positivo|neutral|tenso|urgente"
}}

Responde SOLO con el JSON.

=== TRANSCRIPCIÓN ===
{body.transcripcion[:30000]}
=== FIN ==="""

    errors = []
    if ANTHROPIC_API_KEY:
        try:
            client = get_anthropic()
            msg = client.messages.create(model="claude-sonnet-4-6", max_tokens=3000, messages=[{"role": "user", "content": prompt}])
            return {"ok": True, "engine": "anthropic", "resumen": _strip_to_json(msg.content[0].text)}
        except Exception as e:
            errors.append(f"Claude: {str(e)[:300]}")
    if _GEMINI_KEY:
        try:
            return {"ok": True, "engine": "gemini", "resumen": _strip_to_json(_call_gemini_doc(prompt, max_tokens=4096))}
        except Exception as e:
            errors.append(f"Gemini: {str(e)[:300]}")
    raise HTTPException(503, f"No se pudo generar el resumen: {' | '.join(errors) or 'sin detalle'}")


# ==============================================================
# SIMPLE CHAT (for general AI assist)
# ==============================================================
class AttachmentIn(BaseModel):
    url: str
    mime: Optional[str] = None
    name: Optional[str] = None


class ChatIn(BaseModel):
    message: str
    context: Optional[str] = None
    attachments: Optional[list[AttachmentIn]] = None


# Fetch + conversion de attachments a content blocks de Anthropic.
async def _attachment_to_block(att: AttachmentIn) -> Optional[dict]:
    import base64, mimetypes
    url = att.url
    mime = (att.mime or "").lower().strip() or None
    name = att.name or (url.split("?")[0].split("/")[-1]) or "archivo"
    # URL relativo /uploads/ → resolver contra crm-api local
    fetch_url = url
    if fetch_url.startswith("/"):
        fetch_url = f"http://127.0.0.1:4100{fetch_url}"
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            r = await client.get(fetch_url)
            if r.status_code >= 400:
                return {"type": "text", "text": f"[⚠️ No pude descargar `{name}` — HTTP {r.status_code}]"}
            data = r.content
    except Exception as e:
        return {"type": "text", "text": f"[⚠️ Error bajando `{name}`: {e}]"}

    if not mime:
        mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    name_low = name.lower()

    # Imagen nativa
    if mime.startswith("image/") or any(name_low.endswith(e) for e in (".png", ".jpg", ".jpeg", ".webp", ".gif")):
        media_type = mime if mime in ("image/jpeg", "image/png", "image/gif", "image/webp") else "image/png"
        if len(data) > 5 * 1024 * 1024:
            return {"type": "text", "text": f"[⚠️ Imagen `{name}` supera 5 MB ({len(data)//1024} KB) — no puedo analizarla. Pedile al usuario una versión más chica.]"}
        return {
            "type": "image",
            "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(data).decode()},
        }

    # PDF nativo (Sonnet 4.6 lee texto + imágenes del PDF directamente)
    if mime == "application/pdf" or name_low.endswith(".pdf"):
        if len(data) > 32 * 1024 * 1024:
            return {"type": "text", "text": f"[⚠️ PDF `{name}` supera 32 MB]"}
        return {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": base64.b64encode(data).decode()},
            "title": name,
        }

    # Texto plano
    TEXT_EXTS = (".txt", ".md", ".csv", ".json", ".log", ".xml", ".html", ".htm", ".yml", ".yaml", ".tsv", ".sql", ".js", ".ts", ".py")
    if mime.startswith("text/") or any(name_low.endswith(e) for e in TEXT_EXTS):
        try:
            content = data.decode("utf-8", errors="replace")[:40000]
            return {"type": "text", "text": f"**[Archivo `{name}`]**\n\n```\n{content}\n```"}
        except Exception:
            pass

    # DOCX → extraer párrafos + tablas
    if name_low.endswith(".docx") or mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        try:
            import tempfile
            from docx import Document
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".docx")
            tmp.write(data); tmp.flush(); tmp.close()
            try:
                doc = Document(tmp.name)
                lines = [p.text for p in doc.paragraphs if p.text.strip()]
                for t in doc.tables:
                    for row in t.rows:
                        cells = [c.text.replace("\n", " ").strip() for c in row.cells]
                        if any(cells):
                            lines.append(" | ".join(cells))
                text = "\n".join(lines)[:40000]
                return {"type": "text", "text": f"**[Documento Word `{name}`]**\n\n{text}"}
            finally:
                try: os.unlink(tmp.name)
                except Exception: pass
        except Exception as e:
            return {"type": "text", "text": f"[⚠️ No pude leer DOCX `{name}`: {e}]"}

    # XLSX → extraer hojas y celdas con openpyxl
    if name_low.endswith(".xlsx") or mime == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
        try:
            import tempfile
            from openpyxl import load_workbook
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx")
            tmp.write(data); tmp.flush(); tmp.close()
            try:
                wb = load_workbook(tmp.name, read_only=True, data_only=True)
                out = []
                for sheet in wb.sheetnames[:8]:  # max 8 hojas
                    ws = wb[sheet]
                    out.append(f"### Hoja: {sheet}")
                    rows_printed = 0
                    for row in ws.iter_rows(values_only=True):
                        if rows_printed >= 200:
                            out.append("… (truncado a 200 filas)")
                            break
                        non_empty = [str(c) if c is not None else "" for c in row]
                        if any(non_empty):
                            out.append(" | ".join(non_empty))
                            rows_printed += 1
                text = "\n".join(out)[:40000]
                return {"type": "text", "text": f"**[Hoja de cálculo `{name}`]**\n\n{text}"}
            finally:
                try: os.unlink(tmp.name)
                except Exception: pass
        except Exception as e:
            return {"type": "text", "text": f"[⚠️ No pude leer XLSX `{name}`: {e}]"}

    # Audio → transcribir inline
    AUDIO_EXTS = (".mp3", ".wav", ".m4a", ".ogg", ".webm", ".opus", ".aac")
    if mime.startswith("audio/") or any(name_low.endswith(e) for e in AUDIO_EXTS):
        try:
            import tempfile
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
            tmp.write(data); tmp.flush(); tmp.close()
            try:
                model = get_whisper()
                segments, info = model.transcribe(tmp.name, language="es", vad_filter=True, beam_size=1)
                text = " ".join(s.text.strip() for s in segments).strip()
                return {"type": "text", "text": f"**[Audio `{name}` ({int(info.duration)}s) — transcripción]**\n\n{text or '(sin speech detectable)'}"}
            finally:
                try: os.unlink(tmp.name)
                except Exception: pass
        except Exception as e:
            return {"type": "text", "text": f"[⚠️ Audio `{name}` no se pudo transcribir: {e}]"}

    # Fallback
    return {"type": "text", "text": f"[⚠️ Archivo `{name}` ({mime}, {len(data)//1024} KB) — formato no soportado. Sugerí al usuario convertirlo a PDF/imagen/texto.]"}

# Knowledge bases que viven en el system prompt con cache_control ephemeral.
# TTL 5 min — se reutiliza entre llamadas y entre iteraciones del tool-use loop.
def _load_kb(filename: str, label: str) -> str:
    path = Path(__file__).parent / filename
    try:
        if path.exists():
            data = path.read_text(encoding="utf-8")
            print(f"[copilot] KB {label} loaded: {len(data):,} chars (~{len(data)//4:,} tokens)")
            return data
    except Exception as e:
        print(f"[copilot] KB {label} load failed: {e}")
    return ""


KB_VENTAS = _load_kb("kb_ventas.md", "ventas+neuromarketing")
KB_CRM = _load_kb("kb_crm.md", "CRM operacional")


COPILOT_SYSTEM = """Eres **CoPilot**, el asistente IA del **CRM GOZZ**, una firma de servicios migratorios que opera en EE.UU. Ayudas al equipo interno (super-admins, admins y staff) con:

1. **Inmigración USA**: formas USCIS (I-130, I-485, I-765, I-131, I-589, I-751, N-400, H-1B, H-4, H-1B1, L-1, O-1, asilo, DACA, TPS, etc.), procesos, tiempos, elegibilidad, documentación requerida, honorarios, estrategia de caso. Responde con precisión pero aclara que NO eres abogado — recomienda verificar con un especialista licenciado en casos complejos.
2. **Operación del CRM GOZZ**: guías para usar el CRM (pipeline de oportunidades, trámites, tareas, chat, Drive/Documentos, videollamadas, correo, academia, reportes, asistencia, clock). Cuando pregunten "¿cómo hago X en el CRM?" da pasos claros y accionables.
3. **Redacción profesional**: borradores de emails, WhatsApp, notas de caso, cartas, mensajes a clientes en español o inglés.
4. **Análisis y estrategia**: follow-ups, plantillas, guiones para setters y preparadores, tips de productividad.

**Estilo de respuesta (CRÍTICO — la UI renderiza markdown):**
- Español por defecto. Inglés si te lo piden.
- Usa markdown **correctamente formateado** — NO uses `#` inline pegado al texto ni `**` sin espacio. Respeta saltos de línea.
- `## Subtítulos` para secciones principales; `### Subtítulos` para secciones menores.
- Listas con `-` o `1.` (pasos). **Negritas** `**así**` para conceptos clave.
- `> Blockquote` para notas/advertencias. `` `código` `` inline para IDs, campos, endpoints. Bloques ``` ``` para ejemplos largos.
- Tablas cuando compares opciones.
- `---` para separar secciones en respuestas largas.
- **NO decores con emojis-bullet** (nada de 📌 🎯 🔥 como marcador). Emojis puntuales en prosa están bien si aportan.
- **Concisión**: preguntas simples → 2-4 líneas. Complejas → estructurado con headings.
- **Tono**: profesional, cálido, claro. Nunca robótico ni servil.
- Si la pregunta es ambigua pide UNA aclaración específica antes de asumir.
- Termina con "próximos pasos" o pregunta de seguimiento **sólo si agrega valor real**.

**Capacidades multimodales:**
- Podés recibir archivos adjuntos en el chat. **PDFs e imágenes** los procesás nativamente (ves el texto y el contenido visual de cada página o imagen). **DOCX/XLSX/TXT/CSV/JSON/MD** llegan como texto extraído en un bloque. **Audios adjuntos** se transcriben automáticamente y llegan como texto (voice notes del usuario).
- Cuando llegue un documento: leelo completo, identificá qué es (formulario USCIS, contrato, pasaporte, acta de nacimiento, recibo de pago, email reenviado, captura de pantalla, etc), extraé los datos clave, y respondé específicamente lo que el usuario preguntó. Si no preguntó nada específico, ofrecé un resumen + 3 acciones posibles (ej. "completar el I-130 con estos datos", "identificar inconsistencias", "generar carta en base a este documento").

**Conocimiento del CRM GOZZ (operación y arquitectura):**
- Tenés cargado un **KB operacional completo del CRM**: todas las secciones (Dashboard, Contactos, Oportunidades, Tareas, Trámites, Drive, Chat, Correo, Academia, Reportes, Equipo, Asistencia, Configuración), sus tabs y funcionalidades, roles y permisos, stack técnico (Next.js :3100, Express :4100, FastAPI :8100, Postgres schema `gozz`, Redis, PM2), endpoints REST, troubleshooting común, flujos (cómo subir al Drive, cómo iniciar videollamada, cómo se crea una oportunidad, cómo funciona el SLA, etc).
- Cuando el usuario pregunte "¿cómo hago X en el CRM?" / "¿qué es tal cosa?" / "¿por qué aparece tal error?" / "¿dónde está tal función?" → usá ese KB para responder **específicamente al CRM GOZZ**, no a un CRM genérico.
- Si la pregunta es operativa (dónde clickeo, qué hace ese botón, cómo arreglo esto), dá pasos numerados y precisos. Si es arquitectural o técnica (qué stack, qué endpoint, qué tabla), dá nombres de archivos/endpoints/tablas exactos.
- Si el usuario describe un bug nuevo que no está en el troubleshooting del KB, razoná desde la arquitectura conocida y sugerí primer diagnóstico (qué log mirar, qué pm2 process reiniciar, qué env var verificar).

**Ventas · Neuromarketing · Marketing Digital:**
- En tu system prompt tenés cargada una **Knowledge Base extensa** con:
  - **Las 6 Necesidades Sociales de Chase Hughes** (framework de perfilación para detectar qué necesidad emocional mueve al cliente: importancia, aceptación, poder, atención, inteligencia, pertenencia — cada una con señales observables, estrategia de rapport y cómo influir).
  - **Las 5 Tonalidades NEPQ de Jeremy Miner** (curiosidad, preocupación, seguridad/certeza, escepticismo, juguetón — cuándo usar cada una y ejemplos de preguntas).
  - **Identidad y personalidad Bot Medicare** (referencia de estructura persuasiva).
  - **23 skills de marketing digital** (ad manager, customer journey, funnel builder, VSL, carruseles, reels, historias, lead magnet, pilares de contenido, etc).
- Cuando el usuario pida **consejos para abordar un cliente**, **cómo manejar objeciones**, **qué tono usar**, **estructura de llamada**, **follow-up**, **pitch**, **anuncios**, **funnels**, **copy**, **guiones para setters/closers** — usá este KB activamente.
- **Nunca lo recites textual**. Adaptalo al contexto específico del cliente que te compartan en el chat: tono del historial de conversación, tags, etapa. Mezclá el framework con los datos reales que te den.
- El análisis ideal de un cliente combina: (1) los datos que el usuario pegue en el chat (etapa, monto, tags, historial, transcripciones), (2) detección de necesidad social dominante según señales en los mensajes, (3) tono NEPQ recomendado para el próximo contacto, (4) 3 opciones de acción concretas con guion sugerido.

**Limitaciones:**
- No inventes números de caso, fechas específicas de procesamiento, o fees del USCIS sin certeza (si no estás seguro, di "verificá en uscis.gov/fees").
- No puedes ejecutar acciones en el CRM (crear contactos, enviar mensajes, etc). Puedes redactar el contenido para que el humano lo ejecute."""

# ==============================================================
# SPEECH-TO-TEXT (faster-whisper) — lazy load, modelo `base` (~140 MB)
# Usado por CoPilot para procesar mensajes de audio del chat.
# ==============================================================
_whisper_model = None


def get_whisper():
    global _whisper_model
    if _whisper_model is None:
        from faster_whisper import WhisperModel
        # CPU + int8 mantiene RAM baja (~150MB) y velocidad aceptable para clips cortos.
        _whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
    return _whisper_model


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: Optional[str] = Form("es")):
    """Transcribe un archivo de audio a texto. Devuelve {ok, text, language, duration}."""
    import tempfile, os
    suffix = os.path.splitext(file.filename or "audio.webm")[1] or ".webm"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(await file.read())
        tmp.flush()
        tmp.close()
        model = get_whisper()
        segments, info = model.transcribe(
            tmp.name,
            language=language if language and language != "auto" else None,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            beam_size=1,
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        return {
            "ok": True,
            "text": text,
            "language": info.language,
            "duration": info.duration,
        }
    except Exception as e:
        raise HTTPException(500, f"Whisper error: {e}")
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


def _escape_html(s: str) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


async def tool_generate_pdf(args: dict) -> dict:
    try:
        import re as _re
        import markdown2
        from weasyprint import HTML

        title = (args.get("title") or "Documento").strip()
        subtitle = (args.get("subtitle") or "").strip()
        content_md = args.get("content_markdown") or args.get("content") or ""
        if not content_md.strip():
            return {"error": "content_markdown requerido"}

        # Nombre de archivo seguro
        raw_name = args.get("filename") or title
        safe = _re.sub(r"[^\w\-]+", "_", raw_name).strip("_").lower()[:60] or "documento"
        ts = int(__import__("time").time() * 1000)
        filename = f"copilot-{safe}-{ts}.pdf"
        out_path = os.path.join(UPLOADS_DIR, filename)

        # Markdown → HTML
        html_body = markdown2.markdown(
            content_md,
            extras=["tables", "fenced-code-blocks", "strike", "cuddled-lists", "break-on-newline"],
        )

        # Footer date en ET
        from datetime import datetime
        try:
            from zoneinfo import ZoneInfo
            now = datetime.now(ZoneInfo("America/New_York"))
        except Exception:
            now = datetime.now()
        date_str = now.strftime("%d %b %Y · %H:%M ET")
        footer = args.get("footer") or "GOZZ · Documento generado por CoPilot"

        full_html = PDF_HTML_TEMPLATE.format(
            title_esc=_escape_html(title),
            subtitle_html=f'<div class="subtitle">{_escape_html(subtitle)}</div>' if subtitle else "",
            content_html=html_body,
            date_esc=_escape_html(date_str),
            footer_esc=_escape_html(footer),
        )

        HTML(string=full_html, base_url=UPLOADS_DIR).write_pdf(out_path)
        size = os.path.getsize(out_path)
        return {
            "ok": True,
            "url": f"/uploads/{filename}",
            "filename": filename,
            "size_bytes": size,
            "title": title,
        }
    except Exception as e:
        return {"error": f"pdf_generation_failed: {e}"}


# Registry: (name) -> (handler, description, input_schema)
COPILOT_TOOLS = [
    {
        "name": "generate_pdf",
        "description": "Genera un documento PDF profesional a partir de contenido markdown. Úsalo cuando el usuario pida explícitamente un PDF (borrador de carta, contrato, resumen ejecutivo, reporte, cotización, etc). El PDF tiene branding GOZZ, tipografía profesional, tablas estilizadas, headings con gradient, footer con fecha. Devuelve `url` con el path (`/uploads/...`) — inclúilo en tu respuesta final como link markdown para que el usuario pueda descargarlo.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Título principal del documento (aparece grande y con gradient)"},
                "subtitle": {"type": "string", "description": "Subtítulo opcional bajo el título"},
                "content_markdown": {"type": "string", "description": "Cuerpo del documento en markdown completo (headings ##, listas -, tablas |, **negritas**, > blockquotes, ``` code ```, --- hr). Será renderizado con estilo corporativo."},
                "filename": {"type": "string", "description": "Nombre sugerido del archivo (sin extensión). Si no se pasa, se genera del título."},
                "footer": {"type": "string", "description": "Texto pequeño en el footer de cada página (opcional)."},
            },
            "required": ["title", "content_markdown"],
        },
        "handler": tool_generate_pdf,
    },
]

TOOL_HANDLERS = {t["name"]: t["handler"] for t in COPILOT_TOOLS}
# Claude espera input_schema sin la key 'handler'
CLAUDE_TOOLS = [{k: v for k, v in t.items() if k != "handler"} for t in COPILOT_TOOLS]


# ====================== CoPilot — fallback con Gemini (function calling) ======================
def _clean_gemini_schema(s):
    if not isinstance(s, dict):
        return s
    out = {}
    for k, v in s.items():
        if k in ("additionalProperties", "$schema", "$id", "$ref", "definitions", "examples", "default", "title"):
            continue
        if k == "properties" and isinstance(v, dict):
            out[k] = {pk: _clean_gemini_schema(pv) for pk, pv in v.items()}
        elif k == "items":
            out[k] = _clean_gemini_schema(v)
        else:
            out[k] = v
    if out.get("type") == "object" and "properties" not in out:
        out["properties"] = {}
    return out


def _gemini_function_declarations():
    decls = []
    for t in CLAUDE_TOOLS:
        decls.append({
            "name": t["name"],
            "description": (t.get("description") or "")[:1024],
            "parameters": _clean_gemini_schema(t.get("input_schema") or {"type": "object", "properties": {}}),
        })
    return [{"functionDeclarations": decls}]


def _anthropic_block_to_gemini_part(block):
    """Convierte un bloque de contenido formato Anthropic a un 'part' de Gemini."""
    if not isinstance(block, dict):
        return {"text": str(block)}
    bt = block.get("type")
    if bt == "text":
        return {"text": block.get("text", "")}
    if bt == "image":
        src = block.get("source") or {}
        return {"inline_data": {"mime_type": src.get("media_type") or "image/png", "data": src.get("data", "")}}
    if bt == "document":
        src = block.get("source") or {}
        return {"inline_data": {"mime_type": src.get("media_type") or "application/pdf", "data": src.get("data", "")}}
    return {"text": json.dumps(block, ensure_ascii=False)[:4000]}


async def _gemini_chat_loop(system_text, first_parts, use_tools=True, max_iter=12):
    """Loop agéntico con Gemini reutilizando TOOL_HANDLERS (tool: generate_pdf).
    Último recurso: Gemma 4 (sin tools ni systemInstruction → modo texto). Devuelve el texto final."""
    if not _GEMINI_KEY:
        raise RuntimeError("GOOGLE_AI_API_KEY no configurada")
    import httpx, time as _t
    if not first_parts:
        first_parts = [{"text": "(mensaje vacío)"}]
    contents = [{"role": "user", "parts": first_parts}]
    tools_payload = _gemini_function_declarations() if use_tools else None
    sys_g = (system_text or "")[:900000]
    last_err = None
    for _it in range(max_iter):
        resp = None
        used_gemma = False
        # Gemma sólo como último recurso en el primer turno (no entiende functionCall/Response).
        models = _COPILOT_GEMINI_MODELS if _it == 0 else _GEMINI_MODELS
        for model in models:
            is_gemma = model.startswith("gemma")
            if is_gemma:
                gemma_sys = (system_text or "")[:100000] + "\n\n*(Nota: esta sesión corre con Gemma 4 — NO tengo acceso a la generación de PDF en este modo; respondo con lo que sé y lo que esté en el contexto/KB.)*"
                body = {
                    "contents": [{"role": "user", "parts": [{"text": gemma_sys}] + first_parts}],
                    "generationConfig": {"temperature": 0.4, "maxOutputTokens": 4096},
                }
            else:
                body = {
                    "systemInstruction": {"parts": [{"text": sys_g}]},
                    "contents": contents,
                    "generationConfig": {"temperature": 0.4, "maxOutputTokens": 4096},
                }
                if tools_payload:
                    body["tools"] = tools_payload
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={_GEMINI_KEY}"
            for attempt in range(3):
                r = httpx.post(url, json=body, timeout=180.0)
                if r.status_code == 200:
                    resp = r.json(); used_gemma = is_gemma; break
                last_err = RuntimeError(f"{model} HTTP {r.status_code}: {r.text[:200]}")
                if r.status_code in (400, 404) or (r.status_code == 429 and "limit: 0" in r.text):
                    break  # modelo no usable -> probar siguiente
                if r.status_code in (429, 500, 502, 503, 529):
                    _t.sleep(2 * (attempt + 1)); continue
                break  # error no recuperable -> probar siguiente modelo
            if resp is not None:
                break
        if resp is None:
            raise last_err or RuntimeError("Gemini/Gemma: ningún modelo disponible")
        cand = (resp.get("candidates") or [{}])[0]
        content = cand.get("content") or {}
        parts = content.get("parts") or []
        fcs = [p["functionCall"] for p in parts if isinstance(p, dict) and p.get("functionCall")]
        if fcs and use_tools:
            contents.append({"role": content.get("role") or "model", "parts": parts})
            fr_parts = []
            for fc in fcs:
                name = fc.get("name"); args = fc.get("args") or {}
                handler = TOOL_HANDLERS.get(name)
                if not handler:
                    result = {"error": f"tool desconocido: {name}"}
                else:
                    try:
                        result = await handler(args)
                    except Exception as e:
                        result = {"error": f"tool_exception: {e}"}
                fr_parts.append({"functionResponse": {"name": name, "response": {"output": json.dumps(result, ensure_ascii=False)[:12000]}}})
            contents.append({"role": "user", "parts": fr_parts})
            continue
        txt = "".join(p.get("text", "") for p in parts if isinstance(p, dict) and not p.get("thought") and p.get("text"))
        if not txt.strip():
            txt = f"(Gemini terminó sin texto; finishReason={cand.get('finishReason')})"
        return txt
    return "⚠️ Consulté varias herramientas pero no llegué a una respuesta final. Reformulá tu pregunta."


@app.post("/chat")
async def chat(body: ChatIn):
    if not (ANTHROPIC_API_KEY or _GEMINI_KEY):
        raise HTTPException(503, "AI desactivado: configura ANTHROPIC_API_KEY (con créditos) o GOOGLE_AI_API_KEY en /root/gozz-crm/apps/ai/.env")

    system = COPILOT_SYSTEM
    system += """

---
## 🔧 Herramientas disponibles

1. **"Generá un PDF de X"** / "hacé un documento en PDF de..." → usá `generate_pdf` con `title` claro y `content_markdown` bien estructurado. Tras ejecutarlo, incluí en tu respuesta final el link así: `[📄 {filename}]({url})` para que el usuario pueda descargarlo. Ejemplos de uso típico: borradores de carta al cliente, resúmenes ejecutivos de un caso, reportes de conversación, cotizaciones, checklists de documentos USCIS, briefs de trámite.
2. No tenés acceso directo a los datos reales de contactos/oportunidades del CRM vía tools — si el usuario pregunta por un cliente o caso específico, pedile que pegue los datos relevantes en el chat (o adjunte el documento) para poder analizarlos."""

    # System prompt como lista de bloques para habilitar prompt caching.
    # KB CRM (~45K) + KB ventas (~87K) son grandes — los cacheamos ephemeral
    # (TTL 5 min) para no pagarlos en cada iteración del tool-use loop ni en
    # cada pregunta. Sólo hasta 4 breakpoints de cache por request; usamos 2.
    system_blocks: list = [{"type": "text", "text": system}]
    if KB_CRM:
        system_blocks.append({
            "type": "text",
            "text": f"\n\n---\n\n# KNOWLEDGE BASE · GOZZ CRM (OPERACIÓN Y ARQUITECTURA)\n\n{KB_CRM}",
        })
    if KB_VENTAS:
        system_blocks.append({
            "type": "text",
            "text": f"\n\n---\n\n# KNOWLEDGE BASE · VENTAS Y NEUROMARKETING\n\n{KB_VENTAS}",
            "cache_control": {"type": "ephemeral"},
        })
    if body.context:
        # Context variable (nombre de usuario, fecha, historial): no cacheable, va al final.
        system_blocks.append({
            "type": "text",
            "text": f"\n\n---\n**Contexto adicional proporcionado por el backend:**\n{body.context}",
        })

    # Construcción del primer turno: attachments (imágenes/PDFs/docs/audios) + texto.
    user_content: list = []
    if body.attachments:
        for att in body.attachments:
            block = await _attachment_to_block(att)
            if block:
                user_content.append(block)
    if body.message:
        user_content.append({"type": "text", "text": body.message})
    if not user_content:
        user_content = [{"type": "text", "text": "(mensaje vacío)"}]

    # === Motor 1: Anthropic (Claude Sonnet 4.6) con tool-use ===
    anthropic_err = None
    if ANTHROPIC_API_KEY:
        try:
            client = get_anthropic()
            messages: list = [{"role": "user", "content": user_content}]
            # Tool-use loop: hasta 12 iteraciones (análisis profundo de negociación
            # puede encadenar: contact → conversations → messages → transcriptions → opportunities → síntesis).
            for _iter in range(12):
                kwargs = dict(model="claude-sonnet-4-6", max_tokens=3500, system=system_blocks, messages=messages, tools=CLAUDE_TOOLS)
                response = client.messages.create(**kwargs)
                if response.stop_reason == "tool_use":
                    messages.append({"role": "assistant", "content": response.content})
                    tool_results = []
                    for block in response.content:
                        if getattr(block, "type", None) != "tool_use":
                            continue
                        handler = TOOL_HANDLERS.get(block.name)
                        if not handler:
                            result = {"error": f"tool desconocido: {block.name}"}
                        else:
                            try:
                                result = await handler(block.input or {})
                            except Exception as e:
                                result = {"error": f"tool_exception: {e}"}
                        tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": json.dumps(result, ensure_ascii=False)[:12000]})
                    messages.append({"role": "user", "content": tool_results})
                    continue
                texts = [b.text for b in response.content if getattr(b, "type", None) == "text"]
                return {"ok": True, "engine": "anthropic", "response": "".join(texts) or "(respuesta vacía)"}
            return {"ok": True, "engine": "anthropic", "response": "⚠️ Consulté varias herramientas pero no llegué a una respuesta final. Reformulá tu pregunta."}
        except Exception as e:
            anthropic_err = str(e)[:400]

    # === Motor 2: Gemini (fallback — mismo set de tools: generate_pdf) ===
    if _GEMINI_KEY:
        try:
            gem_system = system + "\n\n---\n*(Sesión en modo respaldo: corriendo con Google Gemini porque la API de Claude no está disponible ahora. La generación de PDF funciona igual; la base de conocimiento extendida de ventas/neuromarketing no está cargada en esta sesión.)*"
            if KB_CRM:
                gem_system += f"\n\n---\n\n# KNOWLEDGE BASE · GOZZ CRM (OPERACIÓN Y ARQUITECTURA)\n\n{KB_CRM}"
            if body.context:
                gem_system += f"\n\n---\n**Contexto adicional proporcionado por el backend:**\n{body.context}"
            gem_parts = [p for p in (_anthropic_block_to_gemini_part(b) for b in user_content) if p]
            text = await _gemini_chat_loop(gem_system, gem_parts, use_tools=True)
            return {"ok": True, "engine": "gemini", "response": text or "(respuesta vacía)"}
        except Exception as e:
            raise HTTPException(503, f"CoPilot no disponible. Claude: {anthropic_err or 'sin clave'}. Gemini: {str(e)[:400]}")

    raise HTTPException(503, f"CoPilot no disponible: {anthropic_err or 'no hay clave de IA configurada'}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8100, reload=False)
