/**
 * Spanish message catalog (same key structure as English).
 */
export const es = {
  app: {
    loading: {
      title: "Cargando...",
      subtitle: "Asegurando la conexinnn RWA",
    },
    errorBoundary:
      "Se produjo un error. Nuestro equipo ha sido notificado.",
  },
  nav: {
    brand: {
      primary: "YieldVault",
      accent: "RWA",
    },
    vaults: "Bvvvedas",
    portfolio: "Portafolio",
    analytics: "Analica",
  },
  theme: {
    toggleToDark: "Cambiar al modo oscuro",
    toggleToLight: "Cambiar al modo claro",
  },
  wallet: {
    connecting: "Conectando...",
    checkingFreighter: "Comprobando billetera…",
    connectFreighter: "Conectar Freighter",
    rpcPrefix: "RPC:",
    rpcCustom: "Personalizado",
    rpcDefault: "Predeterminado",
    disconnectAria: "Desconectar billetera",
    status: {
      connected: "Conectado",
      connecting: "Conectando a la billetera...",
      disconnected: "No conectado",
      error: "Error de conexión",
    },
    error: {
      notInstalled: "Extensión de billetera Freighter no detectada. Instala Freighter para continuar.",
      notAllowed: "Permiso de Freighter denegado. Aprueba el acceso en la extensión.",
      noAddress: "No se pudo obtener la dirección de la billetera. Verifica los permisos de Freighter.",
      generic: "Conexión fallida. Asegúrate de que Freighter esté desbloqueado y aprobado.",
    },
    tooltip: {
      connectedStatus: "Billetera conectada y lista para usar",
      disconnectedStatus: "Conecta tu billetera Freighter para continuar",
      connectingStatus: "Estableciendo conexión...",
      checkingStatus: "Buscando una sesión existente de Freighter en este dispositivo",
      errorStatus: "Conexión fallida - intenta de nuevo o verifica Freighter",
    },
  },
  toast: {
    walletConnected: {
      title: "Billetera conectada",
      description:
        "Freighter est conectado a tu sesinnn de YieldVault.",
    },
    walletPermissionRequired: {
      title: "Permiso de billetera requerido",
      description:
        "Freighter no devolvi   una clave pblica para esta sesinnn.",
    },
    walletConnectionFailed: {
      title: "Fall   la conexinnn de la billetera",
      description:
        "Asegrate de que Freighter est instalado, desbloqueado y aprobado para este sitio.",
    },
    walletDisconnected: {
      title: "Billetera desconectada",
      description:
        "Puedes volver a conectar en cualquier momento para seguir gestionando posiciones en la bvvveda.",
    },
  },
  apiBanner: {
    title: "Datos no disponibles",
  },
  dataTable: {
    pageLabel: "Página",
    pageOf: "de",
    previous: "Anterior",
    next: "Siguiente",
    sortBy: "Ordenar por",
  },
  shortcuts: {
    title: "Atajos de teclado",
    close: "Cerrar",
    hint: "Presiona Esc para cerrar este diálogo",
  },
  palette: {
    placeholder: "Buscar acciones…",
    noResults: "Sin resultados",
    hint: "↑↓ navegar · Enter ejecutar · Esc cerrar",
    open: "Abrir paleta de comandos",
  },
  refresh: {
    live: "En vivo",
    stopped: "Detenido",
    pause: "Pausar",
    resume: "Reanudar",
    refreshNow: "Actualizar",
    refreshing: "Actualizando...",
    justNow: "Ahora",
    oneMinuteAgo: "Hace 1 min",
    minutesAgo: "min atrs",
    pausedHidden: "Pausado (pestaa oculta)",
    pausedOffline: "Pausado (sin conexinnn)",
    pausedManual: "Pausado",
  },
  timeline: {
    loading: "Cargando actividad...",
    empty: "No hay actividad para mostrar",
    today: "Hoy",
    yesterday: "Ayer",
  },
  session: {
    warning: {
      title: "La sesión expirará pronto",
      message: "Tu sesión de billetera expirará en {{minutes}} minutos. Vuelve a conectar para continuar sin interrupciones.",
      reconnect: "Reconectar",
    },
  },
  reconnect: {
    title: "Bienvenido de nuevo",
    description: "Reconecta con {{provider}} para continuar.",
    confirm: "Reconectar",
    dismiss: "Usar otra billetera",
  },
  common: {
    dismiss: "Descartar",
  },
  commands: {
    goToVaults: "Ir a Bóvedas",
    goToPortfolio: "Ir a Portafolio",
    goToAnalytics: "Ir a Analítica",
    goToHistory: "Ir a Historial",
    deposit: "Depositar USDC",
    withdraw: "Retirar USDC",
    connectWallet: "Conectar billetera",
    settings: "Abrir configuración",
    showShortcuts: "Mostrar atajos de teclado",
    openPalette: "Abrir paleta de comandos",
    closeModal: "Cerrar modal",
    scopes: {
      navigation: "Navegación",
      actions: "Acciones",
      general: "General"
    }
  },
} as const;
