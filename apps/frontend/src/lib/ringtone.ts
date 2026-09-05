// Classic-phone ringtone via WebAudio, no MP3 needed
let audioCtx: AudioContext | null = null;
let ringInterval: any = null;

function ctx(): AudioContext {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return audioCtx;
}

function tone(freq: number, start: number, duration: number, gain = 0.2) {
  const a = ctx();
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.frequency.value = freq;
  osc.type = "sine";
  const t0 = a.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  g.gain.linearRampToValueAtTime(gain, t0 + duration - 0.03);
  g.gain.linearRampToValueAtTime(0, t0 + duration);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.01);
}

// Tono warm con ADSR suave + lowpass + toque de "body" via armónico
function warmTone(freq: number, start: number, duration: number, gain = 0.12, harmonic = false) {
  try {
    const a = ctx();
    const osc = a.createOscillator();
    const osc2 = harmonic ? a.createOscillator() : null;
    const g = a.createGain();
    const g2 = harmonic ? a.createGain() : null;
    const lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2800;
    lp.Q.value = 0.8;

    osc.frequency.value = freq;
    osc.type = "sine";
    if (osc2 && g2) {
      osc2.frequency.value = freq * 2; // octava
      osc2.type = "sine";
    }

    const t0 = a.currentTime + start;
    // ADSR: attack 25ms, decay a 0.6, sustain, release 180ms
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.025);
    g.gain.exponentialRampToValueAtTime(gain * 0.6, t0 + 0.15);
    g.gain.setValueAtTime(gain * 0.6, t0 + duration - 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(g).connect(lp).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);

    if (osc2 && g2) {
      g2.gain.setValueAtTime(0, t0);
      g2.gain.linearRampToValueAtTime(gain * 0.25, t0 + 0.04);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc2.connect(g2).connect(lp);
      osc2.start(t0);
      osc2.stop(t0 + duration + 0.02);
    }
  } catch {}
}

export function startRing(pattern: "incoming" | "outgoing" = "incoming") {
  stopRing();
  try { ctx().resume(); } catch {}
  const doRing = () => {
    if (pattern === "incoming") {
      // Incoming 2026 · campana cálida ascendente (C5 → E5 → G5 → C6) con octavas
      // Frecuencias C mayor. Suena amistoso y moderno tipo Apple/Slack/Linear.
      warmTone(523.25, 0.00, 0.55, 0.13, true);  // C5
      warmTone(659.25, 0.18, 0.55, 0.11, true);  // E5
      warmTone(783.99, 0.36, 0.65, 0.10, true);  // G5
      warmTone(1046.50, 0.60, 0.90, 0.09, true); // C6
    } else {
      // Outgoing 2026 · pulso suave de "esperando" (E5 + A5) tipo FaceTime
      warmTone(659.25, 0.00, 0.42, 0.08, false); // E5
      warmTone(880.00, 0.14, 0.52, 0.07, false); // A5
    }
  };
  doRing();
  const cycle = pattern === "incoming" ? 3200 : 2600;
  ringInterval = setInterval(doRing, cycle);
}

export function stopRing() {
  if (ringInterval) { clearInterval(ringInterval); ringInterval = null; }
}

// Vibration pattern (mobile)
export function startVibration() {
  if (!navigator.vibrate) return;
  try {
    navigator.vibrate([300, 200, 300, 1800]);
    // Repeat via interval
    (window as any).__ringVibrate = setInterval(() => {
      try { navigator.vibrate([300, 200, 300, 1800]); } catch {}
    }, 2800);
  } catch {}
}
export function stopVibration() {
  if ((window as any).__ringVibrate) { clearInterval((window as any).__ringVibrate); (window as any).__ringVibrate = null; }
  try { navigator.vibrate?.(0); } catch {}
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const p = await Notification.requestPermission();
    return p === "granted";
  } catch { return false; }
}

export function osNotify(title: string, body: string, icon?: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body, icon, tag: "gozz-call", requireInteraction: false });
    setTimeout(() => n.close(), 8000);
  } catch {}
}

// Chime amigable 2026: acorde ascendente con filtro suave (tipo Linear/Arc/Notion)
// C6 + E6 + G6 cascada — alegre, profesional, no invasivo
function chordTone(freq: number, start: number, duration: number, gain = 0.12) {
  try {
    const a = ctx();
    const osc = a.createOscillator();
    const g = a.createGain();
    const lp = a.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3500;
    lp.Q.value = 0.7;

    osc.frequency.value = freq;
    osc.type = "sine";

    const t0 = a.currentTime + start;
    // Attack muy rápido, release largo y suave
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(g).connect(lp).connect(a.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.01);
  } catch {}
}

export function playMessagePing() {
  try {
    ctx().resume().catch(() => {});
    // Acorde C mayor ascendente (C6 · E6 · G6) suave
    chordTone(1046.50, 0.00, 0.45, 0.11);  // C6
    chordTone(1318.51, 0.06, 0.50, 0.09);  // E6
    chordTone(1567.98, 0.12, 0.55, 0.08);  // G6
  } catch {}
}

// Ping sutil para notificaciones secundarias (toasts no-mensajes)
export function playSoftPing() {
  try {
    ctx().resume().catch(() => {});
    chordTone(1046.50, 0.00, 0.30, 0.08);
    chordTone(1318.51, 0.05, 0.35, 0.06);
  } catch {}
}

// "Mano arriba" · campanilla brillante ascendente con cola (C6→E6→A6→D7)
// Evoca una atención amigable, moderna tipo Slack/Zoom reaction.
export function playHandRaise() {
  try {
    ctx().resume().catch(() => {});
    chordTone(1046.50, 0.00, 0.45, 0.12);  // C6
    chordTone(1318.51, 0.08, 0.50, 0.10);  // E6
    chordTone(1760.00, 0.16, 0.55, 0.09);  // A6
    chordTone(2349.32, 0.26, 0.75, 0.07);  // D7 (brillo largo)
  } catch {}
}

// "Screen share start" · sweep ascendente corto + acorde confirmación
// Evoca "compartir/expandir" con un whoosh moderno.
export function playScreenShareStart() {
  try {
    const a = ctx();
    a.resume().catch(() => {});
    // Sweep corto 300Hz → 1200Hz en 250ms
    const sweepOsc = a.createOscillator();
    const sweepGain = a.createGain();
    const sweepLp = a.createBiquadFilter();
    sweepLp.type = "lowpass"; sweepLp.frequency.value = 2200; sweepLp.Q.value = 0.7;
    sweepOsc.type = "sine";
    const t0 = a.currentTime;
    sweepOsc.frequency.setValueAtTime(300, t0);
    sweepOsc.frequency.exponentialRampToValueAtTime(1200, t0 + 0.25);
    sweepGain.gain.setValueAtTime(0, t0);
    sweepGain.gain.linearRampToValueAtTime(0.10, t0 + 0.04);
    sweepGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    sweepOsc.connect(sweepGain).connect(sweepLp).connect(a.destination);
    sweepOsc.start(t0); sweepOsc.stop(t0 + 0.3);
    // Acorde de confirmación (E5 + B5) con colita
    chordTone(659.25, 0.22, 0.45, 0.09);   // E5
    chordTone(987.77, 0.28, 0.50, 0.08);   // B5
  } catch {}
}

export function playScreenShareStop() {
  try {
    const a = ctx();
    a.resume().catch(() => {});
    // Sweep descendente
    const sweepOsc = a.createOscillator();
    const sweepGain = a.createGain();
    const sweepLp = a.createBiquadFilter();
    sweepLp.type = "lowpass"; sweepLp.frequency.value = 1800; sweepLp.Q.value = 0.6;
    sweepOsc.type = "sine";
    const t0 = a.currentTime;
    sweepOsc.frequency.setValueAtTime(900, t0);
    sweepOsc.frequency.exponentialRampToValueAtTime(240, t0 + 0.25);
    sweepGain.gain.setValueAtTime(0, t0);
    sweepGain.gain.linearRampToValueAtTime(0.08, t0 + 0.04);
    sweepGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    sweepOsc.connect(sweepGain).connect(sweepLp).connect(a.destination);
    sweepOsc.start(t0); sweepOsc.stop(t0 + 0.3);
  } catch {}
}
