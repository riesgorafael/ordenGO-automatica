// Traducción de la interfaz. El castellano es el idioma base y vive en el código: `t()` devuelve la
// clave tal cual cuando no hay traducción, así que una cadena sin traducir se ve en castellano en
// lugar de romperse o mostrar un identificador técnico. Eso permite traducir de a partes sin dejar
// la aplicación a medio camino.
//
// El idioma se resuelve así, en orden:
//  1. La elección explícita del usuario, guardada en el navegador — si eligió, manda.
//  2. El idioma del sistema operativo o del navegador (navigator.language).
//  3. Castellano.
const STORAGE_KEY = "miordengo_lang";

export const LANGUAGES = [
  { id: "es", label: "Español", short: "ES" },
  { id: "en", label: "English", short: "EN" },
];

// Diccionario inglés. Las claves son la cadena en castellano: así el código sigue siendo legible
// sin abrir este archivo, y una clave faltante degrada al castellano en lugar de a un código.
const EN = {
  // — Acceso —
  "Iniciar sesión": "Sign in",
  "Acceso seguro": "Secure access",
  "Accedé a tu espacio de trabajo.": "Access your workspace.",
  "Correo electrónico": "Email",
  "Contraseña": "Password",
  "Ingresar": "Sign in",
  "Ingresando…": "Signing in…",
  "Mostrar": "Show",
  "Ocultar": "Hide",
  "¿Olvidaste tu contraseña? Pedile al administrador que la restablezca.":
    "Forgot your password? Ask your administrator to reset it.",
  "Software de gestión para empresas de servicios técnicos.":
    "Management software for technical service companies.",
  "Vos dirigís. Nosotros ordenamos.": "You lead. We keep it in order.",
  "Una sola plataforma para": "One platform for",
  "Órdenes, proyectos y finanzas en un único flujo": "Work orders, projects and finances in one flow",
  "Seguimiento en tiempo real con trazabilidad completa": "Real-time tracking with full traceability",
  "Acceso seguro según empresa, proyecto y rol": "Secure access by company, project and role",
  "Desarrollado por": "Developed by",
  // — Navegación —
  "Mi día": "My day",
  "Panel": "Dashboard",
  "Órdenes": "Work orders",
  "Proyectos": "Projects",
  "Notas": "Notes",
  "Clientes": "Clients",
  "Equipo": "Team",
  "Inventario": "Inventory",
  "Compras": "Purchasing",
  "Materiales": "Materials",
  "Remitos": "Delivery notes",
  "Presupuestos": "Quotes",
  "Finanzas": "Finance",
  "Configuración": "Settings",
  "Administración": "Administration",
  "Utilidades": "Tools",
  "Más": "More",
  "Cerrar sesión": "Sign out",
  "Buscar": "Search",
  "Idioma": "Language",
};

const DICTIONARIES = { en: EN };

export function detectLanguage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some((lang) => lang.id === saved)) return saved;
  } catch { /* almacenamiento bloqueado: se sigue con la detección automática */ }
  // navigator.language trae la configuración del sistema operativo cuando el navegador no tiene una
  // propia, que es lo pedido: si la máquina está en inglés, la aplicación arranca en inglés.
  const system = String(navigator?.language || "").toLowerCase();
  return system.startsWith("en") ? "en" : "es";
}

export function saveLanguage(lang) {
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* sin persistencia, dura la sesión */ }
}

// Devuelve la función de traducción para un idioma. Se pasa el idioma en lugar de leerlo adentro
// para que React vuelva a renderizar al cambiarlo: si `t` leyera el estado por su cuenta, cambiar
// de idioma no dispararía ningún render y la pantalla quedaría igual.
export function translator(lang) {
  const dictionary = DICTIONARIES[lang];
  return (text) => (dictionary && dictionary[text]) || text;
}
