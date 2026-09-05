export type Country = { code: string; flag: string; name: string; dial: string };

// Lista curada para la audiencia (LatAm + US/CA/ES). Default US (+1).
export const COUNTRIES: Country[] = [
  { code: "US", flag: "\uD83C\uDDFA\uD83C\uDDF8", name: "Estados Unidos", dial: "+1" },
  { code: "MX", flag: "\uD83C\uDDF2\uD83C\uDDFD", name: "Mexico", dial: "+52" },
  { code: "CO", flag: "\uD83C\uDDE8\uD83C\uDDF4", name: "Colombia", dial: "+57" },
  { code: "VE", flag: "\uD83C\uDDFB\uD83C\uDDEA", name: "Venezuela", dial: "+58" },
  { code: "PE", flag: "\uD83C\uDDF5\uD83C\uDDEA", name: "Peru", dial: "+51" },
  { code: "EC", flag: "\uD83C\uDDEA\uD83C\uDDE8", name: "Ecuador", dial: "+593" },
  { code: "GT", flag: "\uD83C\uDDEC\uD83C\uDDF9", name: "Guatemala", dial: "+502" },
  { code: "HN", flag: "\uD83C\uDDED\uD83C\uDDF3", name: "Honduras", dial: "+504" },
  { code: "SV", flag: "\uD83C\uDDF8\uD83C\uDDFB", name: "El Salvador", dial: "+503" },
  { code: "NI", flag: "\uD83C\uDDF3\uD83C\uDDEE", name: "Nicaragua", dial: "+505" },
  { code: "CR", flag: "\uD83C\uDDE8\uD83C\uDDF7", name: "Costa Rica", dial: "+506" },
  { code: "PA", flag: "\uD83C\uDDF5\uD83C\uDDE6", name: "Panama", dial: "+507" },
  { code: "DO", flag: "\uD83C\uDDE9\uD83C\uDDF4", name: "Rep. Dominicana", dial: "+1" },
  { code: "CU", flag: "\uD83C\uDDE8\uD83C\uDDFA", name: "Cuba", dial: "+53" },
  { code: "AR", flag: "\uD83C\uDDE6\uD83C\uDDF7", name: "Argentina", dial: "+54" },
  { code: "CL", flag: "\uD83C\uDDE8\uD83C\uDDF1", name: "Chile", dial: "+56" },
  { code: "BO", flag: "\uD83C\uDDE7\uD83C\uDDF4", name: "Bolivia", dial: "+591" },
  { code: "PY", flag: "\uD83C\uDDF5\uD83C\uDDFE", name: "Paraguay", dial: "+595" },
  { code: "UY", flag: "\uD83C\uDDFA\uD83C\uDDFE", name: "Uruguay", dial: "+598" },
  { code: "BR", flag: "\uD83C\uDDE7\uD83C\uDDF7", name: "Brasil", dial: "+55" },
  { code: "ES", flag: "\uD83C\uDDEA\uD83C\uDDF8", name: "Espana", dial: "+34" },
  { code: "CA", flag: "\uD83C\uDDE8\uD83C\uDDE6", name: "Canada", dial: "+1" },
];

export function dialOf(code: string) {
  return (COUNTRIES.find((p) => p.code === code) || COUNTRIES[0]).dial;
}

export function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || "").trim());
}

// Formato visual: US/CA/+1 => (305) 555-1234 ; otros => solo digitos.
export function formatPhone(raw: string, dial: string) {
  const d = (raw || "").replace(/\D/g, "");
  if (dial === "+1") {
    const p = d.slice(0, 10);
    if (p.length <= 3) return p;
    if (p.length <= 6) return `(${p.slice(0, 3)}) ${p.slice(3)}`;
    return `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;
  }
  return d;
}

// Numero internacional E.164-ish para guardar: +<dial><digitos>.
export function toE164(code: string, raw: string) {
  const d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  return dialOf(code) + d;
}
