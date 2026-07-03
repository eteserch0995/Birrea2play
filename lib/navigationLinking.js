// Config de linking para React Navigation v6.
// En web: sincroniza el botón atrás/adelante del navegador con el stack del navigator
// para que el usuario navegue dentro de la app sin salirse.
// En native: no rompe nada — el `linking` solo actúa si recibe una URL al iniciar.
//
// IMPORTANTE: todos los paths de evento usan el param `:eventId` porque las
// pantallas EventDetailScreen / ActiveEventScreen leen `route.params.eventId`.
// El nombre del placeholder en el path se inyecta tal cual como key en params.

export const linking = {
  prefixes: [
    'https://birrea2play.com',
    'https://www.birrea2play.com',
    'birrea2play://',
  ],
  config: {
    screens: {
      MainTabs: {
        path: '',
        screens: {
          Inicio:    'inicio',
          Mundial:   'mundial',
          Eventos: {
            path: 'eventos',
            screens: {
              EventsList:   '',
              EventDetail:  ':eventId',
              ActiveEvent:  ':eventId/activo',
            },
          },
          Wallet:    'creditos',
          Tienda:    'tienda',
          Noticias:  'noticias',
          Beneficios:'club',
          Panel:     'panel',
          Cancha:    'cancha',
        },
      },
      // Stack screens fuera de tabs — formato canónico que generan los links
      // compartidos: https://birrea2play.com/evento/:eventId
      EventDetail:       'evento/:eventId',
      ActiveEvent:       'evento/:eventId/activo',
      LiveBoard:         'evento/:eventId/live',
      Raffle:            'rifa',
      CanchaBooking:     'cancha/reservar',
      Rotaciones:        'rotaciones',
      Profile:           'perfil',
      EditProfile:       'perfil/editar',
      GestorRequest:     'perfil/gestor',
      Notifications:     'notificaciones',
      Cart:              'carrito',
      OrderConfirmation: 'orden-confirmada',
      PlayerProfile:     'jugador/:id',
      EditEvent:         'evento/:eventId/editar',
      SocialPreview:     'preview-social',
      PrivacyPolicy:     'privacidad',
      Terms:             'terminos',
      Recaudo:           'recaudo',
      // Auth flow standalone (visible cuando NO hay sesión)
      Login:           'login',
      Register:        'registro',
      ForgotPassword:  'recuperar-acceso',
      ResetPassword:   'reset-password',
    },
  },
};
